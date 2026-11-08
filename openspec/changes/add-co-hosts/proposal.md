# Proposal

## Why

Parties and meetups are usually organised by two or three friends together, but today exactly one account (`events.host_id`) can manage an event, so the others can't fix a typo, see who's coming or remove a spam RSVP. Letting the host add co-hosts makes the app fit how events are actually organised and puts the event in more organisers' apps, which spreads the app without gating guests.

## What Changes

- New: the owner (the account that created the event) can create a **single-use co-host invite link** (unguessable, expires after 7 days, revocable) and send it privately. Opening it in the app while signed in and accepting makes that person a co-host. Max **5 co-hosts** per event.
- New: a clear **owner / co-host permission matrix**:
  - Owner and co-hosts: edit event details and cover, share the invite link, regenerate the invite link, see the full live guest list including Can't go, remove guests, toggle guest-list visibility.
  - Owner only: cancel the event, delete the event, invite / remove co-hosts, revoke co-host invite links.
- New: a co-host can **leave**; the owner can **remove** a co-host. Both take effect immediately, including for the live guest list.
- Changed: co-hosted events appear in the co-host's event list with a **"Co-host"** label.
- Changed: the invite page shows **"Hosted by Anna & Erik"** — owner first, then co-hosts in the order they joined.
- Changed: account deletion of a **co-host** removes only their co-host memberships (the events stay); account deletion of the **owner** deletes the event as today, for everyone including its co-hosts.
- Changed (security, internal): every host-only authorization check (`host_id = auth.uid()` / `is_event_host`) on events, invite links, RSVPs, storage and Realtime becomes membership-aware, with owner-only checks kept where the matrix says so. Guests and non-members gain no access.
- Integration points with sibling changes (not specified here): co-hosts should be able to post announcements (`add-guest-updates`) and moderate the wall (`add-event-wall`); both should authorize with the same "event manager" check this change introduces.

**Out of scope:**
- Transferring ownership to a co-host.
- Roles beyond owner and co-host (e.g. read-only helpers, door staff, per-permission toggles).
- Co-hosts without an account, or accepting a co-host invite on the web.
- Inviting co-hosts by username/search/contacts (only via link).
- Notifying the owner when a co-host accepts or leaves (could later use `add-guest-updates` notifications).
- Co-host avatars on the invite page (only the owner's avatar is shown, as today).

## Capabilities

### New Capabilities
- `co-hosts`: co-host invite links, acceptance, limits, leaving and removal, the owner/co-host permission matrix, and how co-hosts are displayed to guests.

### Modified Capabilities
- `private-events`: Events are private by default (co-hosts can see it), Edit event (co-hosts can edit), Cancel event (owner only), Host event list (co-hosted events with a "Co-host" label).
- `event-rsvp`: Host guest list and Remove guest (owner and co-hosts), Guest list visibility (co-hosts may toggle and see Can't go).
- `event-invites`: Share from the app and Revoke and regenerate link (owner and co-hosts), Web invite page (shows all host names, owner first).
- `user-accounts`: Account deletion (co-host membership removed; owned events deleted, including for co-hosts).
- `event-announcements`: Post announcement and Delete announcement (owner and co-hosts).
- `my-invites`: Invites listed with hosted events (co-hosted events listed once, as "Co-host", never as an invite).
- `notifications`: Notification opens the event (host view for co-hosts) and Host reply digest (owner and co-hosts).

## Impact

- **Database:** new tables `event_co_hosts` and `co_host_invites`; new helpers `is_event_owner`, `is_event_co_host`, `is_event_manager`; RPCs to create/revoke/accept co-host invites, leave, remove and list co-hosts; updated policies on `events`, `event_invites`, `rsvps`, `storage.objects`; updated `events_guard`, `regenerate_invite`, `get_invite`, `run_retention`. pgTAP tests for every changed policy.
- **Edge Function:** `delete-account` also cleans up event-scoped cover folders of owned events and must not delete covers that belong to events the user only co-hosts.
- **Mobile app:** event list label, owner/co-host-aware event detail, co-host management section, "Leave" action, new `/c/[token]` accept route, cover uploads on edit go to an event-scoped folder.
- **Web:** new `/c/[token]` landing page (open in app / install), deep-link files include `/c/*`, invite page and OG card render all host names.
- **Shared package:** i18n strings (sv/en), "hosted by" name-joining helper, generated DB types.
- **Sibling changes:** `add-guest-updates`, `add-event-wall` should authorize via `is_event_manager`.
