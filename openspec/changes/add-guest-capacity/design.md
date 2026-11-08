# Design

## Context

See proposal.md for motivation and the specs in this change for required behavior (`event-capacity`, plus the `event-rsvp` and `private-events` deltas).

Current state that shapes the approach (from `supabase/migrations` and the apps):

- `rsvps` has one row per guest per event (unique on `(event_id, user_id)` and `(event_id, guest_token_hash)`), `status` enum `going | maybe | declined`. No anon policies: guests write only through security-definer RPCs. `upsert_rsvp` (service role, called by `POST /api/rsvp` after IP rate limiting), `withdraw_rsvp` (service role, `DELETE /api/rsvp`) and `rsvp_as_user` (authenticated, in-app RSVP in `apps/mobile/src/app/i/[token].tsx`).
- Hosts read `rsvps` directly through RLS and **remove guests with a direct table `DELETE`** (`apps/mobile/src/app/events/[id]/index.tsx`). They edit events with a direct `UPDATE` guarded by the `events_guard` trigger.
- `get_invite` is `STABLE`, returns `counts` as row counts and the guest list without any notion of party size.
- The host guest list is live via Realtime on `rsvps`; the host event list counts `rsvps(status)` client-side.
- Today nothing serializes concurrent RSVP writes per event. Capacity introduces a cross-row invariant (sum of Going heads ≤ capacity), so it does need serializing.

## Goals / Non-Goals

**Goals:**
- One place in Postgres decides Going vs waitlisted and runs promotion, used by every write path (guest web, in-app, host, event edit).
- Never overbook under concurrent requests, without retries leaking to the client.
- Existing events and responses behave exactly as before (no plus-ones, no capacity) after the migration.

**Non-Goals:**
- Guaranteed real-time delivery of "you got a spot". Delivery belongs to `notifications` (change `add-guest-updates`). This change only guarantees the state and exposes the signal.
- Optimizing for events above the existing 500-response cap.

## Decisions

### 1. Capability boundary

Capacity, waitlist and promotion form a new `event-capacity` capability: they are one cohesive rule set (admission + fair refill) that will also own future things like waitlist expiry. Plus-ones stay in `event-rsvp` because they are part of an answer, not of capacity (they matter on events without a capacity too). Event settings live in `private-events` Create/Edit.

### 2. Data model: waitlist is an RSVP status, not a table

Migration A (alone, because a new enum value cannot be used in the transaction that adds it):
- `alter type public.rsvp_status add value 'waitlisted'`.

Migration B:

| Table | New columns | Constraints |
|---|---|---|
| `events` | `allow_plus_ones boolean not null default false`, `max_plus_ones smallint not null default 1`, `capacity int null` | `max_plus_ones between 1 and 5`; `capacity is null or capacity between 1 and 3000` (500 responses × 6 heads) |
| `rsvps` | `plus_ones smallint not null default 0`, `waitlisted_at timestamptz`, `promoted_at timestamptz` | `plus_ones between 0 and 5`; `status in ('going','waitlisted') or plus_ones = 0`; `(status = 'waitlisted') = (waitlisted_at is not null)` |

Partial index `rsvps_waitlist_idx on rsvps (event_id, waitlisted_at, id) where status = 'waitlisted'`.

Heads of a response = `1 + plus_ones`. Going heads of an event = `sum(1 + plus_ones) where status = 'going'`. A shared SQL helper `event_going_heads(event_id)` and a TS helper `headCount()` in `packages/shared` keep the two sides consistent.

- **Why a status value:** a guest has exactly one answer at a time. Waitlisted is "wants to go, not admitted". A separate `waitlist` table would duplicate guest identity, need its own uniqueness and RLS, and allow a guest to be both Maybe and waitlisted.
- **Alternative rejected: computed waitlist** (all Going rows, the ones beyond capacity by `created_at` are "waitlisted"). Lowering capacity would silently demote people (the spec forbids it), host over-capacity promotion would be impossible, and there is no transition to notify on.
- `waitlisted_at` orders the queue and is kept when a waitlisted guest changes only plus-ones. `promoted_at` drives the "You got a spot!" banner and is cleared on the guest's next own answer.

### 3. Concurrency: lock the event row, always in the same order

Every function that can change Going heads or the waitlist starts with:

```sql
select * into ev from public.events where id = <event> for no key update;
```

and only then reads and writes `rsvps`. Writers on the same event are serialized; other events are unaffected. Functions are `VOLATILE` plpgsql under READ COMMITTED, so each statement after the lock sees the latest committed rows. `FOR NO KEY UPDATE` (not `FOR UPDATE`) so it does not block the `FOR KEY SHARE` taken by FK checks on unrelated inserts.

Lock order is always **events → rsvps**:
- RPCs (`upsert_rsvp`, `rsvp_as_user`, `withdraw_rsvp`, `remove_rsvp`, `promote_waitlisted`) lock the event first.
- A host `UPDATE events ...` locks the event row itself. An `AFTER UPDATE OF capacity, allow_plus_ones, max_plus_ones` trigger then runs promotion while holding that lock.
- Therefore **direct `DELETE` on `rsvps` is removed** (it would lock rsvps → events and can deadlock). The `"rsvps: host or self can delete"` policy is dropped and replaced by the `remove_rsvp` RPC.

Alternatives considered:
- *SERIALIZABLE transactions:* correct, but supabase-js RPCs can't set isolation per call, and serialization failures would need retry logic in the route handler and the app.
- *`pg_advisory_xact_lock(hashtext(event_id))`:* equivalent, but hash collisions serialize unrelated events and it isn't visible in the schema. The row lock is the natural mutex.
- *A constraint trigger asserting heads ≤ capacity:* can't express "lowering capacity keeps current guests" or host over-capacity promotion, and would only turn races into errors.

Invariant kept by every write under the lock: **after the write, no waitlisted guest fits in the remaining spots.** That is why a new guest who fits may be admitted directly even if the waitlist is non-empty: everyone waiting needs more spots than exist.

### 4. Admission and promotion functions

Internal (no grants to `anon`/`authenticated`; called only by the RPCs/trigger):

- `save_rsvp_locked(ev, user_id, guest_hash, name, requested_status, plus_ones) returns rsvps`
  1. Validate: `requested_status` ∈ `going|maybe|declined` (`waitlisted` from a client → `invalid_status`). For non-going, force `plus_ones = 0`. For going with `plus_ones > 0`: `plus_ones_not_allowed` if `not ev.allow_plus_ones`, `too_many_plus_ones` if above `ev.max_plus_ones`.
  2. `remaining = capacity − going heads excluding this guest's own row` (∞ when `capacity is null`).
  3. Going requested:
     - currently Going: if the new size fits `remaining`, or is ≤ the current size → stay Going. Otherwise raise `capacity_exceeded` with the spots left (spec: keep current answer).
     - not currently Going: if the size fits `remaining` → Going; else → `waitlisted`, keeping the existing `waitlisted_at` if already waitlisted, else `now()`.
  4. Upsert the row, clear `promoted_at`, then call `promote_from_waitlist(ev)`.
- `promote_from_waitlist(ev) returns setof uuid`: returns immediately if the event is cancelled or ended. Otherwise it walks `status = 'waitlisted'` ordered by `(waitlisted_at, id)` and promotes each row whose `1 + plus_ones ≤ remaining` (sets `going`, clears `waitlisted_at`, sets `promoted_at = now()`, decrements `remaining`). Rows that don't fit are skipped, never reordered. Bounded by the 500-row cap.

Public RPCs (all replaced with `create or replace`, each adds a defaulted parameter so existing named-argument callers keep working):

| Function | Caller / grant | Change |
|---|---|---|
| `upsert_rsvp(p_token, p_guest_token, p_display_name, p_status, p_plus_ones int default 0)` | service_role | lock event, `save_rsvp_locked`; returns `{status, display_name, plus_ones, waitlist_position, spots_left}`. Old 4-arg signature dropped. |
| `rsvp_as_user(p_token, p_status, p_plus_ones int default 0)` | authenticated | same |
| `withdraw_rsvp(p_token, p_guest_token)` | service_role | lock event, delete, promote |
| `remove_rsvp(p_rsvp_id)` **new** | authenticated | allowed if `is_event_host(event_id)` or `user_id = auth.uid()`; lock event, delete, promote |
| `promote_waitlisted(p_rsvp_id, p_over_capacity boolean default false)` **new** | authenticated | host only (`is_event_host`), event must be active, row must be waitlisted. If it doesn't fit and `p_over_capacity` is false, raise `over_capacity` so the app can ask for confirmation and retry with `true`. |
| `get_invite(p_token, p_guest_token)` | anon, authenticated | see below |

Error codes are `P0001` with message keys matching the existing pattern; `/api/rsvp` `mapError` maps `capacity_exceeded` → 409 (with `spots_left`), `too_many_plus_ones`/`plus_ones_not_allowed`/`invalid_status` → 400.

`get_invite` additions (still `STABLE`, no lock, so it may be a moment stale and that is fine):
- `event.allow_plus_ones`, `event.max_plus_ones`, `event.capacity`.
- `counts`: `going` = Going heads, `maybe` = Maybe count, `waitlist` = waitlisted heads, `spots_left` (null when unlimited), `full` boolean.
- `guests` (when visible): adds `plus_ones`; still Going/Maybe only (waitlisted never listed to guests).
- `my_rsvp`: adds `plus_ones`, `waitlist_position` (1-based rank by `(waitlisted_at, id)`), `promoted` (`promoted_at is not null`).

### 5. Event settings and the edit trigger

Hosts keep writing `events` directly through the existing RLS policies. Validation is layered: `makeEventInputSchema` (Zod) for UX, DB check constraints for enforcement. A new `events_capacity_changed` `AFTER UPDATE` trigger (`when` capacity or plus-one settings are distinct) calls `promote_from_waitlist(new)`. Turning plus-ones off or lowering the max does **not** touch existing rows (spec); the rule is only applied by `save_rsvp_locked` on the next answer.

To keep event creation under 30 seconds, the settings sit in a collapsed "Guests" section of `event-form.tsx` (plus-ones switch + 1–5 stepper, optional capacity number field). No new required field.

### 6. Account deletion and the safety sweep

Deleting a user cascades to their own `rsvps` rows without going through `remove_rsvp`, so it would free spots without promotion. Two measures:
- The `delete-account` Edge Function first calls a new internal `withdraw_all_rsvps_for_user(uid)`. It locks the affected events in `id` order (deterministic, so no deadlock between two deleting users), deletes, and promotes.
- `run_retention()` (already hourly via pg_cron) also calls `promote_from_waitlist` for active events with a non-empty waitlist. This catches any path that bypassed the RPCs (e.g. manual SQL). It is a safety net only; the specs are met without it.

### 7. Clients

- **Web (`rsvp-form.tsx`, `page.tsx`, `/api/rsvp`):** `rsvpInputSchema` gains `plusOnes: z.int().min(0).max(5).default(0)`. When `allow_plus_ones`, a "+ friends" stepper (0..max) is shown and sent with Going. When `counts.full` and the guest isn't Going, the Going button reads "Full — join waitlist". The answer line shows "Going +N", "You're on the waitlist — #N", or "You got a spot!" (when `promoted`). The going count uses heads. `generateMetadata` is unchanged: previews never showed counts.
- **Mobile host (`events/[id]/index.tsx`, `index.tsx`):** select `plus_ones, waitlisted_at` and add a fourth group, Waitlist, sorted by `waitlisted_at`, with Promote and Remove actions. Going label shows `heads / capacity` when set. Guests show "+N". Removal switches from `.delete()` to `rpc('remove_rsvp')`. The event list selects `rsvps(status, plus_ones)` and uses `headCount()`.
- **Mobile in-app RSVP (`i/[token].tsx`):** same plus-one stepper and waitlist state as web, via `rsvp_as_user`.
- **i18n:** new sv/en keys in `packages/shared/i18n` for plus-ones, full, waitlist position, got-a-spot, capacity errors, host promote/over-capacity confirmation.

### 8. Notifications hook (soft dependency on `add-guest-updates`)

Promotion is observable as an `rsvps` UPDATE from `status = 'waitlisted'` to `'going'` with `promoted_at` set. `promote_from_waitlist` returns the promoted ids. When the `notifications` capability lands, a single `AFTER UPDATE` trigger on `rsvps` (`when old.status = 'waitlisted' and new.status = 'going'`) enqueues a "you got a spot" notification through its API. If `notifications` is not merged when this change ships, that task is deferred. The invite page banner and host list already satisfy the spec without it.

### 9. RLS summary

No new tables.
- `events`: existing host-only select/insert/update/delete policies cover the new columns. Still no anon policy.
- `rsvps`: select policy unchanged (host sees all incl. waitlist; signed-in guest sees own row). **Dropped:** `"rsvps: host or self can delete"`. No insert/update/delete policies remain; all writes go through the security-definer functions above, each checking invite token, host (`is_event_host`) or self (`auth.uid()`).
- Realtime on `rsvps` is unchanged and still filtered by RLS, so promotions reach only the host.
- Internal helpers (`save_rsvp_locked`, `promote_from_waitlist`, `event_going_heads`, `withdraw_all_rsvps_for_user`) have `execute` revoked from `public, anon, authenticated`.

### 10. Testing

- **pgTAP (`supabase/tests/08_capacity.test.sql`, `09_waitlist.test.sql`):** constraints, admission/waitlist/promotion rules, skip-ahead, capacity lowering/raising/clearing, plus-one validation, host promote/remove and non-host rejection, dropped delete policy, grants, `get_invite` payload.
- **Concurrency (Vitest, `supabase/tests/concurrency/capacity.test.ts` against local Supabase):** fire 50 parallel `upsert_rsvp` calls at an event with 10 spots and assert Going heads = 10 and 40 waitlisted. Also run parallel withdraw + new-answer races. pgTAP can't open concurrent sessions, so this needs a real client.
- **Vitest (shared):** schemas, `headCount`.
- **Playwright (web):** plus-ones, full → waitlist → promotion after another guest withdraws.
- **Jest + RNTL (mobile):** event-form settings validation, guest list grouping/"+N". Manual iOS Simulator pass for promote/remove.

## Personal data & retention

| Data | Lawful basis | Retention |
|---|---|---|
| `rsvps.plus_ones` (a number, no names or identities of companions) | Legitimate interest, same as RSVP | Same as the RSVP: deleted with the event, on withdrawal or removal |
| `rsvps.waitlisted_at`, `rsvps.promoted_at` | Same | Same as the RSVP |
| `events.capacity`, plus-one settings | Contract (host's event) | Same as the event |

No new categories of personal data. Plus-ones are deliberately anonymous to avoid collecting data about people who never interacted with the service.

## Risks / Trade-offs

- [Per-event row lock serializes writes on very popular events] → writes are a few ms. Events are capped at 500 responses. Different events never contend.
- [Skip-ahead promotion can starve a large party at the head of the waitlist] → accepted product rule ("earliest guests that fit"). The host sees the order and can promote manually, even over capacity.
- [A new guest who fits can be admitted while others wait] → by the invariant, everyone waiting needs more spots than are free, so no waiting guest is passed over for a spot they could use.
- [Dropping the `rsvps` delete policy breaks remove-guest in any already-installed app build] → the app is pre-release. If a store build exists at deploy time, ship the mobile update first, or keep the policy for one release and rely on the hourly sweep.
- [Waitlisted guests may never learn they were promoted if they don't revisit and `notifications` isn't available] → the banner shows on next visit, and the host can see and message them. Delivery is owned by `add-guest-updates`.
- [Stale `get_invite` reads show "spots left" that are gone by the time the guest taps] → the write path decides authoritatively and the response tells the guest they were waitlisted.
- [Concurrent edits to both RSVP functions while siblings (`add-co-hosts`, `add-guest-updates`) also touch `rsvps`/`is_event_host`] → keep the internal `save_rsvp_locked` the single write path so siblings extend one function. Co-host changes to `is_event_host` automatically apply to `remove_rsvp`/`promote_waitlisted`.

## Migration Plan

1. Migration A: add enum value `waitlisted`.
2. Migration B: columns + constraints (defaults make existing data valid with no backfill), helpers, replaced RPCs (old `upsert_rsvp`/`rsvp_as_user` signatures dropped, replaced by versions with defaulted `p_plus_ones`, so the currently deployed web keeps working), `remove_rsvp`, `promote_waitlisted`, events trigger, drop the delete policy, grants, sweep in `run_retention`.
3. Regenerate `packages/shared/src/database.types.ts`.
4. Deploy web, then release mobile.

Rollback: a down migration restores the previous function bodies and the delete policy, after converting any `waitlisted` rows to `going` (the host can clean up) and setting `capacity = null`. New columns and the enum value can stay; they are inert.

## Open Questions

- Final sv/en copy for "Full — join waitlist", "You got a spot!" and the plus-one stepper label.
