# Proposal

## Why

Every invite exposes check-in to 10–50 guests, but today that exposure dead-ends: a guest RSVPs on the web, and if they later install the app, it only knows about events they host. Nothing in the app reflects that they were invited. We want guests to become hosts. That means the app has to be useful to a guest from the first launch, with their invites already there, and the guest should be asked to plan their own event at the moment they have just seen how easy RSVPing is.

## What Changes

- **My invites in the app**: a signed-in user sees the events they have answered (Going, Maybe or Can't go) through their account. These are listed together with the events they host. Upcoming events come first, and past and cancelled events are clearly marked. Each invite shows the user's own answer, and the user can change or withdraw it in the app while the event is open. Tapping an invite opens its details.
- **Claim web RSVPs into an account**: a guest who RSVPed on the web can hand their browser's RSVPs over to the app. The web invite page creates a short-lived, single-use claim code. The code goes to the app through a link whose secret part never reaches a server log or a Referer header. After sign-in, the app redeems the code and the RSVPs that browser made are linked to the account. Conflicts are merged so the account keeps a single RSVP per event with the most recent answer. Display names are kept. The same browser can still change those RSVPs, and hosts see nothing new.
- **Conversion prompts**: after a guest responds on the web, a non-blocking "Plan your own in 30 seconds →" prompt appears (Swedish/English). It leads to the app stores and to the claim hand-off. In the app, empty lists and invite-only lists nudge the user to create an event.
- **Account deletion** now also removes RSVPs that the account made or claimed.
- Signed-in users who change an existing answer in the app keep that RSVP's display name. Today it is overwritten with their profile name.

### Out of scope

- Signing in on the web, or any web account area. Claiming happens only in the app.
- Automatically linking future web RSVPs from a browser that has already claimed. Each new batch needs a new claim.
- Deferred deep linking through the app stores (for example, the install referrer). After installing, the guest returns to the browser page to open the app.
- Showing invites that were opened but never answered. There is no "seen" tracking.
- Friends graph, contact matching, and "people you know are going".
- Notifications and reminders about invites (owned by `add-guest-updates`).
- Any change to what hosts can see about their guests.

## Capabilities

### New Capabilities

- `my-invites`: The signed-in user's list of events they have answered through their account, shown next to hosted events, with their own answer, in-app answer changes, past/cancelled marking, and nudges to create an event.

### Modified Capabilities

- `event-rsvp`: Adds claiming of web RSVPs into an account (single-use code, conflict merge, identity after claiming, abuse limits). "Change or withdraw RSVP" now also covers responses that have been claimed.
- `event-invites`: Adds the post-RSVP "Plan your own" prompt and the privacy-preserving hand-off from the web invite page to the app.
- `user-accounts`: "Account deletion" also deletes the RSVPs the account made or claimed.

## Impact

- **Database** (new migration):
  - New table `rsvp_claim_tickets`.
  - `rsvps` identity constraint relaxed so a claimed row can hold both `user_id` and `guest_token_hash`.
  - New security-definer RPCs: `create_claim_ticket` (service role), `claim_guest_rsvps`, `list_my_invites`, `get_my_invite` and `set_my_rsvp` (authenticated).
  - `rsvp_as_user` stops overwriting `display_name` when it updates an existing row.
  - `run_retention` purges claim tickets.
  - New pgTAP tests for all of the above.
- **Web (`apps/web`)**:
  - New route `POST /api/claim-ticket`, rate-limited per IP.
  - Post-RSVP CTA on `/i/[token]`.
  - New `/get-app` hand-off page that reads the code from the URL fragment.
  - Store URLs added to the env config.
  - Playwright tests.
- **Mobile (`apps/mobile`)**:
  - `checkin://claim` deep-link route with the pending code held in AsyncStorage (already used for the auth session).
  - Redeem-after-sign-in flow.
  - Home screen merges hosted events and invites.
  - New invite detail screen keyed by event id, using the existing RSVP buttons.
  - Empty-state nudges.
  - Jest tests and simulator checks.
- **Shared (`packages/shared`)**:
  - New sv/en strings.
  - Regenerated `database.types.ts`.
  - Merge and sort helpers for the home list, with Vitest tests.
- **No new third-party dependencies.**
