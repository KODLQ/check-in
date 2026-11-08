# Proposal

## Why

After a guest RSVPs they hear nothing more: time changes, new locations and cancellations are silent unless the guest happens to reopen the link, and hosts only learn about replies by opening the guest list. Guests who show up at the wrong time or to a cancelled party stop trusting invites, and that hurts the growth wedge. This change adds a reusable delivery system (push + email) and the first notifications on top of it. The sibling changes (date polls, guest capacity, co-hosts, event wall) also need to notify people, so the delivery system is built once here for all of them.

## What Changes

- New notification delivery system: a database outbox, a scheduled worker (Supabase Edge Function), idempotent sends, retries with backoff, per-recipient rate limits, quiet hours (22:00–08:00 Europe/Stockholm for non-urgent sends), and sv/en templates in the recipient's language.
- Two channels: **push** to signed-in app users through Expo Push Service, and **email** to web guests who opted in, through an EU-region transactional email provider (Mailpit in local development).
- Push permission is requested only after a host creates their first event or a user RSVPs in the app. Push tokens are stored per device and removed on sign-out and account deletion.
- RSVP form gets an **optional** email field with an explicit, unticked "Email me updates about this event" checkbox. Name is still the only required field. The email is stored per RSVP, never shown to the host or other guests, deleted with the RSVP (and shortly after the event ends), and the consent time is recorded.
- Every email has a one-click unsubscribe link; unsubscribing deletes the stored address.
- Host announcements: short updates (≤ 500 characters) shown newest first on the invite page and in the app, delivered to Going and Maybe guests; host can delete them; max 5 per event per 24 hours.
- Automatic notifications: time or location change and cancellation (to Going + Maybe), a reminder about 24 hours before start (or the morning of the event for late-created events), and a batched push to the host when people reply (at most one per event per 15 minutes).
- A documented way for other changes to enqueue notifications (notification kinds registry + `enqueue_notification` function + generic audiences).

## Capabilities

### New Capabilities
- `notifications`: Delivery of push and email notifications to app users and opted-in guests, including channels, consent, quiet hours, rate limits, retries, unsubscribe, templates/language, and the automatic event notifications (changes, cancellation, reminder, host reply digest).
- `event-announcements`: Host-posted short updates on an event — posting, display on the invite page and in the app, deletion, limits, and who receives them.

### Modified Capabilities
- `event-rsvp`: "RSVP without account" gains an optional email with explicit consent for updates (name stays the only required field). "Change or withdraw RSVP" lets a guest add or remove their email for updates and makes withdrawing also delete the email.

## Impact

- **Database**: new tables `push_tokens`, `rsvp_email_subscriptions`, `notification_kinds`, `notifications`, `notification_deliveries`, `event_announcements` (rate-limit buckets reuse the existing `rsvp_rate_limits` table); new functions (`enqueue_notification`, `is_event_manager`, worker claim/complete functions, `post_announcement`, `delete_announcement`, `register_push_token`, `unsubscribe_email`); `upsert_rsvp` and `get_invite` change signature/output; triggers on `events` and `rsvps`; new pg_cron jobs; retention extended.
- **Edge Functions**: new `notifications-worker` (scheduled), new `email-events` webhook for bounces/complaints; `delete-account` unchanged (cascades cover new tables).
- **Web (`apps/web`)**: RSVP form email + consent UI, `/api/rsvp` accepts email/consent, announcements section on `/i/[token]`, unsubscribe page and one-click endpoint.
- **Mobile (`apps/mobile`)**: `expo-notifications` dependency, permission prompt timing, token registration/removal, notification tap → event deep link, announcement composer and list on the event screen, announcements on the in-app invite screen.
- **Shared (`packages/shared`)**: Zod schemas for email/consent and announcements, notification template renderers (sv/en), quiet-hours/scheduling helpers.
- **External services**: Expo Push Service (needs APNs key — Apple Developer account not yet available — and FCM credentials), transactional email provider with EU region (new DPA, DNS records for SPF/DKIM/DMARC on the sending domain).

## Out of Scope

- SMS notifications.
- Web push (browser notifications) for guests.
- Marketing, newsletter or cross-event emails; emails to guests who did not opt in for that specific event.
- A notification inbox / notification centre UI in the app (announcements are listed per event only).
- Per-category notification preferences in the app (users control push with the OS setting; guests with unsubscribe).
- Email for signed-in app users (they get push only).
- Rich media (images) in announcements, replies or reactions to announcements (the event wall change covers conversation).
- Verifying push on a physical iOS device before the Apple Developer account exists (tracked as a later task).
