# Design

## Context

See proposal.md (Why) and specs/ for required behavior. What exists today and constrains the approach:

- `public.events.starts_at` is `NOT NULL`. `events_guard` rejects past starts on insert/update and stamps `time_changed_at` on any time change. `event_ended_at(e) = coalesce(ends_at, starts_at + 12h)` is used by `get_invite`, `open_event_for_token`, `events_guard` and `run_retention`.
- Hosts create and edit events by **direct table writes under RLS** (`apps/mobile/src/lib/events.ts → toEventRow`); the initial invite token comes from the `events_create_invite` trigger.
- Guests never touch tables: `get_invite(token, guest_token)` returns a `state` (`not_found | cancelled | active | past`) + safe payload; writes go through `POST/DELETE /api/rsvp` (per-IP+invite rate limit via `hit_rate_limit`, 10 writes / 10 min) → service-role `upsert_rsvp` / `withdraw_rsvp`. Signed-in app users call `rsvp_as_user`. Max 500 RSVPs per event (`max_rsvps_per_event()`).
- Guest identity = 128-bit device `guest_token` in cookie + localStorage; only its SHA-256 is stored.

## Rebase onto landed changes (applied with add-co-hosts, add-guest-capacity, add-guest-updates, add-my-invites, story share)

This design was written before those changes were applied. Where this section and the numbered decisions below disagree, this section wins; the decisions have been edited in place where it was cheap.

- **R1 Permissions.** Every host-side poll action (`set_poll_options`, `pick_poll_option`, removing a voter, reading options/voters/votes under RLS) uses `is_event_manager` (owner + co-hosts). `create_poll_event` creates an event owned by the caller. Cancelling a pending event stays owner-only through the existing `events_guard` rule. Spec: date-polls "Host picks the date" (co-host scenarios), "Cancel a date-pending event".
- **R2 Pick → RSVP with capacity.** `pick_poll_option` takes the event lock (`lock_event`), sets the date with the `checkin.poll_rpc` flag, then re-locks with `lock_open_event` and converts each Yes/If-needed voter through `save_rsvp_locked` — never a direct `status='going'` write. Voters are processed in `date_poll_voters.created_at` order; `created_at` defaults to `clock_timestamp()` and is taken under the event lock, so it is the order people first voted. A Yes voter who does not fit becomes `waitlisted` with `waitlisted_at = clock_timestamp()` in that same order. **Plus-ones:** votes carry none, so converted Going answers have 0 plus-ones; the guest can add them afterwards under the normal rules. If needed → Maybe. Spec: date-polls "Pick respects capacity".
- **R3 Guest payload.** Poll state is part of `invite_payload()` (shared by `get_invite` and `get_my_invite`): a pending event returns `state: 'date_pending'` with `poll` (from `poll_payload(event_id)`) and `my_votes` instead of `counts`/`guests`/`my_rsvp`. `invite_payload` gained a 4th argument `p_voter_hash` (the browser's hashed guest token, passed by `get_invite`). Helpers take ids, not rows, so PostgREST does not expose them as computed columns.
- **R4 RSVP writes.** `open_event_for_token` (used by `upsert_rsvp`/`rsvp_as_user`) and `lock_open_event` (used by every admission path, incl. `set_my_rsvp`) raise `date_pending` while `starts_at is null`. The web `/api/rsvp` maps it to 409.
- **R5 Time-related producers.** `event_ended_at()` needed no change (`coalesce(null, null + 12h)` is null, so a pending event is never past; capacity triggers, `promote_from_waitlist`, `notification_stale_reason`, the retention email rule and the waitlist sweep all treat it as "not ended"). `schedule_event_reminder` returns early for a null start. `events_notify` sends nothing for edits of a pending event and treats the pick (null → date) as "schedule the reminder", not as `event_changed`. `events_guard` does not stamp `time_changed_at` on the pick.
- **R6 RSVP digest.** `rsvps_notify_digest` skips rows written while `checkin.poll_rpc = 'on'`, so converted RSVPs are not "replies" (spec: notifications "Notifications around a date pick").
- **R7 Notifications.** New kind `date_picked` (push only, not urgent, stale after start) registered per `notifications-worker/README.md`: `notification_kinds` row, `NOTIFICATION_KINDS`, sv/en strings, push template, pgTAP kinds list. `pick_poll_option` enqueues it with audience `user` for every signed-in voter (whatever they answered), dedupe key `date_picked:<event>:<user>`. Web voters get nothing: voting collects no email (spec: date-polls "Notify voters when a date is picked"). The §5 `to_regprocedure` guard is gone — the capability exists.
- **R8 My invites / home.** Pending events cannot have RSVPs, so `list_my_invites`/`get_my_invite` never return them (a signed-in voter's poll is not in their invites list until the pick converts their vote — consistent with the my-invites spec, which lists answered RSVPs). `buildHomeSections` accepts `starts_at: null` and sorts pending hosted events first, never past.
- **R9 Images.** The OG image and the story image (`/i/<token>/story`, `storyImageModel`) render "Date TBD — vote now" for pending events and are available while the poll is open; no options, tallies or names (spec: event-invites "Story image for a date-pending event"). `calendar.ics` 404s.
- **R10 Retention.** `run_retention(p_now)` is redefined with every line of the add-guest-capacity version plus the pending-poll rule (§8).
- **R11 Test files.** pgTAP numbers 08–10 were taken; the new files are `20_date_polls_rls`, `21_date_polls_options`, `22_date_polls_pick`, `23_date_polls_votes` (+ cases in 02/05/06/08), with a shared `fixtures/date_polls.psql`. Concurrency: `supabase/tests/concurrency/date-polls.test.ts` (parallel picks, votes racing a pick, voter cap). The web app has no Vitest, so `/api/votes` mappings are Playwright API tests.
- **R12 Realtime.** `date_poll_voters` and `date_poll_options` are published (filtered by `event_id`); votes are not — every ballot write touches its voter row (`updated_at`), which is enough to refresh.
- **R13 Small rules made explicit.** An empty ballot is rejected (`no_votes`); withdrawing is a separate call (`withdraw_votes` / `withdraw_votes_as_user`). When an option edit leaves a voter with no answers, that voter row is deleted. An unchanged deadline that already passed is accepted by `set_poll_options` (so other edits are possible on a closed poll); any changed deadline must be in the future and ≤ the earliest future option.

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

- `date_poll_options`: `select` for `authenticated` where `is_event_manager(event_id)` (R1).
- `date_poll_voters`: `select` where `is_event_manager(event_id) or user_id = auth.uid()`; `delete` where `is_event_manager(event_id) or user_id = auth.uid()` (manager removes voter; signed-in user withdraws).
- `date_poll_votes`: `select` where the parent voter is selectable (via a `security definer stable` helper `can_read_voter(voter_id)` to avoid recursive RLS cost).
- `date_poll_voters` and `date_poll_options` are added to the `supabase_realtime` publication so the managers' results update live (Realtime respects RLS). Votes are not published; ballot writes touch the voter row (R12).
- `events` policies are unchanged; the guard (§4) handles the new columns.

### 4. Write paths (RPCs)

| Function | Caller | Behavior |
|---|---|---|
| `create_poll_event(p_event jsonb, p_options jsonb, p_closes_at)` | authenticated (security definer; `host_id` = caller, other columns whitelisted from `p_event`) | Inserts the event with `starts_at = null` and 2–4 options in one transaction; returns event id + invite token |
| `set_poll_options(p_event_id, p_options jsonb, p_closes_at)` | manager | Replaces the option set. Options sent with an existing `id` and unchanged times keep their votes; changed or missing ones are deleted (cascade deletes their votes). Returns deleted vote count |
| `submit_votes(p_token, p_guest_token, p_display_name, p_votes jsonb)` | service_role (web route) | Upserts voter by `guest_token_hash` and replaces their ballot |
| `withdraw_votes(p_token, p_guest_token)` | service_role | Deletes the voter (cascade) |
| `vote_as_user(p_token, p_votes jsonb)` | authenticated | Same as `submit_votes` with profile name |
| `withdraw_votes_as_user(p_token)` | authenticated | Deletes the caller's voter row |
| `pick_poll_option(p_option_id)` | manager | §5, R2 |

The guard needs to stop hosts from bypassing these with direct writes: `events_guard` now rejects (a) inserting `starts_at = null` and (b) changing `starts_at`/`ends_at` while `old.starts_at is null`, unless the transaction-local setting `checkin.poll_rpc = 'on'` is set (only our RPCs `set_config` it). It also rejects setting `starts_at` back to null on a dated event, and does not stamp `time_changed_at` when `old.starts_at is null` (a pick is not a "time changed").

Ballot shape: `[{option_id, choice}]`; options omitted = unanswered. A ballot is accepted only if the event is pending, not cancelled, `poll_closes_at` is null or in the future, and every referenced option belongs to the event and starts in the future; otherwise the whole ballot is rejected (`poll_closed` / `option_passed`). Validation for candidate times (future, distinct, end > start, 2–4, deadline ≤ earliest start) lives in both the zod schema (fast feedback) and the RPC (authority).

**Edit-warning UX:** the host app already has every vote via RLS/Realtime, so it computes "N votes will be deleted" locally before calling `set_poll_options`; the RPC's returned count is used to confirm.

### 5. Picking and conversion

`pick_poll_option(option_id)` in one transaction, `security definer`, checks `is_event_manager`:
1. Lock the event row (`lock_event`, `for no key update` — the add-guest-capacity mutex); reject if cancelled (`event_closed`), already picked (`already_picked`), or the option starts ≤ now (`option_passed`).
2. Set `starts_at/ends_at` from the option, `date_picked_at = now()` (with `checkin.poll_rpc`).
3. Convert through `lock_open_event` + `save_rsvp_locked` in vote order: `yes → going` (0 plus-ones; waitlisted when it does not fit), `if_needed → maybe`, carrying `user_id`/`guest_token_hash`/`display_name` from the voter (R2). The 500 cap is guaranteed by the 500-voter cap.
4. Write `final_*` tallies on every option.
5. Enqueue `date_picked` (audience `user`) for every signed-in voter (R7), then delete all voters (cascade votes).

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
`voters` is non-null only when `guest_list_visible`, and includes only `yes`/`if_needed`. `expired` = every option passed. `voting_open` = not expired and deadline not passed. `poll.voter_count` is also returned. Picked events return the normal `active`/`past` states. `counts`/`guests`/`my_rsvp` are omitted for pending events. Built by `invite_payload` (R3), so `get_invite` and `get_my_invite` share it; `co_hosts` and `announcements` are included as for dated events.

### 7. Web and mobile

- **Web** (`apps/web/src/app/i/[token]`): `page.tsx` branches on `date_pending` and renders a new client component `poll-form.tsx` (three-state control per option, one name field shared with `rsvp-form.tsx`'s stored name via `lib/guest-device.ts`, "Save votes" posts the whole ballot; a 409 reloads the page). New `app/api/votes/route.ts` mirrors `api/rsvp/route.ts`; the rate-limit helper moved to `lib/rate-limit.ts` (`allowedWrite(req, token, ':votes')`), same limits. `generateMetadata`, `opengraph-image.tsx` and the story image use `t('polls.date_tbd_vote')` instead of `formatEventTime`. `calendar.ics/route.ts` returns 404 when pending (already, as the state is neither active nor past). `lib/invite.ts` `Invite` union gains the pending variant.
- **Mobile**: `event-form.tsx` gets a "Fixed date / Let guests vote" toggle; vote mode replaces the start/end `DateField`s with `components/poll-options-editor.tsx` (2–4 option rows, start + optional end, optional deadline). Defaults: two options (`defaultStart` and +1 day) so creating stays under 30 s. Create calls `create_poll_event` instead of the direct insert. `events/[id]/index.tsx` shows `components/poll-results.tsx` (live via Realtime on voters/options) with Pick (confirm: "2 will be Going, 1 on the waitlist and 0 Maybe" via `pickOutcome` with the capacity), Edit times (`events/[id]/poll.tsx`, "Delete N votes?" via `deletedVoteCount`), and remove-voter; the guest list is hidden while pending. `events/[id]/edit.tsx` hides start/end and saves only the other columns. `app/index.tsx` embeds `date_poll_voters(count)` and `date_poll_options(starts_at)`, orders `starts_at nulls first`, and renders "Date TBD" + "N voted" (+ "Pick a date" badge via `pollNeedsPick`). `i/[token].tsx` renders `components/poll-voting.tsx` and calls `vote_as_user` / `withdraw_votes_as_user` for signed-in users, "Vote in the browser" otherwise.
- **Shared**: `VOTE_CHOICES`, `makeDatePollInputSchema(now, {keepIds, previousClosesAt})`, `pollErrors`, `ballotInputSchema` in `schemas.ts`; `polls.ts` (`InvitePoll`/`MyVotes` types, `tally`, `leadingOptionId`, `pickOutcome`, `deletedVoteCount`, `pollNeedsPick`); `formatOption` in `dates.ts` (Europe/Stockholm by default); `hasEventEnded(null)` is false; sv/en strings under `polls.*` and new `errors.*`.

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
- [Two managers (owner/co-host) pick at the same time] → event lock + `already_picked` error; the second device shows the error and refreshes (concurrency test).
- [Guest votes from a stale page after the pick] → ballot rejected with `poll_closed`; page reloads to the picked date (spec scenario).
- [Voters who lost their cookie appear twice and convert into duplicate RSVPs] → same as RSVPs today: host can remove voters/guests.
- [Notifications capability absent or delayed] → design treats it as optional; invite page and host list are the source of truth.
- [Parallel changes (`add-co-hosts`, `add-guest-capacity`) MODIFY the same `private-events`/`event-rsvp` requirements] → the later-archived change must re-copy the current main-spec block before archiving.
- [Guest-capacity limit smaller than Yes voters] → resolved (R2): conversion goes through the capacity admission path; overflow is waitlisted in vote order.

## Migration Plan

1. One forward migration `20261108000020_date_polls.sql`: make `starts_at` nullable, add columns, enum, tables, RLS, Realtime publication, RPCs, the `date_picked` kind, and replace `events_guard`, `open_event_for_token`, `lock_open_event`, `invite_payload` (new signature), `get_invite`, `schedule_event_reminder`, `events_notify`, `rsvps_notify_digest` and `run_retention`. Existing rows all have `starts_at` so nothing is backfilled.
2. Deploy web before shipping the mobile build: the invite site must understand `date_pending` before any host can create a poll. Older mobile builds cannot create polls, and a host only has pending events once they run the new build.
3. Rollback: revert the web and mobile releases; reverting the migration additionally requires picking or deleting pending events first so `starts_at` can return to `not null`.

## Open Questions

- ~~Should a guest-capacity limit cap Yes→Going conversions?~~ Resolved: yes, overflow to the waitlist in vote order (R2).
- Exact copy for "Date TBD — vote now" in Swedish ("Datum ej bestämt — rösta nu" as placeholder).
