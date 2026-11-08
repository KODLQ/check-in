# Design

## Context

See proposal.md (Why) and specs/ for required behavior. What exists today and constrains the approach:

- `public.events.starts_at` is `NOT NULL`. `events_guard` rejects past starts on insert/update and stamps `time_changed_at` on any time change. `event_ended_at(e) = coalesce(ends_at, starts_at + 12h)` is used by `get_invite`, `open_event_for_token`, `events_guard` and `run_retention`.
- Hosts create and edit events by **direct table writes under RLS** (`apps/mobile/src/lib/events.ts → toEventRow`); the initial invite token comes from the `events_create_invite` trigger.
- Guests never touch tables: `get_invite(token, guest_token)` returns a `state` (`not_found | cancelled | active | past`) + safe payload; writes go through `POST/DELETE /api/rsvp` (per-IP+invite rate limit via `hit_rate_limit`, 10 writes / 10 min) → service-role `upsert_rsvp` / `withdraw_rsvp`. Signed-in app users call `rsvp_as_user`. Max 500 RSVPs per event (`max_rsvps_per_event()`).
- Guest identity = 128-bit device `guest_token` in cookie + localStorage; only its SHA-256 is stored.

## Goals / Non-Goals

**Goals:**
- Poll state and rules enforced in Postgres, like everything else; the clients only render.
- Reuse the RSVP identity, rate-limit and invite-token machinery rather than build parallel versions.
- Converting votes to RSVPs is a single atomic transaction.
- Fixed-date events keep their exact current code paths.

**Non-Goals:**
- Real-time updates on the guest invite page (it is server-rendered; tallies refresh on load, same as the guest list).
- A generic polling framework (only start-time polls).
- Delivering notifications (owned by `add-guest-updates`; we only emit an event).

## Decisions

### 1. "Date pending" = `events.starts_at IS NULL`

`starts_at` becomes nullable; pending is derived, not a separate flag. Added columns on `events`:

| Column | Purpose |
|---|---|
| `poll_closes_at timestamptz null` | Optional voting deadline |
| `date_picked_at timestamptz null` | Set when an option is picked; marks the event as "was a poll" |

Constraint: `ends_at is null or starts_at is not null`. After a pick, `poll_closes_at` is simply ignored.

`event_ended_at(e)` returns `null` for pending events, so every existing `< now()` comparison is false → never "past". Audited call sites: `get_invite` (adds a pending branch before the past check), `open_event_for_token` (adds an explicit `date_pending` exception so RSVPs are rejected), `events_guard` (null is fine), `run_retention` (needs its own rule, §8).

*Alternative:* a separate `date_mode` enum column. Rejected: two sources of truth for "has a date", and every query would need both.

### 2. Tables

| Table | Key columns | Notes |
|---|---|---|
| `date_poll_options` | `id`, `event_id` → events (cascade), `starts_at timestamptz not null`, `ends_at`, `final_yes int`, `final_if_needed int`, `final_no int`, `created_at` | Unique `(event_id, starts_at)`; check `ends_at > starts_at`. `final_*` filled on pick |
| `date_poll_voters` | `id`, `event_id` (cascade), `user_id` null → profiles (cascade), `guest_token_hash` null, `display_name`, timestamps | Same identity check + unique constraints as `rsvps`. One row per person per event, so the name is stored once |
| `date_poll_votes` | `voter_id` → voters (cascade), `option_id` → options (cascade), `choice vote_choice` | PK `(voter_id, option_id)`; enum `vote_choice = ('yes','if_needed','no')` |

Option count (2–4) is enforced in the RPCs, not with a trigger, because edits replace the set in one call and an intermediate count is legitimately out of range.

*Alternative:* store votes on `rsvps` with a nullable option. Rejected: mixes two lifecycles and would break the "one RSVP per identity" uniqueness.

### 3. RLS

All three tables have RLS enabled. **No anon policies and no insert/update policies for anyone** — writes go only through security-definer RPCs so that open/deadline/past-option/rate rules cannot be bypassed.

- `date_poll_options`: `select` for `authenticated` where `is_event_host(event_id)`.
- `date_poll_voters`: `select` where `is_event_host(event_id) or user_id = auth.uid()`; `delete` where `is_event_host(event_id) or user_id = auth.uid()` (host removes voter; signed-in user withdraws).
- `date_poll_votes`: `select` where the parent voter is selectable (`exists` on voters with the same predicate, via a `security definer stable` helper `can_read_voter(voter_id)` to avoid recursive RLS cost).
- `date_poll_voters` and `date_poll_votes` are added to the `supabase_realtime` publication so the host's results update live (Realtime respects RLS, so only the host and the voter themselves receive rows).
- `events` policies are unchanged; the guard (§4) handles the new columns.

### 4. Write paths (RPCs)

| Function | Caller | Behavior |
|---|---|---|
| `create_poll_event(p_event jsonb, p_options jsonb, p_closes_at)` | authenticated (security invoker, RLS applies) | Inserts the event with `starts_at = null` and 2–4 options in one transaction; returns event id + invite token |
| `set_poll_options(p_event_id, p_options jsonb, p_closes_at)` | host | Replaces the option set. Options sent with an existing `id` and unchanged times keep their votes; changed or missing ones are deleted (cascade deletes their votes). Returns deleted vote count |
| `submit_votes(p_token, p_guest_token, p_display_name, p_votes jsonb)` | service_role (web route) | Upserts voter by `guest_token_hash` and replaces their ballot |
| `withdraw_votes(p_token, p_guest_token)` | service_role | Deletes the voter (cascade) |
| `vote_as_user(p_token, p_votes jsonb)` | authenticated | Same as `submit_votes` with profile name |
| `pick_poll_option(p_option_id)` | host | §5 |

The guard needs to stop hosts from bypassing these with direct writes: `events_guard` now rejects (a) inserting `starts_at = null` and (b) changing `starts_at`/`ends_at` while `old.starts_at is null`, unless the transaction-local setting `checkin.poll_rpc = 'on'` is set (only our RPCs `set_config` it). It also rejects setting `starts_at` back to null on a dated event, and does not stamp `time_changed_at` when `old.starts_at is null` (a pick is not a "time changed").

Ballot shape: `[{option_id, choice}]`; options omitted = unanswered. A ballot is accepted only if the event is pending, not cancelled, `poll_closes_at` is null or in the future, and every referenced option belongs to the event and starts in the future; otherwise the whole ballot is rejected (`poll_closed` / `option_passed`). Validation for candidate times (future, distinct, end > start, 2–4, deadline ≤ earliest start) lives in both the zod schema (fast feedback) and the RPC (authority).

**Edit-warning UX:** the host app already has every vote via RLS/Realtime, so it computes "N votes will be deleted" locally before calling `set_poll_options`; the RPC's returned count is used to confirm.

### 5. Picking and conversion

`pick_poll_option(option_id)` in one transaction, `security definer`, checks `is_event_host`:
1. Lock the event row (`for update`); reject if cancelled, already picked (`already_picked`), or the option starts ≤ now (`option_passed`).
2. Set `starts_at/ends_at` from the option, `date_picked_at = now()`.
3. Insert RSVPs: `yes → going`, `if_needed → maybe`, carrying `user_id`/`guest_token_hash`/`display_name` from the voter. `on conflict do nothing` (none should exist, but safe). The 500 cap is already guaranteed by the 500-voter cap.
4. Write `final_*` tallies on every option, then delete all voters (cascade votes).
5. `pg_notify`/insert into the `notifications` outbox **only if** that capability's table/function exists (checked via `to_regprocedure`), with payload `{event_id, kind: 'date_picked'}` and the list of converted identities. Without it, nothing else changes.

Because RSVPs keep the same `guest_token_hash`, the existing `get_invite` `my_rsvp` lookup shows a converted guest their Going/Maybe with no extra work.

*Why No → no RSVP rather than Can't go:* a No to one option is not a refusal of the event; creating Can't go would wrongly show them as declined to the host and stop the guest from noticing they could still come.

*Why delete votes on pick:* data minimisation — after the pick the per-person answers to other dates have no purpose; the final tallies keep the host's summary.

### 6. `get_invite` payload

New state `date_pending`, checked after `cancelled`:

```
{ state: 'date_pending', event: {...same, starts_at: null}, host, 
  poll: { closes_at, voting_open: bool, expired: bool,
          options: [{ id, starts_at, ends_at, passed: bool,
                      tallies: {yes, if_needed, no},
                      voters: [{display_name, choice}] | null }] },
  my_votes: { display_name, votes: {<option_id>: choice} } | null }
```
`voters` is non-null only when `guest_list_visible`, and includes only `yes`/`if_needed`. `expired` = every option passed. `voting_open` = not expired and deadline not passed. Picked events return the normal `active`/`past` states. `counts`/`guests`/`my_rsvp` are omitted for pending events.

### 7. Web and mobile

- **Web** (`apps/web/src/app/i/[token]`): `page.tsx` branches on `date_pending` and renders a new client component `poll-form.tsx` (three-state segmented control per option, one name field shared with `rsvp-form.tsx`'s stored name, "Save votes" posts the whole ballot). New `app/api/votes/route.ts` mirrors `api/rsvp/route.ts`: same `allowed()` helper with bucket `${ipHash}:${token}:votes`, same limits. `generateMetadata` and `opengraph-image.tsx` use `t('invite.date_tbd_vote')` instead of `formatEventTime`. `calendar.ics/route.ts` returns 404 when pending. `lib/invite.ts` `Invite` union gains the pending variant.
- **Mobile**: `event-form.tsx` gets a "Fixed date / Let guests vote" toggle; vote mode replaces the start/end `DateField`s with 2–4 option rows (start + optional end) and an optional deadline. Defaults: two options (`defaultStart` and +1 day) so creating stays under 30 s. Create calls `create_poll_event` instead of the direct insert. `events/[id]/index.tsx` shows a poll results section (live via Realtime) with Pick (confirm sheet: "5 will be Going, 2 Maybe"), Edit options, and remove-voter. `app/index.tsx` list query orders `starts_at nulls first` and renders "Date TBD · N voted". `i/[token].tsx` calls `vote_as_user` for signed-in users.
- **Shared**: `VOTE_CHOICES`, `makeDatePollInputSchema(now)`, `ballotInputSchema` in `schemas.ts`; `formatOption` helper in `dates.ts` (Europe/Stockholm by default); sv/en strings.

### 8. Retention

`run_retention` adds: delete events where `starts_at is null` and the latest option started more than 12 months ago (covers expired and cancelled pending polls). Picked events fall under the existing 12-months-after-end rule.

## Personal data & retention

| Data | Lawful basis | Retention |
|---|---|---|
| Voter display name | Legitimate interest (host scheduling an event the guest chose to answer) | Until the voter withdraws, the host removes them, the date is picked (then converted to an RSVP or deleted), or the event is deleted |
| Hashed guest token on voter row | Same | Same as the voter row |
| Per-option answers | Same | Deleted on pick; only anonymous counts (`final_*`) are kept |
| Hashed IP in rate-limit buckets | Legitimate interest (abuse prevention) | 24 hours (existing job) |

No new categories of personal data; account deletion already cascades (`profiles` → `date_poll_voters.user_id`, `events` → options/voters).

## Risks / Trade-offs

- [Host direct-writes `starts_at = null` or edits a pending event's time, bypassing poll rules] → `events_guard` rejects unless the RPC's transaction-local flag is set; pgTAP covers it.
- [Two hosts' devices pick at the same time (or a co-host, once `add-co-hosts` lands)] → `for update` lock + `already_picked` error; the second device refreshes.
- [Guest votes from a stale page after the pick] → ballot rejected with `poll_closed`; page reloads to the picked date (spec scenario).
- [Voters who lost their cookie appear twice and convert into duplicate RSVPs] → same as RSVPs today: host can remove voters/guests.
- [Notifications capability absent or delayed] → design treats it as optional; invite page and host list are the source of truth.
- [Parallel changes (`add-co-hosts`, `add-guest-capacity`) MODIFY the same `private-events`/`event-rsvp` requirements] → the later-archived change must re-copy the current main-spec block before archiving.
- [Guest-capacity limit (if `add-guest-capacity` lands) smaller than Yes voters] → out of scope here; that change must define whether conversion respects the cap (flagged as an open question).

## Migration Plan

1. One forward migration: make `starts_at` nullable, add columns, enum, tables, RLS, Realtime publication, RPCs, and replace `event_ended_at`-dependent functions (`get_invite`, `open_event_for_token`, `events_guard`, `run_retention`). Existing rows all have `starts_at` so nothing is backfilled.
2. Deploy web before shipping the mobile build: the invite site must understand `date_pending` before any host can create a poll. Older mobile builds cannot create polls, and a host only has pending events once they run the new build.
3. Rollback: revert the web and mobile releases; reverting the migration additionally requires picking or deleting pending events first so `starts_at` can return to `not null`.

## Open Questions

- Should a guest-capacity limit (from `add-guest-capacity`) cap Yes→Going conversions, overflowing to a waitlist? Deferred to whichever of the two changes lands second; it does not change this change's tasks.
- Exact copy for "Date TBD — vote now" in Swedish ("Datum ej bestämt — rösta nu" as placeholder).
