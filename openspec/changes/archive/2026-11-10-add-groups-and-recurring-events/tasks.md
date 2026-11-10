# Tasks

## 1. Groups schema and access (database)

- [x] 1.1 Add migration with `groups`, `group_members` (with `is_admin`), `group_invitations`, `group_invite_links`, the owner-membership trigger, indexes, `is_group_member`/`is_group_admin` and RLS read policies (D7, RLS table); verify with new `supabase/tests/27_groups_schema.test.sql` asserting tables, cascades, one-active-link index, owner cannot be removed, `is_group_admin` for owner/admin/member/stranger, and read policies for owner, admin, member, invited user, former member, stranger and anon
- [x] 1.2 Add a pgTAP fixture `fixtures/groups.psql` (owner A, admin B, member C, invited D, stranger E, a past event of A with an account-linked guest F and a web-only guest) and verify it loads in `supabase test db`

## 2. Group RPCs (database)

- [x] 2.1 Implement `create_group`, `rename_group`, `delete_group`, `list_my_groups`, `get_group` with name validation and the 20-group limit; verify in `28_group_functions.test.sql`: owner and admin can rename, member cannot, only owner can delete, 21st group rejected, non-member `get_group` returns not found
- [x] 2.2 Implement `set_group_admin`; verify with pgTAP: owner and admins can promote members, only the owner can demote an admin, admin demoting another admin is rejected, nobody can target the owner, regular members are rejected, `get_group` marks owner and admins
- [x] 2.3 Implement `create_group_link`, `revoke_group_link`, `get_group_link_preview`, `join_group_by_link` with the 50-member limit under a row lock and rate limits (owner or admin manages the link); verify with pgTAP: member cannot create or revoke the link, preview returns only name/owner/count, revoked and unknown tokens give the same `invalid`, rejoin is a no-op, 51st join rejected
- [x] 2.4 Implement `invitable_past_guests`, `invite_to_group` (owner or admin, from their own events; 100/24 h per inviter, silent suppression after decline, pending counts toward limit) and `respond_group_invitation`; verify with pgTAP: admin sees guests of their own events only, member is rejected, web-only guests excluded, members and pending excluded, accept adds member, decline hides invitation, re-invite after decline sends nothing, expired invitation cannot be accepted
- [x] 2.5 Implement `leave_group` and `remove_group_member`, and extend `run_retention` for invitations and revoked links; verify with pgTAP: owner cannot leave through `leave_group`, member and admin can, owner removes a member or admin, admin removes a regular member but not another admin, nobody removes the owner, retention deletes 30-day-old declined/expired invitations and revoked links only
- [x] 2.6 Implement `hand_over_and_leave_group(p_group_id, p_new_owner)` and automatic ownership passing on account deletion (longest-standing admin, else member, else delete; 20-group limit skipped for the automatic case); verify with pgTAP: new owner gets owner rights and the old owner is gone, leaving without a new owner is rejected, a sole owner can only delete, a new owner at 20 groups is rejected, deleting an owner's account passes the group to the earliest admin, then the earliest member, and deletes a sole-member group
- [x] 2.7 Regenerate shared DB types in `packages/shared` and verify `npm run typecheck` passes across workspaces

## 3. Series schema and date generation (database)

- [x] 3.1 Add migration with `event_series` (required `group_id`, cascade), `events.series_id` (set null)/`occurrence_index`/`group_id`, unique `(series_id, occurrence_index)`, index on `events (series_id)` and RLS via `is_group_admin`; verify in `29_series_schema.test.sql`: series readable by group owner and admin, not by member, stranger or anon; deleting a group removes its series and keeps past dates as plain events
- [x] 3.2 Implement pure `series_date_start(series, k)` for weekly, every 2 weeks and monthly (n-th and last weekday) in local time (D3); verify with table-driven pgTAP: first Friday 6 Nov → 4 Dec, last Thursday 26 Nov → 31 Dec, 17:00 Europe/Stockholm kept across the March and October clock changes
- [x] 3.3 Implement `ensure_series_dates` with row lock, four-upcoming window, 6-month horizon and end date, creating dates with the group owner as `host_id` and the series' `group_id` (D2, D6); verify with pgTAP: creation makes 4 dates, a monthly series stops at the 6-month horizon, a date ending yields the next, cancelled dates count, concurrent calls create no duplicates, ended series creates nothing, missed runs catch up
- [x] 3.4 Implement `create_series(p_group_id, …)` (group owner or admin only, 10 active series per group, rejects date-poll input) and schedule the `series-dates` cron job; verify with pgTAP that an admin gets the first date's event id and invite link, a regular member is rejected, the 11th series in a group is rejected, and the job is registered

## 4. Series editing and ending (database)

- [x] 4.1 Implement `update_series_from` for "this and following" (D5) through ordinary `events` updates, for group owner and admins only; verify with pgTAP: a date-only co-host is rejected, location change applies to the chosen and later dates only, time-of-day change keeps each date's local day, guests get one debounced change notification per date, ended dates untouched
- [x] 4.2 Implement `update_series_rule` (re-anchoring per D4) and `end_series` (keep or cancel upcoming) for group owner and admins, and make `delete_group` cancel upcoming series dates first; verify with pgTAP: regular member and date-only co-host rejected, admin allowed, deleting the group cancels upcoming dates with notices and keeps past dates, weekly→every 2 weeks keeps existing dates and spaces the next one 14 days after the last, ending with cancel triggers cancellation notifications, ending with keep creates no more dates

## 5. Group admins manage series dates (database)

- [x] 5.1 Extend `is_event_manager` and `is_event_owner` with the group-admin path for series dates (delete stays host-only) (D6); verify with pgTAP: admin B reads and edits a series date, sees its full guest list and can cancel it, cannot delete it; demoting or removing B ends access immediately; one-off events are unchanged for every fixture user
- [x] 5.2 Move series dates to the new owner in `hand_over_and_leave_group` and in the account-deletion trigger, using a transaction-local flag honoured by `events_guard` (D6); verify with pgTAP: after handover every past and upcoming date has the new `host_id` with RSVPs, walls and links intact and no change notification; a normal `host_id` update is still rejected
- [x] 5.3 Show the group as host in `get_invite` and link previews for series dates; verify with pgTAP that the payload has the group name and owner name for a series date and no group for a one-off event

## 6. Group events for members (database)

- [x] 6.1 Add `can_see_event_as_guest(event_id, uid)` and owner-only `group_id` changes in `events_guard` requiring `is_group_admin` (D8); verify with pgTAP: member sees upcoming non-cancelled group event, former member and stranger do not, co-host changing `group_id` gets `owner_only`, admin B can set the group on B's event, member C gets `not_group_admin`
- [x] 6.2 Add the `group_members` trigger that clears `group_id` on a person's upcoming one-off events when they stop being owner or admin, and reject changing or clearing `group_id` on series dates (D8); verify with pgTAP: demoting B removes the group from B's upcoming one-off party, the group's series dates keep it, members' existing RSVPs are unchanged, clearing a series date's group gets `series_group_fixed`
- [x] 6.3 Update `list_my_invites`, `get_my_invite` and `set_my_rsvp` to include group events and create a first RSVP through `save_rsvp_locked`; verify with pgTAP: "Not answered yet" item listed, first Going answer creates an account RSVP with profile name, full event waitlists the member, withdraw returns it to not answered, left member loses unanswered access but keeps answered events
- [x] 6.4 Add the not-answered member count and a member/guest flag per RSVP to the manager event payload; verify with pgTAP that a 12-member group with 5 answers reports 7, and that a web guest answering a series date by link is flagged as guest, gets no group membership and no access to other dates

## 7. Notifications

- [x] 7.1 Add `group_invited`, `group_joined` (15-minute digest), `group_new_owner` and `group_date_open` kinds with send-time recipient resolution in the worker (D9); verify with pgTAP and the edge-function tests: answered members, owner and co-hosts excluded, a member answering during quiet hours gets nothing, two joins within 5 minutes give one owner notice
- [x] 7.2 Enqueue `group_date_open` from event creation with a group and from `ensure_series_dates` (one notice for a new series); verify with pgTAP that creating a four-date series enqueues exactly one notice
- [x] 7.3 Add `group_answer_reminder` scheduled for 24 h before group events (skipped for short notice, re-scheduled on time change, dropped on cancel or group removal); verify with pgTAP: unanswered member gets it, answered member does not, an event created 10 h ahead schedules none, moving the event moves the reminder
- [x] 7.4 Add sv/en templates and `formatRepeatRule` to `packages/shared` with zod schemas for series input; verify with vitest for every rule in both languages ("Varje fredag", "Första fredagen i månaden", "Sista torsdagen i månaden")

## 8. Mobile: groups

- [x] 8.1 Add `app/groups/index.tsx` (my groups, pending invitations with Accept/Decline) and an entry point from the home header; verify with a Jest screen test for list, accept and decline
- [x] 8.2 Add `app/groups/[id].tsx` (members with owner/admin marks, share/revoke link and rename for owner and admins, make admin for owner and admins, demote admin and remove admin for owner only, delete for owner only, leave/remove with confirmations, and an owner Leave flow that requires picking a new owner, admins first, or offers only Delete when alone); verify with Jest tests that admin actions are hidden for members, demote/remove-admin and delete are hidden for admins, and the owner cannot leave without picking someone
- [x] 8.3 Add "Add from past guests" picker calling `invitable_past_guests`/`invite_to_group`; verify with a Jest test that selected users are sent and the rate-limit error is shown
- [x] 8.4 Add `app/g/[token].tsx` join screen with sign-in return, and add `/g/` to `with-app-links.js` and iOS associated domains; verify with a Jest test for join, already-member and invalid states

## 9. Mobile: series and group events

- [x] 9.1 Add "Repeat" (Never, Weekly, Every 2 weeks, Monthly, optional end date) to the event form, requiring a group the user owns or administers with inline "New group", plus an optional "Invite a group" row for one-off events; hide repeat for date polls; verify with Jest tests in `event-form.test.tsx` that repeat is hidden with candidate times, a user without groups is offered to create one, and `create_series` gets the chosen group
- [x] 9.2 Add the "This date / This and following" action sheet on save when editing a series date, and "Repeat settings" and "End series" (keep/cancel upcoming) for the group's owner and admins; show "Hosted by <group> · <owner>"; verify with Jest tests that each choice calls the right RPC and date-only co-hosts see neither the sheet nor the series actions
- [x] 9.3 Show series items in the home list for hosted series and invites (next date, rule text, counts, "N more dates not answered") with a series screen listing every upcoming date, and "Not answered yet" group invites; show the not-answered count on the manager view; verify with updates to `home-list.test.tsx` and `co-host-event.test.tsx`
- [x] 9.4 Allow the first answer on group invites in `invites/[eventId].tsx` and show the series rule plus a "Next date" link; verify with `my-invite-screen.test.tsx` cases for first answer and withdraw back to not answered
- [x] 9.5 Show the group's series on the group screen (next date, rule, "New series" for owner and admins) and, in the owner's Leave flow, preselect the longest-standing admin, else member, mentioning that the series moves too; verify with Jest tests for the series list and the preselected new owner

## 10. Web

- [x] 10.1 Add `apps/web/app/g/[token]` page (group name, owner, member count, open/get app, no join on web) with no-index headers; verify with a Playwright test for valid, revoked and unknown tokens
- [x] 10.2 Show the repeat rule, "Hosted by <group> · <owner>" and a link to the next date on series invite pages, with RSVP working for guests without an account; verify with a Playwright test on a seeded weekly series where a signed-out guest answers Going

## 11. Integration checks

- [x] 11.1 Run the whole suite (eslint, tsc, Jest, vitest, pgTAP, edge functions, concurrency, Playwright) and verify all pass
- [x] 11.2 Click through on the iPhone simulator and Android emulator: create a group, join by link from a second account, create a weekly series inviting it, answer as the member, edit "this and following", end the series; record results

## Workflow follow-up

- Sync the delta specs into `openspec/specs` and archive the change after review.
