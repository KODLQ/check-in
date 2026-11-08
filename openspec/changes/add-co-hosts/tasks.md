# Tasks

## 1. Membership model and helpers (database)

- [ ] 1.1 Add migration with `generate_random_token(p_length)` (keep `generate_invite_token()` as 12-char wrapper), `event_co_hosts` and `co_host_invites` tables, indexes, the owner-is-not-co-host trigger and RLS enabled; verify with a new `supabase/tests/08_co_hosts.test.sql` pgTAP file asserting tables, PKs, cascades and that inserting the owner as co-host fails
- [ ] 1.2 Add `is_event_owner`, `is_event_co_host`, `is_event_manager`, `try_uuid` and redefine `is_event_host` as owner-only alias; verify with pgTAP that each returns the expected value for owner, co-host, stranger and anon, and that anon cannot execute them
- [ ] 1.3 Add a reusable pgTAP fixture (owner A, co-host B, stranger C, former co-host D, guest RSVP) in `supabase/tests/` and verify it loads in `supabase test db`

## 2. Policy changes on existing tables (database)

- [ ] 2.1 Replace `events` read/update policies with manager-aware versions (create/delete unchanged); verify with pgTAP that B can select and update, C and D get no rows, and B cannot delete
- [ ] 2.2 Update `events_guard` to reject `cancelled_at` changes by non-owners (`owner_only`) and to validate `cover_path` prefixes; verify with pgTAP that B cannot cancel or un-cancel, A can, B can set an `e/<event_id>/` cover, and B cannot set another user's folder path
- [ ] 2.3 Replace `event_invites` policies with `is_event_manager` and switch `regenerate_invite` to it; verify with pgTAP that B can read and regenerate, C and D get `not_found`, and existing RSVPs survive regeneration
- [ ] 2.4 Replace `rsvps` read/delete policies with `is_event_manager or self`; verify with pgTAP that B sees all statuses including declined and can delete a guest, C and D see nothing, and a signed-in guest still sees only their own row
- [ ] 2.5 Add the `covers` event-folder insert policy; extend `07_storage.test.sql` to verify A and B can upload to `e/<event_id>/`, C cannot, a malformed folder name is rejected without error, and own-folder rules are unchanged
- [ ] 2.6 Verify Realtime scoping manually: with the local stack, subscribe as B and C to `rsvps` for the event, RSVP as a guest, confirm only B receives it; remove B and confirm the next RSVP is not delivered to B (record result in the PR)

## 3. Co-host invite and membership RPCs (database)

- [ ] 3.1 Implement `create_co_host_invite` and `revoke_co_host_invite` (owner only, 5-slot limit counting pending links, row lock); verify with pgTAP: A creates, B and C rejected, sixth slot rejected with `co_host_limit`, revoked link frees a slot
- [ ] 3.2 Implement `get_co_host_invite` and `accept_co_host_invite`; verify with pgTAP: valid accept creates membership and consumes link, second user gets `invalid`, expired/revoked/cancelled/ended all return identical `invalid`, owner gets `owner`, existing co-host is a no-op that leaves link unused, missing display name rejected, full event rejected
- [ ] 3.3 Implement `leave_event`, `remove_co_host`, `list_event_hosts`; verify with pgTAP: B can leave, A can remove B, B cannot remove another co-host, C cannot list hosts, list order is owner then `added_at`
- [ ] 3.4 Add service-role-only `get_co_host_invite_preview`, extend `get_invite` with `co_hosts` names, and extend `run_retention` to purge co-host invites after 30 days; verify with pgTAP: `get_invite` lists co-host names in join order and nothing else about them, preview never returns location/time/guests, anon/authenticated cannot call preview, retention deletes old invite rows only
- [ ] 3.5 Regenerate shared DB types in `packages/shared` and verify `npm run typecheck` passes across workspaces

## 4. Account deletion

- [ ] 4.1 Update `supabase/functions/delete-account/index.ts` to remove `covers/e/<event_id>/` for owned events before deleting the user; verify with a local run: owner with a co-host deletes account → event, RSVPs, memberships and event-folder covers gone
- [ ] 4.2 Verify co-host deletion with a local run and a pgTAP cascade test: co-host B deletes account → B's membership removed, `accepted_by` nulled, A's event, RSVPs and `e/<event_id>/` cover intact, `get_invite` no longer lists B

## 5. Shared package

- [ ] 5.1 Add `formatHostNames(owner, coHosts, locale)` and sv/en strings (co-host label, invite/accept/leave/remove copy, limit and invalid-link errors, `owner_only`, `co_host_limit` error keys); verify with Vitest for 1, 2 and 3+ names in both languages

## 6. Mobile app – owner and co-host views

- [ ] 6.1 Event list: show "Co-host" label when `host_id` differs from the signed-in user; verify with a Jest/RNTL test rendering owned and co-hosted events, and manually in the iOS Simulator
- [ ] 6.2 Event detail: derive `isOwner`, hide Cancel and host management for co-hosts, add "Leave as co-host" with confirmation, and show "no longer a co-host" then navigate back when the event reload is empty; verify with an RNTL test for both roles and manually by removing a co-host while their screen is open
- [ ] 6.3 Owner "Hosts" section: list hosts, Invite co-host (create link → share sheet), pending links with Revoke, remove co-host, limit error; verify manually in the simulator end-to-end with two accounts and with an RNTL test for the limit message
- [ ] 6.4 Edit screen uploads covers to `e/<event_id>/`; map `owner_only` and `co_host_limit` in `errorKey`; verify by a co-host changing the cover in the simulator and with a unit test for `errorKey`

## 7. Accept flow (mobile + web)

- [ ] 7.1 Add mobile route `/c/[token]` with sign-in and onboarding redirect back to the link, accept screen (event title, owner name, "your name will be shown to guests"), and handling for invalid/owner/already-co-host/limit states; verify with an RNTL test per state and manually via `xcrun simctl openurl`
- [ ] 7.2 Add web page `/c/[token]` (open in app / store links, title + owner name only, generic invalid page, `noindex`) and add `/c/*` to the `.well-known` deep-link files; verify with a Playwright test that the page shows no location/time/guests and that invalid tokens render the same page as unknown ones
- [ ] 7.3 Invite page, `generateMetadata` and OG image render `formatHostNames`; verify with Playwright/snapshot that an event with a co-host shows "Hosted by Anna & Erik" and an event without co-hosts is unchanged

## 8. Integration check

- [ ] 8.1 Run the full `supabase test db`, web Playwright and mobile Jest suites and a manual two-device run (owner invites, co-host accepts, edits, regenerates link, removes guest, cannot cancel, leaves); verify all pass and record results in the PR
- [ ] 8.2 Check sibling changes that have landed (`add-guest-updates`, `add-event-wall`, `add-guest-capacity`, `add-date-polls`, `add-my-invites`) use `is_event_manager` for manager rights; verify by grepping migrations for `is_event_host`/`host_id = (select auth.uid())` and adding a co-host pgTAP case where missing
