# Tasks

## 1. Database: schema and RLS

- [x] 1.1 Add migration `supabase/migrations/20261108000020_date_polls.sql`: make `events.starts_at` nullable, add `poll_closes_at`, `date_picked_at`, the `ends_at`-requires-start constraint, `vote_choice` enum, and `date_poll_options` / `date_poll_voters` / `date_poll_votes` tables with checks and unique constraints (design §1–2); verify `supabase db reset` applies cleanly and `database.types.ts` regenerates
- [x] 1.2 Add RLS policies (managers = owner + co-hosts via `is_event_manager`) and the `can_read_voter` helper for the three tables plus the Realtime publication entries (design §3, R1); verify with new `supabase/tests/20_date_polls_rls.test.sql` (pgTAP): owner/co-host reads/deletes, signed-in voter reads/deletes own row only, anon and other users get nothing, no direct insert/update for anyone
- [x] 1.3 Update `events_guard` (reject direct null-start insert, direct time edits on pending events, and un-dating a dated event unless `checkin.poll_rpc` is set; no `time_changed_at` on pick) and `event_ended_at` null handling; verify extended `02_events.test.sql` pgTAP cases pass and existing ones still pass

## 2. Database: host poll RPCs

- [x] 2.1 Implement `create_poll_event` with 2–4 options, future/distinct/end>start checks and deadline ≤ earliest option; verify pgTAP cases in `21_date_polls_options.test.sql` for each rejection (count, past option, duplicate, end before start, bad deadline) and that the invite token is created
- [x] 2.2 Implement `set_poll_options` (keep unchanged options' votes, delete changed/removed ones, return deleted vote count, allow deadline change/removal, reject when picked or cancelled, non-manager rejected); verify pgTAP cases in `21_date_polls_options.test.sql` including "adding an option keeps votes" and "removing an option with 3 votes returns 3"
- [x] 2.3 Implement `pick_poll_option` (event lock, past-option and already-picked rejection, set start/end and `date_picked_at`, yes→going / if_needed→maybe through `lock_open_event` + `save_rsvp_locked` in vote order so capacity overflow is waitlisted, no/unanswered → none, `final_*` tallies, delete voters, `date_picked` notification to signed-in voters, no digest/`event_changed`, reminder scheduled — design R2, R6); verify `22_date_polls_pick.test.sql` pgTAP including converted guest found by the same `guest_token_hash`, capacity overflow and non-manager rejection

## 3. Database: guest voting and invite read path

- [x] 3.1 Implement `submit_votes`, `withdraw_votes` (service_role only) and `vote_as_user` / `withdraw_votes_as_user` (authenticated) with name required, ballot validation, open/deadline/passed-option/cancelled rules and the 500-voter cap; verify `23_date_polls_votes.test.sql` pgTAP covering each rejection, change-not-duplicate, withdraw, and existing voters still allowed at the cap
- [x] 3.2 Extend `invite_payload` (shared by `get_invite`/`get_my_invite`) with the `date_pending` state and poll payload (tallies, `voters` only when `guest_list_visible` and only yes/if_needed, `my_votes`, `voting_open`, `expired`) and make `open_event_for_token` and `lock_open_event` raise `date_pending`; verify extended `05_invite_functions.test.sql` (No names never returned to guests; RSVP rejected while pending; picked event returns `active`)
- [x] 3.3 Extend `run_retention` (keeping every existing line) to delete pending events whose latest option is over 12 months old; verify a `06_lifecycle_limits.test.sql` pgTAP case

## 4. Shared package

- [x] 4.1 Add `VOTE_CHOICES`, `makeDatePollInputSchema(now)` and `ballotInputSchema` to `packages/shared/src/schemas.ts` with the same rules as the RPCs; verify Vitest cases in `schemas.test.ts` for counts, past, duplicate, end-before-start and deadline
- [x] 4.2 Add `formatOption` (Europe/Stockholm default) to `dates.ts` and sv/en strings (date TBD, vote now, yes/if needed/no, voting closed, not scheduled, delete-votes warning, pick confirm, error keys `poll_closed`, `option_passed`, `already_picked`, `date_pending`), the `date_picked` notification kind (kinds registry, template, pgTAP kinds list per notifications-worker/README) and `polls.ts` helpers (leading option, pick outcome, deleted-vote count, needs-pick); `buildHomeSections` handles null `starts_at`; verify Vitest for formatting, helpers, templates and the i18n key-parity test

## 5. Web invite site

- [x] 5.1 Add `app/api/votes/route.ts` (POST ballot, DELETE withdraw) reusing the RSVP rate-limit helper (moved to `lib/rate-limit.ts`) with a `:votes` bucket and mapping new error codes; map `date_pending` in `api/rsvp/route.ts`; verify route tests for 400/409/429 mappings (Playwright API tests in `e2e/date-polls.spec.ts` — the web app has no Vitest setup)
- [x] 5.2 Extend `lib/invite.ts` types and render the pending branch in `i/[token]/page.tsx` with a new `poll-form.tsx` (per-option Yes/If needed/No, shared stored name, save and withdraw, passed options disabled, closed/expired states, no RSVP or calendar links); verify Playwright: open pending invite → vote → change → withdraw, and closed-deadline view shows no controls
- [x] 5.3 Pending variants for `generateMetadata`, `opengraph-image.tsx` and the story image (`story/route.ts`, `invite-image-model.ts`) ("Date TBD — vote now", no tallies or names) and a 404 from `calendar.ics/route.ts`; verify Playwright OG metadata assertions, story/OG 200 and ics 404
- [x] 5.4 End-to-end pick flow against local Supabase: guest votes Yes in browser, host picks via RPC, reload shows picked date with the guest's Going RSVP and calendar links; verify Playwright test passes

## 6. Mobile host app

- [x] 6.1 Add "Fixed date / Let guests vote" mode to `components/event-form.tsx` with 2–4 option rows (start + optional end, default two options) and optional deadline, submitting via `create_poll_event`; verify Jest + RNTL tests for mode switch, validation messages and the submitted payload
- [x] 6.2 Poll results section in `app/events/[id]/index.tsx` (`components/poll-results.tsx`): live tallies and voter names via Realtime (voters + options channels), highlighted leading option, remove-voter, for owner and co-hosts; verify Jest render test with fixture data and in the iOS Simulator that a web vote appears within seconds
- [x] 6.3 Pick flow (confirm sheet with Going/waitlist/Maybe conversion counts, error handling for `option_passed`/`already_picked`) and Edit options screen (`app/events/[id]/poll.tsx`) with the "N votes will be deleted" confirmation; verify Jest tests for the warning count and in the Simulator that a pick updates the event to a normal dated event
- [x] 6.4 Host list in `app/index.tsx`: pending events first with "Date TBD · N voted" and a "pick a date" marker when closed or expired; `events/[id]/edit.tsx` hides start/end while pending; verify Jest list test and Simulator check
- [x] 6.5 In-app invite screen `app/i/[token].tsx` shows the poll and votes via `vote_as_user` (withdraw via `withdraw_votes_as_user`) for signed-in users; verify Jest test and Simulator check that the profile name is used

## 7. Integration checks

- [ ] 7.1 Run `supabase test db`, workspace Vitest, Jest and Playwright suites together and verify all pass; manually paste a pending invite link into iMessage/WhatsApp and verify the "Date TBD — vote now" preview with no address, tallies or names
  - Automated part done (pgTAP 759, Vitest 174, Jest 145, Deno 16, concurrency 9, Playwright 72 — all pass, incl. OG metadata/image assertions for pending invites). Left unchecked: the chat-app preview needs a publicly reachable invite URL and real iMessage/WhatsApp clients on a physical device.
