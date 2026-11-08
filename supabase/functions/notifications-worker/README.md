# notifications-worker

Thin, stateless sender for the notification outbox (openspec change `add-guest-updates`, design §6).
Postgres decides who gets what and when; this function renders with the shared templates
(`packages/shared/src/notifications`) and sends.

Each run (≈50 s budget): `fan_out_due_notifications` → `claim_deliveries` → render → send
(Expo push in batches of 100, email with concurrency 5) → `complete_delivery` → Expo receipts.
It is called every minute by pg_cron (`notifications-worker` job) and kicked immediately for urgent
kinds (cancellation, opt-in confirmation) via `public.kick_notifications_worker()`.

## Secrets

| Name | Where | Purpose |
|---|---|---|
| `NOTIFICATIONS_WORKER_SECRET` | function secret **and** Vault `notifications_worker_secret` | Shared secret in the `x-worker-secret` header (`verify_jwt = false`) |
| Vault `notifications_worker_url` | Vault | `https://<ref>.supabase.co/functions/v1/notifications-worker` |
| `EMAIL_TRANSPORT` | function secret | `resend` (production) or `smtp` (Mailpit) |
| `RESEND_API_KEY` | function secret | Resend API key (sending domain in the EU region, tracking off) |
| `EMAIL_FROM` | function secret | e.g. `check-in <updates@<domain>>` (SPF/DKIM/DMARC on the domain) |
| `WEB_BASE_URL` | function secret | Public web origin for `/i/<token>`, `/u/<token>`, `/api/unsubscribe/<token>` |
| `EXPO_ACCESS_TOKEN` | function secret (optional) | Expo push security token, if enabled for the project |
| `EMAIL_UNSUBSCRIBE_MAILTO` | function secret (optional) | Adds a `mailto:` target to `List-Unsubscribe` (only if someone processes it) |
| `RESEND_WEBHOOK_SECRET` | `email-events` secret | `whsec_…` signing secret of the Resend webhook (bounces/complaints) |

Production:

```bash
supabase secrets set NOTIFICATIONS_WORKER_SECRET=… EMAIL_TRANSPORT=resend RESEND_API_KEY=… \
  EMAIL_FROM='check-in <updates@example.se>' WEB_BASE_URL=https://example.se RESEND_WEBHOOK_SECRET=whsec_…
supabase functions deploy notifications-worker
supabase functions deploy email-events
```

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/notifications-worker', 'notifications_worker_url');
select vault.create_secret('<same NOTIFICATIONS_WORKER_SECRET>', 'notifications_worker_secret');
```

Point the Resend webhook (events `email.bounced`, `email.complained`) at
`https://<ref>.supabase.co/functions/v1/email-events`.

Stop all sending immediately: `select cron.unschedule('notifications-worker');`

## Local setup (Mailpit)

```bash
npx supabase start                                     # Mailpit UI: http://127.0.0.1:54324
cp supabase/functions/.env.example supabase/functions/.env
npx supabase functions serve                           # serves the worker (reads supabase/functions/.env)
npm run db:worker:configure                            # Vault secrets so pg_cron/kicks reach the worker
```

`supabase db reset` wipes Vault: run `npm run db:worker:configure` again afterwards.

Locally the worker sends with the `smtp` transport to Mailpit inside Docker (`inbucket:1025`).
Mailpit's SMTP port is also exposed on the host as `54325` (`[local_smtp] smtp_port`).

Run the worker by hand (instead of waiting for the next minute):

```bash
curl -X POST http://127.0.0.1:54321/functions/v1/notifications-worker -H 'x-worker-secret: dev-only-worker-secret'
```

Send yourself a test email (an opt-in confirmation):

```bash
curl -X POST http://localhost:3000/api/rsvp -H 'content-type: application/json' \
  -d '{"token":"DemoFredag01","guestToken":"readme-test-guest-0000001","displayName":"Test","status":"going","email":"me@example.com","emailConsent":true}'
# within a few seconds (the opt-in kicks the worker):
curl -s 'http://127.0.0.1:54324/api/v1/search?query=to:me@example.com' | jq '.messages[].Subject'
```

The web app needs `NEXT_PUBLIC_EMAIL_UPDATES=true` (see `apps/web/.env.example`) to show the email field.

## Tests

```bash
npm run test:functions        # Deno unit tests (transports, worker orchestration, webhook)
npx supabase test db          # pgTAP: outbox, fan-out, claim/complete, quiet hours, retention…
npm run test:e2e -w @check-in/web   # includes e2e/notifications.spec.ts (web → worker → Mailpit)
```

## Adding a notification kind (other changes)

1. Migration: `insert into public.notification_kinds (kind, urgent, channels, stale_after_start) values (…)`.
2. `packages/shared/src/notifications/kinds.ts`: add it to `NOTIFICATION_KINDS`; add `notifications.<kind>`
   strings to `packages/shared/src/i18n/{en,sv}.json` and a template in `templates.ts`. Vitest fails if a
   template or a locale is missing.
3. Add it to the expected list in `supabase/tests/08_notifications_core.test.sql` (pgTAP compares the DB to
   that list; `kinds.test.ts` compares that list to `NOTIFICATION_KINDS`).
4. Enqueue from your security-definer function or trigger:

   ```sql
   perform public.enqueue_notification(
     p_kind => 'poll_decided', p_event_id => ev.id, p_audience => 'event_attendees',
     p_dedupe_key => 'poll_decided:' || poll.id);
   ```

   Audiences: `event_attendees` (Going/Maybe: push to app users, email to opted-in web guests),
   `event_managers` (push to everyone `is_event_manager` is true for), `rsvp` (one RSVP), `user` (one user).
   Use `p_dedupe_key` for idempotency and `p_coalesce_key` + `p_coalesce_mode` (`keep` | `debounce`)
   to batch (payload arrays are unioned). Never put email addresses in `payload`.
5. If your kind needs data at send time, extend the context built in `public.claim_deliveries`.

## Push on the iOS Simulator

expo-notifications reads a remote notification's custom data from the top-level `body` key (the Expo push
service puts `data` there), so the deep link goes in `body.url`. Sample payloads live in `apps/mobile/dev/`:

```bash
xcrun simctl push booted se.checkin.app apps/mobile/dev/push-host-digest.apns        # opens /events/<id>
xcrun simctl push booted se.checkin.app apps/mobile/dev/push-guest-announcement.apns # opens /i/<token>
```

Real token registration (`getExpoPushTokenAsync` needs the EAS project id from `eas init`) and APNs delivery
need the Apple Developer account and a physical device.
