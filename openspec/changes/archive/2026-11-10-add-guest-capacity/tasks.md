# Tasks

## 1. Schema

- [x] 1.1 Migration A: `alter type public.rsvp_status add value 'waitlisted'` in its own file; verify `supabase db reset` applies cleanly and existing pgTAP suite (`supabase test db`) still passes
- [x] 1.2 Migration B (part 1): add `events.allow_plus_ones`, `max_plus_ones`, `capacity` and `rsvps.plus_ones`, `waitlisted_at`, `promoted_at` with the check constraints from design §2, plus `rsvps_waitlist_idx` and `event_going_heads()` helper; pgTAP `18_capacity.test.sql` (08 is taken by add-guest-updates) asserts defaults on existing rows, each constraint rejects bad values (max 0/6, capacity 0, plus-ones on Maybe, waitlisted without `waitlisted_at`) and heads are computed as `1 + plus_ones`
- [x] 1.3 Regenerate `packages/shared/src/database.types.ts` (`npm run db:types`) and add `headCount()` to `packages/shared`; verify Vitest covers Going-only counting with plus-ones and `npm run typecheck` passes in all workspaces

## 2. Admission, waitlist and promotion in Postgres

- [x] 2.1 Implement internal `promote_from_waitlist(ev)` (order by `waitlisted_at, id`, skip-ahead, no-op on cancelled/ended, sets `promoted_at`) with execute revoked from public/anon/authenticated, run by the `rsvps`/`events` promotion triggers (design §11); pgTAP `19_waitlist.test.sql` covers in-order promotion, first-doesn't-fit skip, inactive event and grant checks
- [x] 2.2 Implement internal `save_rsvp_locked(...)` (plus-one validation, `invalid_status` for `waitlisted`, Going vs waitlisted decision excluding own row, `capacity_exceeded` for Going guests increasing past spots, keep `waitlisted_at` on plus-one change, clear `promoted_at`, then promote); pgTAP covers every scenario in specs/event-capacity "Join waitlist when full", "Waitlist order and position", "Leave the waitlist" and specs/event-rsvp plus-one scenarios
- [x] 2.3 Replace `upsert_rsvp`, `rsvp_as_user` and `set_my_rsvp` with versions taking `p_plus_ones int default null` (null = keep, design §11) that lock the event row `for no key update` then call `save_rsvp_locked`, returning `{status, display_name, plus_ones, waitlist_position, spots_left}`; drop old signatures and re-grant; pgTAP verifies 4-arg named calls still work, return payload, and existing `05_invite_functions` tests still pass
- [x] 2.4 Replace `withdraw_rsvp` (lock + delete + promote) and add `remove_rsvp(p_rsvp_id)` (owner, co-host or self only); drop the `"rsvps: manager or self can delete"` policy; pgTAP covers withdraw/removal promoting the next guest, other users rejected, and direct `DELETE` on `rsvps` now affecting 0 rows for host and user
- [x] 2.5 Add `promote_waitlisted(p_rsvp_id, p_over_capacity default false)` (owner or co-host only, active event, `over_capacity` error unless confirmed); pgTAP covers out-of-order promotion keeping others' order, over-capacity confirmation, and non-host/anon rejection
- [x] 2.6 Add `AFTER UPDATE OF capacity` trigger on `events` calling `promote_from_waitlist` (plus-one settings never free spots); pgTAP covers raising capacity, clearing capacity (all promoted), lowering below Going (nobody removed, next Going waitlisted) and turning plus-ones off keeping existing plus-ones
- [x] 2.7 Account deletion promotes: a `profiles` `BEFORE DELETE` trigger locks the user's answered events in id order before the cascade (replaces `withdraw_all_rsvps_for_user`, so `delete-account` needs no change, design §11); claim merges in `claim_guest_rsvps` lock and promote too; add the waitlist sweep to `run_retention()` keeping every earlier line; pgTAP covers deletion, claim merges and the sweep, and a manual `supabase functions serve` run deletes a Going test user and promotes the waitlisted guest
- [x] 2.8 Extend `get_invite` with plus-one settings, head-based `counts` (`going`, `maybe`, `waitlist`, `spots_left`, `full`), `plus_ones` in visible guests (waitlisted never listed) and `my_rsvp.plus_ones/waitlist_position/promoted`; pgTAP covers specs/event-rsvp "Guest list visibility" scenarios and "invite not found" equivalence unchanged
- [x] 2.9 Concurrency test (Vitest against local Supabase, `supabase/tests/concurrency/capacity.test.ts`): 50 parallel `upsert_rsvp` Going calls on a 10-spot event give exactly 10 Going heads and 40 waitlisted; parallel withdraw + new Going on a full event gives the spot to the first waitlisted guest; verify `npm run test:concurrency` passes 20 consecutive runs with no deadlock errors

## 3. Shared validation and strings

- [x] 3.1 Extend `makeEventInputSchema` with `allowPlusOnes`, `maxPlusOnes` (1–5) and optional `capacity` (1–3000, null = no limit) and `rsvpInputSchema` with optional `plusOnes` (0–5, omitted = keep); Vitest covers valid/invalid bounds and defaults
- [x] 3.2 Add sv/en i18n keys (plus-ones stepper, "Going +N", "Full — join waitlist", waitlist position, "You got a spot!", capacity/plus-one errors, host Waitlist group, Promote, over-capacity confirmation, "N / M going"); add a Vitest in `packages/shared` asserting sv and en have identical key sets and verify it passes

## 4. Web invite page

- [x] 4.1 `/api/rsvp`: pass `plusOnes` to `upsert_rsvp`, map `capacity_exceeded` (409 with `spots_left`), `too_many_plus_ones`, `plus_ones_not_allowed`, `invalid_status` (400); extend `Invite` type in `lib/invite.ts`; Playwright API tests (`request` fixture) cover each error mapping
- [x] 4.2 `rsvp-form.tsx` + `page.tsx`: plus-one stepper when allowed, "Full — join waitlist" Going label when full, answer line for "Going +N" / waitlist position / "You got a spot!", head-based going count and "+N" in visible guest list; Playwright covers RSVP with plus-ones, too many rejected, full event shows waitlist label and position
- [x] 4.3 Playwright end-to-end: guest A takes the last spot, guest B joins waitlist (#1), A withdraws, B reloads and sees "You got a spot!" as Going; verify OG metadata snapshot is unchanged

## 5. Host app

- [x] 5.1 `event-form.tsx`: collapsed "Guests" section with plus-ones switch + 1–5 stepper and optional capacity field, wired into create (`events/new.tsx`) and edit (`events/[id]/edit.tsx`); Jest + RNTL cover defaults off/unlimited, invalid values blocked, and values sent on submit
- [x] 5.2 Guest list (`events/[id]/index.tsx`): "+N" per guest, head-based Going with "heads / capacity", Waitlist group ordered by `waitlisted_at`, Remove via `rpc('remove_rsvp')`, Promote via `rpc('promote_waitlisted')` with over-capacity confirm; Jest + RNTL cover grouping/labels, and an iOS Simulator check shows a promotion moving a guest live via Realtime
- [x] 5.3 Host event list (`app/index.tsx`): select `rsvps(status, plus_ones)` and show head-based Going ("14 / 30 going" when capacity set); Jest + RNTL covers counts with plus-ones and capacity
- [x] 5.4 In-app RSVP (`i/[token].tsx`): plus-one stepper, full/waitlist/promoted states and new error keys via `rsvp_as_user`; verify in the iOS Simulator as a signed-in user on a full event (waitlisted, then promoted after the host raises capacity)

## 6. Integration

- [x] 6.1 Run `supabase test db`, workspace Vitest/Jest, Playwright and the concurrency suite together in CI; verify all green and `npx openspec validate add-guest-capacity --strict` passes
- [x] 6.2 `notifications` (add-guest-updates) is merged: add the `waitlist_promoted` kind (migration, shared `NOTIFICATION_KINDS`, sv/en templates, 08 registry test) and the `AFTER UPDATE` trigger on `rsvps` (waitlisted → going with `promoted_at`) that enqueues it for that RSVP; skip promotions in the host reply digest and drop it when the guest is no longer Going at send time; pgTAP verifies one notification per promotion, none for ordinary Going answers or the digest, and Playwright verifies one email to an opted-in promoted web guest via the worker and Mailpit

## Workflow follow-up

- Archive the change after review so `event-capacity` becomes a main spec and the `event-rsvp` / `private-events` deltas are merged.
