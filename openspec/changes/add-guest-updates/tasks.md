# Tasks

## 1. Notification core schema

- [x] 1.1 Migration: `notification_kinds` (seeded with the six kinds in design §2), `notifications`, `notification_deliveries` with FKs/cascades, unique and partial-unique indexes, RLS enabled (kinds readable by `authenticated`, others no policies); pgTAP proves anon/authenticated cannot read or write `notifications`/`notification_deliveries` and a deleted RSVP/event/profile cascades its rows
- [x] 1.2 Function `enqueue_notification` (dedupe no-op, coalesce `keep`/`debounce` with payload array union) and `cancel_event_notifications`; execute revoked from anon/authenticated; pgTAP covers duplicate dedupe key, coalesce merge, debounce moving `not_before`, cancellation skipping pending deliveries, and that `authenticated` cannot call it
- [x] 1.3 Function `apply_quiet_hours(ts, urgent)` and helper `is_event_manager(event_id)` (wrapping `is_event_host`); pgTAP covers 21:59/22:00/07:59/08:00 boundaries, urgent bypass, and the DST change weekends (last Sunday of March and October)
- [x] 1.4 Shared `NOTIFICATION_KINDS` constant in `packages/shared` plus a pgTAP test asserting `notification_kinds` contents equal that list (document in a comment how other changes add a kind); verify `supabase test db` and `npm test -w packages/shared` pass

## 2. Push token storage

- [x] 2.1 Migration: `push_tokens` table with RLS (owner select/delete only), `register_push_token(token, platform, locale)` that reassigns an existing token to the caller and refreshes `last_seen_at`, and `unregister_push_token(token)`; pgTAP covers owner-only reads, token takeover on account switch, other users unable to delete, and cascade on account deletion
- [x] 2.2 Regenerate DB types (`npm run db:types`) and verify both apps typecheck

## 3. Guest email subscriptions and RSVP API (database)

- [x] 3.1 Migration: `rsvp_email_subscriptions` (no policies, cascade from `rsvps`/`events`, random unsubscribe token); pgTAP proves host, other users and anon get zero rows and the host's `select * from rsvps` contains no email
- [x] 3.2 Replace `upsert_rsvp` with the new signature (email, email hash, action `keep`/`set`/`remove`, locale; defaults keep the 4-arg call working): opt-in limit 5/24h via `hit_rate_limit`, consent timestamp + version, new unsubscribe token on address change, confirmation enqueued only for new/changed subscriptions; pgTAP covers set, keep, remove, change address, rate-limited opt-in still saving the RSVP, and the old 4-arg call
- [x] 3.3 Extend `get_invite.my_rsvp` with `email_updates {state, masked}` for the caller's own guest token only, and add `unsubscribe_email(token)` (service role, same result for unknown token); pgTAP covers masking, another device seeing nothing, and unsubscribe deleting the row while keeping the RSVP
- [x] 3.4 Extend `run_retention`: delete subscriptions 2 days after event end/cancel, processed notifications after 30 days, push tokens unseen for 180 days, soft-deleted announcements after 24 h; pgTAP with a controlled `p_now` for each rule

## 4. Producers: event changes, reminders, RSVP digest

- [x] 4.1 `schedule_event_reminder(event, p_now)` + `events` AFTER INSERT trigger; pgTAP covers ≥ 24 h ahead (start − 24 h), created 07:00 for 19:00 today (08:00), created 14:00 for 20:00 today (none), and one reminder per start time
- [x] 4.2 `events_notify` AFTER UPDATE trigger: cancellation cancels pending notifications and enqueues `event_cancelled`; time/location change enqueues debounced `event_changed` and reschedules the reminder; description/cover edits enqueue nothing; pgTAP for each spec scenario under "Event change notification" and "Cancellation notification"
- [x] 4.3 `rsvps` AFTER INSERT/UPDATE OF status trigger enqueuing coalesced `rsvp_digest` (skip host's own RSVP and withdrawals; 1-min delay; ≥ 15 min after the last sent digest); pgTAP covers a burst producing one pending digest with all RSVP ids and the 15-minute spacing

## 5. Fan-out, claiming and completion (database side of the worker)

- [x] 5.1 `notification_recipients(notification)` and `fan_out_due_notifications(p_limit, p_now)`: audiences `event_attendees`/`event_managers`/`rsvp`/`user`, kind channel filter, `exclude_user_id`, stale/cancelled/deleted-announcement checks, quiet-hours deferral, urgency for changes within 12 h; pgTAP covers Going/Maybe vs Can't go, user with two tokens, guest without email, guest switched to Can't go during deferral, and cancelled-event skips
- [x] 5.2 `claim_deliveries(p_limit, p_now)` (skip locked, lock expiry, per-recipient `hit_rate_limit` postponement for non-urgent, missing subscription ⇒ skipped, render context incl. active invite token) and `complete_delivery(...)` (backoff 1m/5m/30m/2h/6h/12h then failed, permanent errors, `DeviceNotRegistered` deletes token, expired push lock ⇒ failed not retried); pgTAP covers each outcome and that two concurrent claims never return the same delivery
- [x] 5.3 Function `due_push_receipts(p_limit)` + `record_push_receipt(...)`; pgTAP covers selection after 15 min and token deletion on `DeviceNotRegistered`

## 6. Templates and language (shared)

- [x] 6.1 `packages/shared/src/notifications/`: `renderPush` and `renderEmail` for all six kinds, strings in `sv.json`/`en.json` under `notifications.*`, times via `formatTimeRange` in the event time zone; Vitest snapshot per kind × locale and a test failing if any kind lacks a locale string
- [x] 6.2 Email layout (plain text + inline-styled HTML, no images/tracking) with footer unsubscribe link and RFC 8058 headers builder; Vitest asserts every rendered email contains the unsubscribe URL and both `List-Unsubscribe` headers, and that the announcement body is HTML-escaped
- [x] 6.3 Zod: `rsvpInputSchema` gains `email`, `emailConsent`, `locale` with the `consent_required` refine; `announcementInputSchema` (1–500 chars after trim); Vitest covers valid, missing consent, malformed email, `null` removal, and 0/500/501-char bodies

## 7. Worker Edge Function

- [x] 7.1 `supabase/functions/_shared/email.ts` transports (`smtp` for Mailpit, `resend` with `Idempotency-Key` = delivery id, region eu-west-1) and `push.ts` (Expo send in batches of 100, receipts); enable the Mailpit SMTP port in `supabase/config.toml`; Deno tests with mocked `fetch` cover success, temporary and permanent error mapping
- [x] 7.2 `notifications-worker` function: secret check (`verify_jwt = false`), loop fan-out → claim → render via shared templates (deno.json import map) → send → complete → receipts, ~50 s budget; Deno test with fake transports verifies a full cycle and that a thrown send leaves the delivery retryable
- [x] 7.3 Migration: store worker URL + secret in Vault, `cron.schedule` every minute via `net.http_post` with `x-region: eu-north-1`, and an immediate kick for urgent kinds; local integration test: cancel a seeded event with a subscribed guest, run the worker, assert the email appears in Mailpit's API within 60 s
- [x] 7.4 `email-events` Edge Function verifying the provider webhook signature and deleting the subscription on hard bounce/complaint; Deno test with a signed sample payload and pgTAP-backed check that the row is gone
- [x] 7.5 Document secrets, local setup (Mailpit, running the worker manually) and how to add a notification kind in `supabase/functions/notifications-worker/README.md`; verify a fresh `supabase start` + documented steps deliver a test email to Mailpit

## 8. Web: email opt-in, unsubscribe

- [x] 8.1 `POST /api/rsvp` accepts `email`/`emailConsent`/`locale`, computes the salted email hash, maps `consent_required`/`rate_limited` email states, returns `email_updates`; Vitest/route test covers the new error mapping
- [x] 8.2 RSVP form: optional email input, unticked consent checkbox, "host can't see your email" helper, subscribed state with masked address and "Turn off", sv/en strings; Playwright covers opt-in, email-without-consent error, turn-off, and that the consent is unticked on first view
- [x] 8.3 `GET /u/[token]` confirm page (noindex, no event details) and `POST /api/unsubscribe/[token]` (also RFC 8058 target); Playwright covers GET not unsubscribing, confirm unsubscribing, and unknown token showing the same page
- [x] 8.4 End-to-end Playwright against local stack: RSVP with email → confirmation email in Mailpit (sv when page is Swedish) → follow unsubscribe link → confirm → no further emails after a host announcement

## 9. Announcements

- [x] 9.1 Migration: `event_announcements` with host-only select RLS, `post_announcement` (manager check, active event, 1–500 chars, 5 per rolling 24 h counting deleted, enqueue with author excluded) and `delete_announcement` (soft delete, body nulled, pending notifications cancelled); `get_invite` returns non-deleted announcements newest first for active/past only; pgTAP for every scenario in specs/event-announcements
- [x] 9.2 Web: announcements section on `/i/[token]` (newest first, relative time, sv/en); Playwright covers two announcements in order and none on cancelled/not-found invites
- [x] 9.3 Mobile host: composer with character counter and list with delete on `events/[id]`, limit error showing when posting is possible again; Jest tests for validation and limit error; verify in the iOS Simulator
- [x] 9.4 Mobile guest: announcements on `i/[token]`; Jest render test with fixture data; verify in the iOS Simulator

## 10. Mobile push integration

- [ ] 10.1 Add `expo-notifications` + config plugin, `eas init` project id, notification handler; verify a dev build compiles and runs in the iOS Simulator
- [x] 10.2 `lib/push.ts`: `maybeAskForPush` explainer + OS prompt only after first event creation and after in-app RSVP, decline remembered; register on start when granted, unregister before sign-out; Jest tests (mocked `expo-notifications`) cover no prompt at launch/sign-in, prompt after first event, no re-prompt after decline, and unregister-before-signOut order
- [x] 10.3 Tap handling (`addNotificationResponseReceivedListener` + cold-start response) routing `data.url` to `/events/[id]` or `/i/[token]`; Jest test for URL routing, and verify in the iOS Simulator with `xcrun simctl push` using a sample `.apns` file committed under `apps/mobile/dev/`
- [ ] 10.4 Android: upload FCM v1 credentials to EAS and verify a host digest push arrives on an Android emulator with Google Play services and opens the event (skip and note if FCM project is not yet set up)

## 11. Integration checks

- [x] 11.1 Local scenario run with seed data: edit time twice, post an announcement at a simulated 23:30 (`p_now`), cancel; confirm via Mailpit and delivery rows that guests got one change email, the announcement was deferred to 08:00, the cancellation was immediate, and no reminder was sent after cancellation
- [ ] 11.2 Privacy check: as host via the app's Supabase client, query every table/RPC reachable by `authenticated` and confirm no guest email is returned; record the result in the PR description
- [ ] 11.3 Production setup: Resend EU region account + DPA, sending domain with SPF/DKIM/DMARC, secrets and Vault entries, cron enabled; verify a real email to a test address passes DMARC and the one-click unsubscribe works in Gmail
- [ ] 11.4 Physical iOS device verification once the Apple Developer account exists: APNs key in EAS, real token registered, host digest and announcement pushes received, tap opens the event, sign-out stops pushes

## Workflow follow-up

- Sibling changes (add-date-polls, add-guest-capacity, add-co-hosts, add-event-wall) should depend on groups 1, 5 and 6 of this change landing first, and add their kinds per design §4.
- Archive this change with `/opsx:archive` after review, which moves the specs into `openspec/specs/`.
