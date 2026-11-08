# Design

## Context

See proposal.md for why we are doing this. What exists today, and what shapes the approach:

**Database**
- `rsvps` has exactly one identity per row, enforced by `rsvps_one_identity`: either `user_id` (app RSVPs, written by `rsvp_as_user`) or `guest_token_hash` (web RSVPs, written by `upsert_rsvp` and `withdraw_rsvp`). It is unique on `(event_id, user_id)` and on `(event_id, guest_token_hash)`.
- RLS lets the host, and the row's own `user_id`, read and delete a row. There are no update policies; every write goes through security-definer functions.
- `events` RLS is host-only, so an invited user cannot select an event row. Guests see events only through `get_invite(token, guest_token?)`.
- `rsvp_as_user` currently overwrites `display_name` with the profile name on every upsert.

**Web**
- The invite page (`apps/web/src/app/i/[token]`) keeps the 128-bit guest token in the `ci_guest` cookie, with localStorage as a fallback.
- RSVP writes go through `/api/rsvp`. That route rate-limits per hashed IP via `hit_rate_limit` and calls the service-role RPCs.
- The footer shows a static "Plan your own with check-in" line.

**Mobile**
- The app uses the `checkin` scheme. Universal links cover `/i/*` (AASA).
- `i/[token].tsx` lets a signed-in user RSVP through `rsvp_as_user`.
- `index.tsx` lists only hosted events (`from('events')` under host RLS).
- The auth session is stored in AsyncStorage.

**Platform constraint:** iOS does not open a universal link when the user taps it on a page from the same domain, and in-app browsers (Instagram, Snapchat) often block custom schemes.

## Goals / Non-Goals

**Goals:**
- Claiming RSVPs requires possession of something only the guest's browser has. No new way to look up RSVPs by name, event or account.
- The secret used for the hand-off is never written to server logs (path or query) and never sent in a Referer header.
- Hosts' access to guest data is unchanged (the same rows and columns).
- Keep the read path for My invites to a single RPC with no N+1 queries.

**Non-Goals:**
- Deferred deep links through store install referrers, and third-party link services such as Branch or Firebase Dynamic Links.
- Claiming from the web without the app.
- Realtime updates of the My invites list. Pull-to-refresh and refresh on focus are enough.

## Decisions

### 1. Hand-off uses a single-use claim ticket in a URL fragment

**Flow**
1. The guest taps the CTA. The page `POST`s `{ guestToken }` in the request body to `/api/claim-ticket`.
2. The route rate-limits by IP (bucket `ipHash:claim`, 10 per 10 min) and calls `create_claim_ticket(p_guest_token)` with the service role.
3. That function generates a random 128-bit base64url ticket. It stores only `sha256(ticket)` together with `hash_guest_token(guest_token)` and `expires_at = now() + 24h`, then returns the ticket.
4. The page then navigates client-side to `/get-app#t=<ticket>`.
5. `/get-app` is a static page. A client component reads `location.hash` and renders:
   - "Open the app" → `checkin://claim?t=<ticket>`. A custom-scheme URL never reaches a server, so a query parameter is fine there.
   - App Store and Google Play links.
   - The hint "Installed the app? Come back here and tap Open the app."
6. The page sends `Referrer-Policy: no-referrer` and loads no third-party resources.

**Why a ticket instead of putting the raw guest token in the link:**
- The guest token is a long-lived credential that keeps working on the web. The ticket expires in 24 hours, can be used once, and can only claim. A leaked ticket is worth far less.
- Only hashes are stored, consistent with how guest tokens are handled.

**Why a fragment and not a query string:** fragments are never sent in HTTP requests or Referer headers, so Vercel and Supabase logs never see the ticket.

**Alternatives considered:**
- *Query string on an https URL:* lands in access logs. Rejected.
- *A short code the user types into the app:* worse UX, and it needs a lower-entropy code with stricter rate limits. Kept as a fallback idea (see Open Questions).
- *A universal link `/claim`:* iOS keeps same-domain taps in the browser, so it would not open the app from the invite page. Rejected.
- *Clipboard-based deferred deep link:* triggers the iOS paste prompt and is unreliable. Rejected.

### 2. App side: pending ticket, then redeem after sign-in

- New route `app/claim.tsx`. It is outside the `Protected` guards, like `i/[token]`.
- It validates the ticket format and saves `{ ticket, savedAt }` under `ci_pending_claim` in AsyncStorage. Then:
  - signed out → `router.replace('/sign-in')`
  - needs onboarding → `router.replace('/onboarding')`
  - otherwise it redeems straight away.
- A `usePendingClaim()` hook in `AuthProvider` watches for `accessArea === 'app'`. When a ticket is pending, it calls `claim_guest_rsvps(p_ticket)`, clears the stored ticket on any terminal result, and shows a toast:
  - "N invites added", or
  - "That link expired — open the invite page again".
- Stored tickets older than 24 hours are dropped without calling the server.
- If expo-router drops the query on cold start, use `+native-intent.tsx` to rewrite the URL. This is verified in task 4.1.

### 3. Data model changes

**`rsvps` identity constraint**
- Replace `rsvps_one_identity` with `rsvps_has_identity check (user_id is not null or guest_token_hash is not null)`.
- A claimed row keeps its `guest_token_hash`. That way the same browser keeps working through `upsert_rsvp` and `withdraw_rsvp`, as the modified "Change or withdraw RSVP" requirement says, and both unique constraints still prevent duplicates.

**New table `rsvp_claim_tickets`**

| Column | Type | Notes |
|---|---|---|
| `ticket_hash` | text PK | sha256 hex of the ticket |
| `guest_token_hash` | text not null | which browser's RSVPs it can claim |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | `created_at + 24h` |
| `used_at` | timestamptz null | set on redemption |

- **RLS:** enabled, with no policies for `anon` or `authenticated`. Only the security-definer functions reach the table, the same pattern as `rsvp_rate_limits`.

### 4. RPCs (all `security definer`, `set search_path = ''`)

**`create_claim_ticket(p_guest_token text) returns text`**
- Granted to `service_role` only.
- Rejects tokens shorter than 22 characters.

**`claim_guest_rsvps(p_ticket text) returns jsonb`** (granted to `authenticated`)
1. Requires `auth.uid()` and a profile with a display name.
2. Rate limit: `hit_rate_limit('claim:'||uid, 10, 3600)`. Over the limit raises `rate_limited`.
3. Locks the ticket row with `select ... for update` where `ticket_hash = sha256(p_ticket) and used_at is null and expires_at > now()`. If no row is found, raises `invalid_ticket` (the same error for unknown, used and expired tickets). Otherwise sets `used_at = now()`.
4. For each `rsvps` row `g` with `guest_token_hash = t.guest_token_hash and user_id is null`:
   - **If the account already has a row `a` on `g.event_id`:**
     - if `g.updated_at > a.updated_at`, update `a.status = g.status`;
     - delete `g`;
     - if `a.guest_token_hash` is null, set it to `g.guest_token_hash`, so this browser now edits the merged row.
   - **Otherwise:** `update g set user_id = uid`. `display_name` is left untouched.
5. Returns `{claimed: n, merged: m}`.

Rows with `user_id` already set to another account are skipped. Such a row can exist only if a browser's ticket was claimed by account A earlier; account B cannot steal it.

**`list_my_invites() returns jsonb`** (granted to `authenticated`)
- Selects from `rsvps r join events e join profiles host` where `r.user_id = auth.uid() and e.host_id <> auth.uid()`.
- Each item contains:
  - the event's `id`, `title`, `starts_at`, `ends_at`, `time_zone`, `cover_path` and `theme`;
  - the host's display name;
  - `state`: `cancelled`, `past` or `active`;
  - `my_rsvp` with `status` and `display_name`.
- It never returns the invite token or `location_text`. The detail RPC covers those.
- Ordering is done client-side, because we merge with hosted events anyway.

**`get_my_invite(p_event_id uuid) returns jsonb`**
- Returns the same payload shape as `get_invite`, but only when the caller has an `rsvps` row for that event. Otherwise it returns `{"state":"not_found"}`.
- For cancelled events it adds title, time and host (this user had already seen them).
- Implemented by extracting the body of `get_invite` into an internal `invite_payload(ev, me)` function that is not granted to clients, so the two cannot drift apart.

**`set_my_rsvp(p_event_id uuid, p_status rsvp_status) returns jsonb`**
- Updates the status of the caller's existing row only.
- Raises `not_found` when there is no row, and `event_closed` when the event is cancelled or has ended.
- Works whatever the state of the invite link, because the existing row is proof the user was invited.
- Withdrawing uses the existing RLS delete policy (`user_id = auth.uid()`). No new function is needed.

**`rsvp_as_user`:** `on conflict do update set status = excluded.status` only. `display_name` is no longer overwritten on update.

### 5. Home screen: merged list

`index.tsx` loads hosted events (the existing query) and `list_my_invites()` in parallel. It merges them through a pure function, `buildHomeSections(hosted, invites, now)`, in `packages/shared`:
- an **Upcoming** section, sorted by start time ascending;
- a **Past** section, sorted by start time descending;
- cancelled events stay in their time bucket with a "Cancelled" badge.

Each item carries `kind: 'hosted' | 'invite'`:
- **Hosted** items keep the Going/Maybe counts and open `/events/[id]`.
- **Invite** items show "Hosted by X · Your answer: Maybe" and open the new `/invites/[eventId]` screen, which uses `get_my_invite` and `set_my_rsvp`.

The screen title changes from "My events" to "Events" (sv: "Event").

**Nudges**
- An empty state with a "Plan your own in 30 seconds" button.
- A "Plan your own" card when there are upcoming invites but no upcoming hosted events. Dismissing it is remembered per device in AsyncStorage for 7 days.

### 6. Web CTA placement

- `RsvpForm` renders a `PlanYourOwn` card under the answer when `current` is set. The server page knows `my_rsvp`, so the card is not shown before a response.
- It replaces the static footer line.
- The store URLs come from new env values `NEXT_PUBLIC_APP_STORE_URL` and `NEXT_PUBLIC_PLAY_STORE_URL` (placeholders until the store listings exist).
- On desktop, `/get-app` shows the store links only.

### Personal data & retention

| Data | Lawful basis | Retention |
|---|---|---|
| Link between an RSVP and an account (`rsvps.user_id` on claimed rows) | Contract (the user asked to see their invites in their account) | Until the RSVP is withdrawn, the host removes it, the event is deleted (including 12-month auto-deletion), or the account is deleted (cascade) |
| `rsvp_claim_tickets` (hashed ticket, hashed guest token) | Legitimate interest (completing the hand-off the guest started) | Deleted by `run_retention` once used or expired, so at most about 25 hours |
| Hashed IP in the `ipHash:claim` rate-limit bucket | Legitimate interest (abuse prevention) | 24 hours (existing) |
| Card-dismissed flag and pending ticket (device AsyncStorage) | n/a (on device) | Ticket cleared on redemption or after 24 hours |

No new categories of personal data are introduced. Hosts get no new columns or rows. `rsvps.user_id` is already visible to hosts for app RSVPs, and the `guest_token_hash` they could already read gave the same cross-event linkability.

## Risks / Trade-offs

- **[In-app browsers block `checkin://`]** → `/get-app` shows "Open in Safari/Chrome" guidance when it detects the Instagram, Snapchat or TikTok webview user agent. The ticket survives in the fragment if the user copies the URL. Claiming is a bonus: RSVPs still work without it.
- **[A guest installs the app but never returns to the browser]** → the RSVPs stay as guest RSVPs, which is today's behaviour. Mitigated by the "come back here" hint. A typed code is a possible future fallback.
- **[A leaked ticket lets another account claim a guest's RSVPs]** → the window is short (24 hours, single use) and the ticket is never in logs or Referer. The original browser can still change or withdraw its responses, because the guest hash is kept. Impact: the attacker sees those events in their list. That is no more than anyone who could already open the invite link sees.
- **[A shared device: a friend's RSVPs from the same browser get claimed]** → the claim toast states the count. The user can withdraw any invite they don't recognise.
- **[A merge picks the "wrong" answer]** → the most recent `updated_at` wins, as specified. The user can change it in one tap.
- **[Hosts can read `rsvps.user_id` through RLS]** → not new: app RSVPs already expose it, and the guest-token hash gave equivalent linkability. The host UI selects only `display_name` and `status`. Restricting columns is left to a dedicated privacy change.
- **[`invite_payload` refactor regresses `get_invite`]** → the existing pgTAP tests in `05_invite_functions.test.sql` must pass unchanged before the new RPCs are added.

## Migration Plan

1. Ship one new migration, `2026111xxxxxxx_my_invites.sql`:
   - constraint swap;
   - new table;
   - new and changed functions;
   - `run_retention` update.

   The swap is backward-compatible, because every existing row already satisfies the looser check.
2. Deploy the web app. The CTA and `/get-app` page are harmless without the new app build: "Open the app" fails gracefully and the store links still work.
3. Release the app build with the `claim` route and the merged home list.
4. **Rollback:**
   - Revert the app and web deploys.
   - Leave the DB functions in place; they are unused without clients.
   - Restoring the stricter constraint would first require nulling `guest_token_hash` on rows where `user_id` is set.

## Open Questions

- Final App Store and Google Play URLs. They are env placeholders until the listings exist.
- Whether to later auto-link new web RSVPs from a browser whose ticket was already claimed. Deferred to after we measure claim rates.
- Whether a typed short code is needed as a fallback for guests who never return to the browser. Decide from claim-funnel data.
