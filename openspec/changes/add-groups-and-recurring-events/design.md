# Design

## Context

See proposal.md for motivation. Relevant current state:

- **Events** (`events`) are standalone rows with a required `host_id`, readable through RLS only by managers (`is_event_manager`: owner + co-hosts). Guests reach an event only through security-definer RPCs: `get_invite` (by link token) and `get_my_invite` / `set_my_rsvp` / `list_my_invites` (by an RSVP linked to their account).
- **RSVPs** (`rsvps`) are per event and have an account identity (`user_id`), a browser identity (`guest_token_hash`) or both. Capacity and the waitlist go through `lock_open_event` / `save_rsvp_locked`. Promotion is trigger-based.
- **Co-hosts** live in `event_co_hosts` and `co_host_invites`: single-use 22-character tokens with a 7-day expiry.
- **Notifications** go through `enqueue_notification` (kinds in `notification_kinds`, payload merging for digests, quiet hours). A worker decides recipients at send time and is kicked every minute by pg_cron. `run_retention` runs hourly.
- **Mobile** uses Expo Router screens. `apps/web` serves `/i/[token]` and `/c/[token]`, and `plugins/with-app-links.js` declares the `/i/` and `/c/` app links.

## Goals / Non-Goals

**Goals:**
- Every date of a series is a plain `events` row, so RSVPs, capacity, wall, announcements, reminders, change and cancel notifications, and the invite page all work unchanged.
- Group-based access never weakens existing RLS. Members reach group events only through the same security-definer RPCs guests already use.
- Date creation is idempotent and safe to run concurrently (from cron and from series creation).

**Non-Goals:**
- No general recurrence engine (RRULE parsing, exceptions lists). Only the three rules in the spec.
- No change to how web guests RSVP.

## Decisions

### D1. Dates are materialized events, created ahead, not virtual
Each date is inserted as an `events` row with `series_id`, `occurrence_index` and `group_id` (the series' group), plus `unique (series_id, occurrence_index)`. Its `host_id` is the group's current owner (see D6).
- **Why:** every per-event feature (RSVP, wall, waitlist, notifications, retention) keys on `event_id`, so they all keep working without branching.
- **Outside guests:** each date keeps its own invite link and is the only way in for people outside the group. A single series-wide guest link was considered and rejected: one leaked link would reach every future date, and guests can simply be sent each date's link.
- **Alternative considered:** virtual dates expanded at read time. Rejected, because RSVPs and walls need a real row before anyone answers, and every RPC would need series awareness.

### D2. Rolling window of four upcoming dates
`ensure_series_dates(p_series_id, p_now)` (security definer) locks the series row. Then, while the series is not ended:
1. It counts its dates whose `event_ended_at > p_now`, cancelled dates included.
2. It inserts the next index, but only while that count is below 4, the next start is within 6 months and the start is on or before `ends_on`.

It runs at series creation and from a new pg_cron job, `series-dates`, every hour at minute 7. The job loops over active series that have fewer than 4 upcoming dates.
- **Why four dates:** members can plan about a month ahead for a weekly series and a season ahead for a monthly one. The lists group a series' dates into one item (see D10), so four dates do not clutter them.
- **Alternative considered:** two dates. Rejected because people want to know if they can come in a few weeks. A time window (for example 4 weeks) was also rejected, because monthly series would then show only one date.

### D3. Date computation in local wall-clock time
`event_series` stores:
- the rule: `frequency` (`weekly`, `biweekly` or `monthly`)
- `anchor_local_date`, `local_start_time`, `duration` (nullable) and `time_zone`
- `anchor_index`, the index of the date the current rule counts from

The start of index `k` is calculated by a pure SQL function, `series_date_start(series, k)`:
- **weekly / every 2 weeks:** `anchor_local_date + (k - anchor_index) * 7 or 14 days`
- **monthly:** take the month of the anchor date plus `k - anchor_index` months. In it, pick the n-th weekday (`n = ceil(day / 7)`), or the last such weekday when the anchor date is in the last 7 days of its month.

The result is `(local_date + local_start_time) at time zone time_zone`. This keeps the local time fixed across daylight-saving changes. It is tested with pgTAP over the October and March clock changes.

### D4. Re-anchoring when the rule changes
`update_series_rule` (group owner or admin) sets the new frequency, sets `anchor_local_date` to the local date of the series' last existing date and sets `anchor_index` to that date's index. Indexes after it then follow the new rule from there. Existing dates are not moved, as the spec requires. For monthly rules the weekday position is derived again from the new anchor date.

### D5. "This and following" edits
`update_series_from(p_event_id, p_patch jsonb)` (group owner or admin; a date-only co-host is rejected) updates the series template fields:
- title, description, location fields, time of day, duration, cover and theme
- guest list visibility, plus-ones, capacity and wall setting

It then updates every date of the series whose `starts_at >= ` the chosen date's start and that has not ended. A time-of-day change recalculates each date's `starts_at` from its own local date.
- **Why updating each `events` row:** the existing `events_guard` checks (no past start, ended-event lock) and the debounced change notification triggers run as normal, so guests are notified exactly as for a single edit.
- **Alternative considered:** dates inherit from the series at read time. Rejected, because that would need a second notification path.

Editing "this date only" is the existing event update and does not touch the series. A later "this and following" edit overwrites the earlier single-date changes on the dates it covers. That is expected, and the app's confirmation text says so.

### D6. Series belong to groups; group admins manage dates
- **Ownership:** `event_series.group_id` is `not null references groups on delete cascade`, and `events.series_id` is `references event_series on delete set null`. `delete_group` first cancels the upcoming dates of the group's series (sending the normal cancellation notices). Deleting the group then removes the series rows, and the past dates stay as plain events. A series has no owner column of its own. Each date's `host_id` is the group owner at the time, so the existing owner-only rules, link previews and retention keep working.
- **Managers:** `is_event_manager(event_id)` becomes owner, or co-host, or (the event has a `series_id` and `is_group_admin(series.group_id, uid)`). It stays a security-definer, stable SQL function, with an index on `events (series_id)`. Owner-only checks (`is_event_owner`) treat group admins of a series date as owners, except for `delete`, which stays `host_id = auth.uid()`.
- **Why extend `is_event_manager`:** admins can number more than the 5 co-host slots, and their rights must end the moment they are demoted or leave. Copying them in as co-hosts would break both.
- **Alternative considered:** series co-hosts copied into each date. Dropped once series belong to groups, because group admins already are the shared managers.
- **Ownership handover:** `hand_over_and_leave_group` and the account-deletion trigger update `host_id` on every date of the group's series, past and upcoming. They set a transaction-local flag that `events_guard` checks to allow this one change (otherwise `host_immutable` and the ended-event lock would block it). No change notification is sent.
- **Date co-hosts:** the existing per-date co-host feature keeps working on series dates. Those co-hosts can edit only their date.
- **Limit:** 10 active series per group, checked in `create_series` under the group row lock.

### D7. Groups data model
- `groups (id, owner_id → profiles, name, created_at)`. `owner_id` has no cascade: the deletion trigger below hands the group over or deletes it first.
- `group_members (group_id → groups cascade, user_id → profiles cascade, is_admin boolean not null default false, joined_at, primary key (group_id, user_id))`. The owner is inserted as a member. A trigger rejects removing the owner while the group exists. The owner's admin rights come from `groups.owner_id`, not from `is_admin`, so the owner can never be demoted.
- **Rights:** `is_group_admin(group_id, uid)` returns true for the owner or a member with `is_admin`. It is required for renaming, links, past-guest invitations, promoting members and removing regular members. Only the owner may demote an admin, remove an admin or delete the group. `remove_group_member` and `set_group_admin` reject the owner as a target.
- **Ownership handover:** `hand_over_and_leave_group(p_group_id, p_new_owner)` (owner only) locks the group row, checks that the new owner is a member and owns fewer than 20 groups, sets `owner_id`, clears the new owner's `is_admin` (the owner flag covers it), moves every date of the group's series to the new owner (D6), deletes the old owner's membership, and enqueues a `group_new_owner` push. `leave_group` rejects the owner with `owner_must_hand_over`.
- **Account deletion:** a `before delete` trigger on `profiles` passes each group the user owns, with its series and their dates, to the member with `is_admin` and the earliest `joined_at`, else the earliest member. The 20-group limit is skipped here so deletion never fails. Groups without another member are deleted. This keeps the right to erasure unconditional while groups survive their owner.
- `group_invitations (group_id, user_id, invited_by, created_at, expires_at, declined_at, primary key (group_id, user_id))`. A declined row stays until `created_at + 30 days`, so that re-inviting is silently suppressed.
- `group_invite_links (token primary key, group_id, created_at, revoked_at)`. A partial unique index on `group_id where revoked_at is null` allows one active link. The token is `generate_random_token(22)`.
- **Limits:** 20 owned groups; 50 members + pending invitations; 100 invitations per inviting user per 24 h via `hit_rate_limit`. They are checked in the RPCs under a `for update` lock on the group row.
- **RPCs (security definer, `search_path = ''`):**
  - `create_group`, `rename_group`, `delete_group` (owner only), `set_group_admin(p_group_id, p_user_id, p_admin)`
  - `create_group_link`, `revoke_group_link`, `get_group_link_preview` (name, owner name, member count), `join_group_by_link`
  - `invitable_past_guests(p_group_id)`, `invite_to_group(p_group_id, p_user_ids uuid[])`, `respond_group_invitation`
  - `leave_group`, `hand_over_and_leave_group`, `remove_group_member`, `list_my_groups`, `get_group`

### D8. Inviting a group to an event
- **Columns:** `events.group_id uuid references groups on delete set null`. For series dates it always equals the series' group and cannot be changed or cleared (`series_group_fixed`).
- **Who sets it on a one-off event:** only the event's owner, enforced in `events_guard`. A co-host changing `group_id` gets `owner_only`. The owner may only pick a group where `is_group_admin` is true for them; otherwise `not_group_admin`.
- **When rights end:** a trigger on `group_members` (delete, or `is_admin` set to false) clears `group_id` on that person's upcoming, non-cancelled one-off events for that group. Series dates are untouched. RSVPs already given are untouched.
- **Alternative considered:** keep the group on one-off events made while the person was an admin. Rejected, because a removed admin could keep pushing events to the group.
- **Access:** a member's access to the event is computed by the RPCs, not by RLS. `list_my_invites`, `get_my_invite` and `set_my_rsvp` accept an event when the caller has an RSVP for it, or when the event is upcoming, not cancelled and its `group_id` is a group the caller belongs to.
- **First answer:** when a member without an RSVP answers, `set_my_rsvp` creates the RSVP through `save_rsvp_locked`, so capacity and waitlist rules apply. The RSVP has `user_id` set and the display name taken from the profile.
- **Why:** members get the same guest view and permissions, and no new RLS policy on `events`. Group-only access ends when membership ends, while answered RSVPs keep giving access, as the spec requires.

### D9. Notifications
New `notification_kinds`, all push-only, since members are app users:
- **`group_invited`:** urgent no; recipient is the invited user, decided at send time; dropped if the invitation is no longer pending.
- **`group_new_owner`:** goes to the new owner after a handover or an automatic pass on account deletion. It mentions the group's series when it has any.
- **`group_joined`:** goes to the owner. The payload merges names within a 15-minute digest window, the same way the host reply digest already works.
- **`group_date_open`:** keyed to the event. At send time the recipients are the current group members, minus anyone with an RSVP, minus the event's managers (owner, co-hosts and, for a series date, the group's admins). Quiet hours apply.
- **`group_answer_reminder`:** scheduled when a group event is created (or gets a group) for `starts_at - 24 hours`, only if that is at least 24 hours after creation. Same recipient rule as `group_date_open`, checked at send time. Moving the event re-schedules it, the way the existing event reminder already works. Cancelling the event or removing the group drops it.

When a series is created, `ensure_series_dates` adds a `group_date_open` notification only for its first date. In later runs it adds one per new date. This gives one notice when a series is created. Templates in sv and en go in `packages/shared/src/notifications`.

### D10. App and web
- **Mobile, new screens:**
  - `app/groups/index.tsx`: the groups list with pending invitations
  - `app/groups/[id].tsx`: members with owner and admin marks, link, add from past guests, make or remove admin, leave/remove
  - `app/g/[token].tsx`: the join screen
- **Mobile, event form:** a "Repeat" row (Never, Weekly, Every 2 weeks, Monthly, plus an optional end date). Turning it on requires a group the user owns or administers, with "New group" inline. For one-off events, an optional "Invite a group" row.
- **Mobile and web, host display:** series dates show "Hosted by <group> · <owner name>". `get_invite` returns the group name for series dates only.
- **Mobile, editing a series date:** saving shows an action sheet: "This date" / "This and following".
- **Mobile, home list:** collapses each series to its next date and shows the rule text, for hosted series and for invites alike. A collapsed invite shows how many later dates are still unanswered. Invites without an answer show "Not answered yet".
- **Web:** `apps/web/app/g/[token]` renders the preview, with the same open-app hand-off as `/c/[token]`. `with-app-links.js` and the iOS associated domains add `/g/`.
- **Shared:** `formatRepeatRule(rule, anchor, locale)` in `packages/shared` gives text such as "Every Friday" / "Varje fredag" and "First Friday of the month" / "Första fredagen i månaden". There are also zod schemas for the series input.

### RLS for new tables
All writes go through security-definer RPCs. The policies below are for reads. Insert, update and delete are revoked from `anon` and `authenticated` on every new table.

| Table | Who can read |
|---|---|
| `groups` | Members only, via `is_group_member(id)` (security definer, stable). |
| `group_members` | Rows of groups the caller is a member of. |
| `group_invitations` | The invited user (own row), and the group owner and admins. |
| `group_invite_links` | The group owner and admins. Previews go through `get_group_link_preview(token)`, which anon and authenticated may call. It is rate limited, returns only name, owner name and member count, and gives the same `invalid` result for unknown and revoked tokens. |
| `event_series` | The group's owner and admins, via `is_group_admin(group_id, auth.uid())`. |

pgTAP covers each policy for owner, admin, member, invited user, former member, stranger and anon.

### Personal data and retention
- **What is new:** group names (free text from the owner), memberships (who is in which group, which reveals social ties), invitations (who invited whom) and series templates.
- **Lawful basis:** contract. Membership exists only after the person's own action: joining or accepting.
- **Who sees it:** group members only. Nothing about groups is shown on public pages beyond the name, owner name and member count, and only to someone who holds the link.
- **Retention:**
  - Memberships are deleted when a member leaves or is removed, or when either account is deleted (cascade).
  - Invitations are deleted on accept. Declined or expired ones are deleted by `run_retention` 30 days after creation.
  - Revoked group links are deleted after 30 days.
  - Groups and their series pass to another member when the owner leaves or deletes their account, and are deleted only when no other member is left.
  - Series dates follow the existing 12-month event retention. An ended series is deleted once its last date has been deleted.

## Risks / Trade-offs

- [The cron job is late or down, so a series has only one upcoming date] → It runs every hour and is idempotent. Opening a series in the app also calls `ensure_series_dates`. A pgTAP test covers catch-up after missed runs.
- [A "this and following" edit overwrites single-date tweaks without warning] → The confirmation text says that later dates take the new details. This is accepted for v1.
- [Many members get an unwanted push for every weekly date] → Members who already answered are skipped. Rate limits and quiet hours apply. A per-group mute is a follow-up if feedback asks for it.
- [Group-based access paths add complexity to `get_my_invite` and `set_my_rsvp`] → One helper, `can_see_event_as_guest(event_id, uid)`, is shared by all three RPCs and tested on its own.
- [Group size and joins could be used to spam] → Membership needs the person's own action, and there are size limits and rate limits. Declines are kept silently, so re-inviting someone who declined sends nothing.
- [Extending `is_event_manager` slows every RLS check] → Non-series events short-circuit on `series_id is null`; the series path is one indexed lookup plus `is_group_admin`. A pgTAP test asserts results for every fixture user, and an `explain` check runs on the guest-list query.
- [Timezone math bugs] → `series_date_start` is a pure SQL function with table-driven pgTAP tests around daylight-saving changes and month ends.

## Migration Plan

1. Migration A (groups): tables, RLS, RPCs, retention. Additive.
2. Migration B (series): `event_series`, `events.series_id`, `occurrence_index`, `group_id`, `ensure_series_dates`, the cron job, and the updated `is_event_manager`, `is_event_owner`, `events_guard`, `get_invite`, `list_my_invites`, `get_my_invite`, `set_my_rsvp` and `run_retention`.
3. Ship the app and web together. Older app builds ignore the new fields. Group invites are only visible in new builds, which is acceptable before launch.

Rollback: unschedule `series-dates`. The new columns are nullable, so the previous RPC versions can be restored from their migrations.
