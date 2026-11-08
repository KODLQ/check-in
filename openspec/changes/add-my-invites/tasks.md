# Tasks

## 1. Database: identity, tickets and claiming

- [ ] 1.1 Add migration `supabase/migrations/<ts>_my_invites.sql` that replaces `rsvps_one_identity` with `rsvps_has_identity`, creates `rsvp_claim_tickets` with RLS enabled and no client policies, and extends `run_retention` to purge used/expired tickets. Verify with new pgTAP `supabase/tests/08_my_invites.test.sql`: anon/authenticated cannot select/insert tickets; a row with both identities is accepted; a row with neither is rejected; retention deletes tickets once used or expired
- [ ] 1.2 Add `create_claim_ticket(p_guest_token)` granted to service_role only. Verify with pgTAP: returns a 22+ char ticket; only hashes are stored; it is not executable by anon/authenticated; short guest tokens are rejected
- [ ] 1.3 Add `claim_guest_rsvps(p_ticket)` with ticket locking, link/merge logic, skipping rows already owned by another account, and the per-account rate limit. Verify with pgTAP:
  - two guest RSVPs are claimed and get `user_id`, keeping `display_name` and `guest_token_hash`;
  - a newer guest answer wins the merge and an older one loses, with no duplicate left;
  - a reused, expired or unknown ticket raises the identical `invalid_ticket`;
  - claims of ended and cancelled events succeed;
  - an 11th attempt in an hour raises `rate_limited`;
  - anon is rejected
- [ ] 1.4 Change `rsvp_as_user` so updating an existing row changes only `status`. Verify with pgTAP: a claimed row named "Sara B" keeps that name after `rsvp_as_user`, and a first RSVP still uses the profile name. Existing `05_invite_functions` tests must still pass

## 2. Database: My invites read and write RPCs

- [ ] 2.1 Extract `get_invite`'s payload into an internal `invite_payload(ev, me)` function (not granted to clients) and make `get_invite` call it. Verify that `supabase test db` passes the unchanged `05_invite_functions.test.sql` and that pgTAP confirms anon/authenticated cannot execute `invite_payload`
- [ ] 2.2 Add `list_my_invites()`, returning only the caller's RSVP events (excluding events they host), with the state (`active`, `past` or `cancelled`), the host name and `my_rsvp`, and no invite token or `location_text`. Verify with pgTAP: user A sees only their own events; user B with no RSVPs gets `[]`; a hosted event with a self-RSVP is excluded; anon is rejected
- [ ] 2.3 Add `get_my_invite(p_event_id)` and `set_my_rsvp(p_event_id, p_status)`. Verify with pgTAP:
  - a non-respondent gets `not_found`, identical to a random uuid;
  - guest-list visibility follows `guest_list_visible`;
  - `set_my_rsvp` works after the link is revoked;
  - `set_my_rsvp` raises `event_closed` for cancelled or ended events;
  - `set_my_rsvp` updates the single row rather than inserting one;
  - a self-delete through RLS removes the row
- [ ] 2.4 Check that account deletion cascades: deleting a profile that owns claimed RSVPs on another host's event removes those rows. Verify with pgTAP, then regenerate `packages/shared/src/database.types.ts` and check that `npm run typecheck` passes

## 3. Web: post-RSVP prompt and hand-off

- [ ] 3.1 Add sv/en strings (`invite.plan_your_own`, `get_app.*`) to `packages/shared/src/i18n`, plus `NEXT_PUBLIC_APP_STORE_URL` and `NEXT_PUBLIC_PLAY_STORE_URL` to `apps/web/src/lib/env.ts` and `.env.example`. Verify that the shared i18n key-parity test or Vitest passes and that `next build` succeeds
- [ ] 3.2 Add `POST /api/claim-ticket`, which validates the guest token from the JSON body, applies the `ipHash:claim` rate limit (10 per 10 min) and calls `create_claim_ticket` with the service client. Verify with Playwright API tests: a 200 response returns a ticket; the 11th call returns 429; a GET or a malformed body is rejected
- [ ] 3.3 Render a `PlanYourOwn` card in `RsvpForm` when a response exists and remove the static footer line. Tapping the card POSTs to `/api/claim-ticket`, then navigates to `/get-app#t=<ticket>`. Verify with Playwright: the card is absent before an RSVP, present after one in both sv and en, and the RSVP buttons and withdraw link still work while it is shown
- [ ] 3.4 Add the `/get-app` page. It reads the ticket from `location.hash` and shows "Open the app" (`checkin://claim?t=`), the store links and in-app-browser guidance. Set `Referrer-Policy: no-referrer` and load no third-party assets. Verify with Playwright: the button href contains the ticket; the response header is set; and every network request recorded during the flow is free of the ticket and guest token in its URL and Referer

## 4. Mobile: claim deep link

- [ ] 4.1 Add the `app/claim.tsx` route outside the protected guards (plus `+native-intent.tsx` if needed) that stores `ci_pending_claim` in AsyncStorage and routes to sign-in, onboarding or redeem. Verify in the iOS Simulator with `xcrun simctl openurl booted "checkin://claim?t=..."` on both a cold and a warm start, signed out and signed in
- [ ] 4.2 Implement `usePendingClaim()` in `AuthProvider`. It calls `claim_guest_rsvps` once the user reaches the app area, clears the ticket on success and on `invalid_ticket`, drops tickets older than 24 hours, and shows the sv/en toast. Verify with Jest (mocked supabase): it redeems only in the app area, clears on terminal errors, keeps the ticket on network errors and skips stale tickets

## 5. Mobile: merged home list and invite details

- [ ] 5.1 Add `buildHomeSections(hosted, invites, now)` to `packages/shared`. Verify with Vitest: upcoming items are sorted ascending and past items descending; cancelled items stay in their time bucket with a flag; an event both hosted and invited appears once, as hosted
- [ ] 5.2 Update `apps/mobile/src/app/index.tsx` to load hosted events and `list_my_invites` in parallel and render hosted and invite cards (with the host name and your answer, plus Past and Cancelled badges). Retitle the screen to "Events". Verify with a Jest + RNTL test that renders mixed data, and check in the simulator that an invite card shows "Your answer: Maybe"
- [ ] 5.3 Add the `app/invites/[eventId].tsx` screen using `get_my_invite`, `set_my_rsvp` and a self-delete for withdrawing, with answer buttons hidden for past and cancelled events. Verify with Jest: the buttons call `set_my_rsvp`, they are hidden when the event is closed, and a withdrawal navigates back. In the simulator, check that changing the answer updates the host's live guest list on a second simulator or device
- [ ] 5.4 Add the empty-state nudge and the dismissible "Plan your own" card (dismissal kept for 7 days in AsyncStorage), both opening `/events/new`. Verify with Jest: the empty state renders the button; the card shows only when there are invites but no upcoming hosted events; dismissal hides it

## 6. End-to-end check

- [ ] 6.1 Run the whole flow on a local stack. RSVP on the web in the simulator's Safari, tap "Plan your own", open the app, sign in with a new magic-link account, complete onboarding, and confirm the invite appears with the web answer and name. Then change the answer in the app and confirm the web page in the same Safari shows the new answer. Record the result in the PR description
- [ ] 6.2 Run `supabase test db`, `npm test`, web Playwright and `npx openspec validate add-my-invites --strict`, and verify that all of them pass

## Workflow follow-up

- Archive the change after review, syncing the `my-invites` spec and the `event-rsvp`, `event-invites` and `user-accounts` deltas into `openspec/specs`.
