# Proposal

## Why

Young people organise parties and meetups in group chats because Facebook Events is no longer where they are, and group chats are bad at "who's coming, when, where". Private events are also our answer to the cold-start problem: every invite a host sends exposes the product to 10–50 new people without needing an existing network. This first change builds that loop end-to-end: create an event fast, share a link anywhere, and let guests RSVP without installing anything.

## What Changes

- New Expo (iOS, Android, web) app and Supabase backend (EU / Stockholm) as the project foundation.
- Hosts sign in (email magic link, Sign in with Apple, Google) and set up a minimal profile (display name, optional avatar).
- Hosts create a private event in under 30 seconds: title, start time, location (free-text place and optional map point). Optional: end time, description, cover image/theme.
- Hosts can edit or cancel their event; guests see the updated or cancelled state.
- Each event gets an unguessable invite link that opens a public web invite page with rich link previews (Open Graph title, time, cover image) in iMessage, WhatsApp, Snapchat, Instagram DMs and Discord.
- One-tap sharing from the app to the native share sheet, plus "copy link".
- Guests RSVP **Going / Maybe / Can't go** from the web page with only a display name — no account, no app install — and can change their answer later from the same device.
- Hosts see a live guest list grouped by RSVP status, and can revoke the link or remove a guest.
- Guest-facing visibility of the guest list is controlled by the host (show / hide).
- Account and data deletion for hosts; guest RSVPs can be withdrawn by the guest.
- Swedish and English UI.

### Out of scope

- Public events, discovery, map browsing, Stockholm event import.
- Friends, contacts import, "friends going".
- Check-ins and any location sharing.
- Push notifications, email/SMS reminders, chat or comments on events.
- Instagram Story / Snapchat Creative Kit deep integrations (link sharing only for now).
- Phone-number auth, co-hosts, recurring events, ticketing or payments.

## Capabilities

### New Capabilities

- `user-accounts`: Host sign-in, minimal profile, and account deletion.
- `private-events`: Creating, editing and cancelling private events owned by a host.
- `event-invites`: Invite links, the public web invite page, link previews, sharing and link revocation.
- `event-rsvp`: Guest RSVP without an account, changing/withdrawing an RSVP, and the host's guest list.

### Modified Capabilities

_None — this is the first change._

## Impact

- New repository structure: Expo app (TypeScript, Expo Router, web output), Supabase project (migrations, RLS policies, storage bucket, edge function for preview images).
- New external dependencies: Supabase (EU region), Apple/Google OAuth configuration, web hosting for the invite pages (custom domain needed for short, trustworthy links).
- Personal data stored: host email and display name, avatar; guest display name and an anonymous RSVP token. See design.md for retention.
