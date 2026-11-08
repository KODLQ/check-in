# Tasks

## 1. Schema

- [ ] 1.1 Migration A: `alter type public.rsvp_status add value 'waitlisted'` in its own file; verify `supabase db reset` applies cleanly and existing pgTAP suite (`supabase test db`) still passes
- [ ] 1.2 Migration B (part 1): add `events.allow_plus_ones`, `max_plus_ones`, `capacity` and `rsvps.plus_ones`, `waitlisted_at`, `promoted_at` with the check constraints from design §2, plus `rsvps_waitlist_idx` and `event_going_heads()` helper; pgTAP `08_capacity.test.sql` asserts defaults on existing rows, each constraint rejects bad values (max 0/6, capacity 0, plus-ones on Maybe, waitlisted without `waitlisted_at`) and heads are computed as `1 + plus_ones`
- [ ] 1.3 Regenerate `packages/shared/src/database.types.ts` (`npm run db:types`) and add `headCount()` to `packages/shared`; verify Vitest covers Going-only counting with plus-ones and `npm run typecheck` passes in all workspaces

## 2. Admission, waitlist and promotion in Postgres

- [ ] 2.1 Implement internal `promote_from_waitlist(ev)` (order by `waitlisted_at, id`, skip-ahead, no-op on cancelled/ended, sets `promoted_at`) with execute revoked from public/anon/authenticated; pgTAP `09_waitlist.test.sql` covers in-order promotion, first-doesn't-fit skip, inactive event and grant checks
- [ ] 2.2 Implement internal `save_rsvp_locked(...)` (plus-one validation, `invalid_status` for `waitlisted`, Going vs waitlisted decision excluding own row, `capacity_exceeded` for Going guests increasing past spots, keep `waitlisted_at` on plus-one change, clear `promoted_at`, then promote); pgTAP covers every scenario in specs/event-capacity "Join waitlist when full", "Waitlist order and position", "Leave the waitlist" and specs/event-rsvp plus-one scenarios
- [ ] 2.3 Replace `upsert_rsvp` and `rsvp_as_user` with versions taking `p_plus_ones int default 0` that lock the event row `for no key update` then call `save_rsvp_locked`, returning `{status, display_name, plus_ones, waitlist_position, spots_left}`; drop old signatures and re-grant; pgTAP verifies 4-arg named calls still work, return payload, and existing `05_invite_functions` tests still pass
- [ ] 2.4 Replace `withdraw_rsvp` (lock + delete + promote) and add `remove_rsvp(p_rsvp_id)` (host or self only); drop the `"rsvps: host or self can delete"` policy; pgTAP covers withdraw/removal promoting the next guest, other users rejected, and direct `DELETE` on `rsvps` now affecting 0 rows for host and user
- [ ] 2.5 Add `promote_waitlisted(p_rsvp_id, p_over_capacity default false)` (host only, active event, `over_capacity` error unless confirmed); pgTAP covers out-of-order promotion keeping others' order, over-capacity confirmation, and non-host/anon rejection
- [ ] 2.6 Add `AFTER UPDATE` trigger on `events` for capacity/plus-one setting changes calling `promote_from_waitlist`; pgTAP covers raising capacity, clearing capacity (all promoted), lowering below Going (nobody removed, next Going waitlisted) and turning plus-ones off keeping existing plus-ones
- [ ] 2.7 Add `withdraw_all_rsvps_for_user(uid)` (locks events in id order) and call it from `supabase/functions/delete-account` before user deletion; add the waitlist sweep to `run_retention()`; pgTAP covers both, and a manual `supabase functions serve` run deletes a Going test user and promotes the waitlisted guest
- [ ] 2.8 Extend `get_invite` with plus-one settings, head-based `counts` (`going`, `maybe`, `waitlist`, `spots_left`, `full`), `plus_ones` in visible guests (waitlisted never listed) and `my_rsvp.plus_ones/waitlist_position/promoted`; pgTAP covers specs/event-rsvp "Guest list visibility" scenarios and "invite not found" equivalence unchanged
- [ ] 2.9 Concurrency test (Vitest against local Supabase, `supabase/tests/concurrency/capacity.test.ts`): 50 parallel `upsert_rsvp` Going calls on a 10-spot event give exactly 10 Going heads and 40 waitlisted; parallel withdraw + new Going on a full event gives the spot to the first waitlisted guest; verify `npm run test:concurrency` passes 20 consecutive runs with no deadlock errors

## 3. Shared validation and strings

- [ ] 3.1 Extend `makeEventInputSchema` with `allowPlusOnes`, `maxPlusOnes` (1–5) and optional `capacity` (1–3000) and `rsvpInputSchema` with `plusOnes` (0–5, default 0); Vitest covers valid/invalid bounds and defaults
- [ ] 3.2 Add sv/en i18n keys (plus-ones stepper, "Going +N", "Full — join waitlist", waitlist position, "You got a spot!", capacity/plus-one errors, host Waitlist group, Promote, over-capacity confirmation, "N / M going"); add a Vitest in `packages/shared` asserting sv and en have identical key sets and verify it passes

## 4. Web invite page

- [ ] 4.1 `/api/rsvp`: pass `plusOnes` to `upsert_rsvp`, map `capacity_exceeded` (409 with `spots_left`), `too_many_plus_ones`, `plus_ones_not_allowed`, `invalid_status` (400); extend `Invite` type in `lib/invite.ts`; Playwright API tests (`request` fixture) cover each error mapping
- [ ] 4.2 `rsvp-form.tsx` + `page.tsx`: plus-one stepper when allowed, "Full — join waitlist" Going label when full, answer line for "Going +N" / waitlist position / "You got a spot!", head-based going count and "+N" in visible guest list; Playwright covers RSVP with plus-ones, too many rejected, full event shows waitlist label and position
- [ ] 4.3 Playwright end-to-end: guest A takes the last spot, guest B joins waitlist (#1), A withdraws, B reloads and sees "You got a spot!" as Going; verify OG metadata snapshot is unchanged

## 5. Host app

- [ ] 5.1 `event-form.tsx`: collapsed "Guests" section with plus-ones switch + 1–5 stepper and optional capacity field, wired into create (`events/new.tsx`) and edit (`events/[id]/edit.tsx`); Jest + RNTL cover defaults off/unlimited, invalid values blocked, and values sent on submit
- [ ] 5.2 Guest list (`events/[id]/index.tsx`): "+N" per guest, head-based Going with "heads / capacity", Waitlist group ordered by `waitlisted_at`, Remove via `rpc('remove_rsvp')`, Promote via `rpc('promote_waitlisted')` with over-capacity confirm; Jest + RNTL cover grouping/labels, and an iOS Simulator check shows a promotion moving a guest live via Realtime
- [ ] 5.3 Host event list (`app/index.tsx`): select `rsvps(status, plus_ones)` and show head-based Going ("14 / 30 going" when capacity set); Jest + RNTL covers counts with plus-ones and capacity
- [ ] 5.4 In-app RSVP (`i/[token].tsx`): plus-one stepper, full/waitlist/promoted states and new error keys via `rsvp_as_user`; verify in the iOS Simulator as a signed-in user on a full event (waitlisted, then promoted after the host raises capacity)

## 6. Integration

- [ ] 6.1 Run `supabase test db`, workspace Vitest/Jest, Playwright and the concurrency suite together in CI; verify all green and `npx openspec validate add-guest-capacity --strict` passes
- [ ] 6.2 If `add-guest-updates` (`notifications`) is merged: add the `AFTER UPDATE` trigger on `rsvps` (waitlisted → going) that enqueues a "you got a spot" notification; pgTAP verifies one notification is enqueued per promotion and none for ordinary Going answers. Otherwise record it as deferred in the change notes

## Workflow follow-up

- Archive the change after review so `event-capacity` becomes a main spec and the `event-rsvp` / `private-events` deltas are merged.
