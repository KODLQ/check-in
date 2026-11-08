# Design

## Context

See proposal.md for motivation and `specs/` for required behavior. Current state that shapes this design (from `supabase/migrations` and the apps):

- Guests have no account. All guest reads/writes go through security-definer functions keyed by the invite token (`get_invite`, `upsert_rsvp`, `withdraw_rsvp`); `upsert_rsvp`/`withdraw_rsvp` are called only by the Next.js route `apps/web/src/app/api/rsvp/route.ts` with the service role, after hashed-IP rate limiting via `hit_rate_limit` on the generic `rsvp_rate_limits` table.
- The host can `select` every column of `rsvps` for their events (RLS "host or self can read", and Realtime publishes the table). **Anything stored on `rsvps` is visible to the host**, so guest email must not live there.
- `events` already has `cancelled_at` and `time_changed_at` (set by the `events_guard` trigger). Cancel is a plain `update events set cancelled_at` from the app; edits are plain updates too. There is no location-changed marker.
- `profiles.locale` exists but the app never writes it; the app derives its locale from the device at runtime.
- pg_cron is enabled (`run_retention` runs hourly). One Edge Function exists (`delete-account`); deleting `auth.users` cascades through `profiles` → `events` → `event_invites`/`rsvps`.
- Local Supabase runs Mailpit (web UI on port 54324) for auth emails.
- No Apple Developer account yet: no APNs key, so real iOS push tokens cannot be obtained.

## Goals / Non-Goals

**Goals:**
- One delivery pipeline that every current and future feature uses by inserting a row, never by calling providers directly.
- Correctness lives in Postgres (who receives what, when, how often), testable with pgTAP and a controllable clock. The worker is a thin, stateless sender.
- Guest email is isolated in a table no client role can read.
- Safe to run more than one worker at once; safe to crash at any point.

**Non-Goals:**
- Sub-second delivery. Up to ~1 minute latency is acceptable (cancellations included).
- Delivery analytics, open/click tracking (explicitly disabled at the provider).
- Supporting more than one email provider in production at the same time.

## Decisions

### 1. Two-level outbox: `notifications` → `notification_deliveries`

```
producer (trigger / RPC)
   └─ enqueue_notification(kind, event, audience, …)      one row per logical message
          │  (pending until not_before; coalescing/dedupe here)
          ▼
   worker: fan_out_due_notifications()                    stale check, quiet hours,
          │                                               resolve recipients NOW
          ▼
   notification_deliveries                                one row per recipient × channel
          │  claim_deliveries() → send → complete_delivery()
          ▼
   Expo Push Service  /  Email provider (Mailpit locally)
```

- **Why two levels:** the spec requires recipients to be decided at send time (after quiet hours / debounce), while idempotency and retries are per recipient. A logical row also gives us one place to coalesce (debounce edits, batch RSVP digests) and to cancel (event cancelled, announcement deleted).
- **Alternative: fan out at enqueue time** (one table). Rejected: people who withdraw or switch to Can't go during the 22:00–08:00 deferral would still be notified.
- **Alternative: Supabase Queues (pgmq).** Gives visibility timeouts but no dedupe, coalescing, scheduled `not_before` per message, or queryable history for rate limits. A plain table is more transparent and fully testable in pgTAP.
- **Alternative: hosted notification service (Knock, OneSignal, Novu).** Adds a US sub-processor holding guest emails, cost, and its own quiet-hours model. Rejected.

### 2. Data model

| Table | Key columns | Notes |
|---|---|---|
| `notification_kinds` | `kind` text PK, `urgent` bool, `channels` text[] (`push`,`email`), `stale_after_start` bool | Registry. Other changes add kinds by inserting rows in their own migrations (no enum to alter). Seeded: `rsvp_email_confirmation` (urgent, email only), `event_changed`, `event_cancelled` (urgent), `event_reminder` (stale after start), `announcement` (stale after start), `rsvp_digest` (push only) |
| `notifications` | `id`, `kind` FK, `event_id` FK events **on delete cascade** (nullable for future non-event kinds), `audience` (`event_attendees` \| `event_managers` \| `rsvp` \| `user`), `target_rsvp_id` FK rsvps cascade, `target_user_id` FK profiles cascade, `subject_id` uuid (e.g. announcement id), `exclude_user_id`, `payload` jsonb, `not_before`, `dedupe_key` text **unique**, `coalesce_key` text (unique **where state = 'pending'**), `state` (`pending`,`fanned_out`,`cancelled`,`skipped`), `created_at`, `processed_at` | `payload` holds only what can't be read at send time (e.g. `changed: ["time"]`, `rsvp_ids` for a digest). **Never email addresses.** |
| `notification_deliveries` | `id`, `notification_id` FK cascade, `channel` (`push`,`email`), `user_id` FK profiles cascade (push), `push_token_id` FK push_tokens cascade, `rsvp_id` FK rsvps cascade (email), `status` (`pending`,`sending`,`sent`,`failed`,`skipped`), `attempts`, `next_attempt_at`, `locked_until`, `provider_message_id` (Expo ticket / email id), `receipt_checked_at`, `last_error` (error code only), `sent_at` | Unique `(notification_id, push_token_id)` for push and `(notification_id, rsvp_id)` for email → each recipient channel gets at most one row. Cascades mean a withdrawn RSVP or deleted account removes its pending deliveries automatically. |
| `push_tokens` | `id`, `user_id` FK profiles cascade, `token` text **unique** (`ExponentPushToken[…]`), `platform` (`ios`,`android`), `locale` (`sv`,`en`), `created_at`, `last_seen_at` | One row per device. `locale` is the device language at last app start (used for push copy, since `profiles.locale` isn't maintained). |
| `rsvp_email_subscriptions` | `rsvp_id` PK FK rsvps **on delete cascade**, `event_id` FK events cascade, `email` text (trimmed, lower-cased, ≤ 254), `locale`, `consent_at` timestamptz not null, `consent_version` text, `unsubscribe_token` text unique (128-bit random base64url), `created_at` | Separate table so the host's `select` on `rsvps` (and Realtime) can never see it. Deleted with the RSVP. |
| `event_announcements` | `id`, `event_id` FK cascade, `author_id` FK profiles on delete set null, `body` text (1–500, nulled on delete), `created_at`, `deleted_at` | Soft delete keeps the row 24 h so the 5-per-24h limit counts deleted posts (spec: Announcement limit). |

Rate-limit buckets reuse `rsvp_rate_limits` + `hit_rate_limit` (already generic; rows expire after 24 h). Bucket prefixes: `push:<user_id>` (20/h), `email:<rsvp_id>` (10/24h), `optin:<sha256(salt+email)>` (5/24h).

### 3. RLS for every new table

| Table | anon | authenticated | service_role / definer functions |
|---|---|---|---|
| `notification_kinds` | none | `select` (read-only lookup, no personal data) | full |
| `notifications` | none | **none** | full; written only via `enqueue_notification` |
| `notification_deliveries` | none | **none** | full; worker only |
| `push_tokens` | none | `select`, `delete` where `user_id = auth.uid()`; **no insert/update policy** | `register_push_token(token, platform, locale)` (security definer, `authenticated`): upserts on `token` and reassigns it to the caller — needed when a device switches account, which an RLS update could not do. `unregister_push_token(token)` deletes only the caller's row. |
| `rsvp_email_subscriptions` | none | **none** (not even the guest's own signed-in account; web guests have no account) | read/written only inside `upsert_rsvp`, `withdraw_rsvp` (cascade), `get_invite` (masked, own device only), `unsubscribe_email`, the worker and retention |
| `event_announcements` | none (guests read via `get_invite`) | `select` where `is_event_manager(event_id)`; **no insert/update/delete policy** | `post_announcement(event_id, body)` and `delete_announcement(id)` (security definer, `authenticated`) check `is_event_manager`, event active, limit, and enqueue/cancel notifications |

New helper `is_event_manager(event_id)` = `is_event_host(event_id)` for now. Announcement posting and the `event_managers` audience use it, so **add-co-hosts only redefines this one function** to include co-hosts.

None of the new tables are added to the Realtime publication.

### 4. Enqueue API (shared by all changes)

```sql
enqueue_notification(
  p_kind text, p_event_id uuid, p_audience text,
  p_target_rsvp_id uuid default null, p_target_user_id uuid default null,
  p_subject_id uuid default null, p_exclude_user_id uuid default null,
  p_payload jsonb default '{}', p_not_before timestamptz default now(),
  p_dedupe_key text default null,
  p_coalesce_key text default null, p_coalesce_mode text default 'keep'  -- 'keep' | 'debounce'
) returns uuid
```

- Security definer; `execute` revoked from `anon`/`authenticated`. Only other definer functions and triggers call it.
- `dedupe_key` conflict → no-op, returns existing id (makes producers idempotent, e.g. `announcement:<id>`).
- `coalesce_key` conflict with a *pending* row → merge: `payload = payload || new` (arrays unioned for `rsvp_ids`/`changed`), and `not_before` is pushed to the new value (`debounce`) or left alone (`keep`).
- `cancel_event_notifications(event_id, except_kind)` marks pending notifications `cancelled` and their pending deliveries `skipped`.

**How the sibling changes plug in** (each in its own migration and template file):

| Change | Kind(s) | Audience | Pattern |
|---|---|---|---|
| add-date-polls | `poll_decided` | `event_attendees` (or `rsvp` per voter) | call from the finalize RPC, `dedupe_key = poll_decided:<poll_id>` |
| add-guest-capacity | `waitlist_promoted` | `rsvp` | call from promotion function, `dedupe_key = waitlist_promoted:<rsvp_id>:<promoted_at>` |
| add-co-hosts | (none new) | `event_managers` | redefine `is_event_manager`; digests and announcements then include co-hosts |
| add-event-wall | `wall_digest` | `event_managers` / `event_attendees` | coalesced like `rsvp_digest` (`coalesce_key = wall_digest:<event_id>`) |
| add-my-invites | (none) | — | signed-in RSVPs already get push via `event_attendees` |

Adding a kind = insert into `notification_kinds` + add sv/en strings and a template to the shared registry. A Vitest test fails if the shared `NOTIFICATION_KINDS` list lacks a template for a locale, and a pgTAP test asserts the DB registry equals that list (both updated together).

### 5. Producers in this change

- **`events` AFTER INSERT** → `schedule_event_reminder(event)`.
- **`events` AFTER UPDATE** (`events_notify` trigger):
  - `cancelled_at` became non-null → `cancel_event_notifications(id)` then enqueue `event_cancelled` (`dedupe_key = event_cancelled:<id>`).
  - `starts_at`, `ends_at`, `location_text`, `place_name`, `latitude` or `longitude` changed → enqueue `event_changed` with `coalesce_key = event_changed:<id>`, mode `debounce`, `not_before = now() + 5 min`, `payload.changed` ∪= `time`/`location`. Content is rendered from the event's current state at send time. If `starts_at` changed, re-run `schedule_event_reminder`.
- **`schedule_event_reminder(event, p_now)`**: cancel pending reminders for the event; if `starts_at - p_now ≥ 24 h` → `not_before = starts_at - 24 h`; else if 08:00 Europe/Stockholm on the start date is after `p_now` and before `starts_at` → that time; else none. `dedupe_key = reminder:<id>:<epoch(starts_at)>` (one reminder per start time).
- **`rsvps` AFTER INSERT OR UPDATE OF status** (skip when `user_id` is the event host) → enqueue `rsvp_digest`, audience `event_managers`, `coalesce_key = rsvp_digest:<event_id>`, mode `keep`, `payload.rsvp_ids` ∪= `[id]`, `not_before = greatest(now() + 1 min, last_sent_digest_at + 15 min)`. The 1-minute delay lets a burst collapse into the first push. At send time names/statuses are read for the RSVP ids that still exist; if none remain, the notification is skipped.
- **`post_announcement`** → insert row, enqueue `announcement` (`subject_id` = announcement id, `exclude_user_id` = author, `dedupe_key = announcement:<id>`). **`delete_announcement`** → set `deleted_at`, null `body`, cancel pending notifications with that `subject_id`.
- **`upsert_rsvp`** creating a subscription → enqueue `rsvp_email_confirmation`, audience `rsvp`, `dedupe_key = email_confirm:<rsvp_id>:<epoch(consent_at)>`.

### 6. Worker: `notifications-worker` Edge Function on a 1-minute cron

Each run (time budget ~50 s):
1. `fan_out_due_notifications(p_limit, p_now)` — for pending rows with `not_before ≤ now`, `for update skip locked`:
   - stale check: event deleted → cascade already removed it; event cancelled and kind ≠ `event_cancelled` → `cancelled`; `stale_after_start` and event started → `skipped`; announcement deleted → `cancelled`.
   - quiet hours: if not urgent and local Stockholm time ∈ [22:00, 08:00) → set `not_before` to next 08:00 and leave pending. Urgent = kind flag, or `event_changed` for an event starting within 12 h.
   - resolve recipients via `notification_recipients(notification)`: `event_attendees` = RSVPs with status going/maybe → signed-in user ⇒ one push delivery per `push_tokens` row; web guest ⇒ one email delivery if a subscription exists; `event_managers` = `is_event_manager` users ⇒ push; `rsvp`/`user` = that one recipient. Kind `channels` filters the result; `exclude_user_id` removed.
   - insert deliveries `on conflict do nothing`, set `fanned_out`.
2. `claim_deliveries(p_limit)` — pending and due (or `sending` with expired lock for email) → `sending`, `attempts + 1`, `locked_until = now() + 2 min`, `skip locked`. For non-urgent ones, `hit_rate_limit` on the recipient bucket; over the limit → back to `pending` with `next_attempt_at` = next window (stale check re-applies later). Returns a ready-to-render context (kind, locale, event title/times/time zone/location, active invite URL, announcement body, digest names, recipient token or email + unsubscribe token). Email deliveries whose subscription no longer exists are `skipped`.
3. Render with the shared templates and send: Expo in batches of 100; email one request per delivery (concurrency 5).
4. `complete_delivery(id, outcome, provider_id, error_code)`: `sent`; temporary error → `pending` with backoff 1 m, 5 m, 30 m, 2 h, 6 h, 12 h (≈ 21 h total) then `failed`; permanent error → `failed`. Expo `DeviceNotRegistered` → delete the push token.
5. Expo receipts: for push deliveries sent ≥ 15 min ago with a ticket and no receipt check, fetch receipts; `DeviceNotRegistered` → delete token.

**At-most-once:** email uses the provider idempotency key = delivery id, so a crash between "accepted" and "recorded" is retried safely (effectively exactly once). Expo has no idempotency key, so a push delivery found in `sending` with an expired lock is marked `failed` instead of retried — we prefer losing a push on a crash to sending it twice (spec: Delivery at most once).

**Scheduling:** `cron.schedule('notifications-worker', '* * * * *', …net.http_post(...))` with the function URL and a dedicated `NOTIFICATIONS_WORKER_SECRET` read from Supabase Vault (function has `verify_jwt = false` and checks the secret in constant time). The request sets `x-region: eu-north-1` so the function runs in Stockholm. Urgent enqueues (`event_cancelled`, confirmation) also fire one immediate `net.http_post` "kick"; concurrent runs are safe because of `skip locked`.

- **Alternative: Database Webhooks on every insert.** Rejected as the main path: quiet hours, debounce and retries need a time-based scan anyway.
- **Alternative: Vercel cron in `apps/web`.** Rejected: Vercel cron is coarser on lower plans, and keeping the sender next to the DB in eu-north-1 is simpler.

Every SQL function that depends on time takes `p_now timestamptz default now()` so pgTAP can test quiet hours, DST changes and reminders deterministically.

### 7. Quiet hours

`apply_quiet_hours(ts, urgent)`: convert to `Europe/Stockholm` local time; if urgent or 08:00 ≤ local < 22:00 return `ts`; else return 08:00 local (same day if before 08:00, next day if ≥ 22:00) converted back with `at time zone`, which handles DST. Applied at fan-out and again when rate-limit postponement lands in quiet hours. All recipients use Stockholm time (product is Stockholm-first; per-recipient time zones are not stored).

### 8. Push (Expo Push Service) and permission timing

- Add `expo-notifications` (config plugin) and an EAS project id (`eas init`) for `getExpoPushTokenAsync`.
- `apps/mobile/src/lib/push.ts`: `maybeAskForPush(reason)` shows a short in-app explainer then the OS prompt, only when the OS status is `undetermined` and only from two places: after the host's first event is created, and after a successful in-app RSVP (`rsvp_as_user`). Never at launch or sign-in. A stored flag prevents re-showing our explainer after a decline.
- When permission is granted, on every app start: `register_push_token(token, platform, locale)` (updates `last_seen_at`/`locale`). On sign-out: `unregister_push_token(token)` **before** `supabase.auth.signOut()`.
- Payload: `title`, `body`, `data.url` (`/events/<id>` for managers, `/i/<token>` for guests). No guest names in push except host digests (to the host). Tap handling via `addNotificationResponseReceivedListener` + `getLastNotificationResponseAsync` → `router.push(data.url)`.
- **Verification without an Apple account:** iOS Simulator can display pushes injected with `xcrun simctl push` (an `.apns` JSON file containing `data.url`), which exercises presentation and tap-to-open. Real token retrieval and APNs delivery need the Apple Developer account and a device — a later task. Android: Expo push works on an emulator with Google Play services once FCM v1 credentials are uploaded to EAS.

### 9. Email provider: Resend (EU region), behind a transport interface

`supabase/functions/_shared/email.ts` exposes `EmailTransport.send({to, subject, text, html, headers, idempotencyKey})` with two implementations: `resend` (production) and `smtp` (Mailpit locally via the local Supabase SMTP port; Mailpit's HTTP API is used by integration tests). Chosen by `EMAIL_TRANSPORT` env.

| Option | EU data | Fit | Verdict |
|---|---|---|---|
| **Resend (sending region eu-west-1)** | Sending infra in Ireland; DPA with SCCs | Simple HTTP API from Deno, **idempotency keys**, bounce/complaint webhooks, tracking can be disabled | **Chosen** |
| Postmark | Strong deliverability; EU-only processing not offered as a region option at our tier | No idempotency key | Not chosen |
| Amazon SES eu-north-1 | Data in Stockholm | More setup (sandbox exit, SNS for bounces, IAM in Deno) | **Fallback** if the DPA review requires stricter residency |
| Brevo / Scaleway TEM | EU companies | Smaller ecosystems, weaker API ergonomics | Not chosen |

Emails: plain-text + simple inline-styled HTML, no images or tracking pixels, open/click tracking disabled. Headers: `List-Unsubscribe: <https://<domain>/api/unsubscribe/<token>>, <mailto:…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Sender `updates@<domain>` with SPF/DKIM/DMARC. Bounces and complaints arrive at a new `email-events` Edge Function (signature-verified webhook) which deletes the subscription for that provider message's `rsvp_id` (spec: Guest email retention — hard bounce).

### 10. Templates and language

`packages/shared/src/notifications/`: `NOTIFICATION_KINDS`, `renderPush(kind, locale, ctx)` and `renderEmail(kind, locale, ctx)` as pure functions, strings in the existing `sv.json`/`en.json` under `notifications.*`, dates via the existing `formatTimeRange` in the event's `time_zone`. The Edge Functions import these through a `deno.json` import-map entry pointing at the shared source (pure TS, no Node deps). Locale: push → `push_tokens.locale`; email → `rsvp_email_subscriptions.locale` (page language at opt-in); fallback `en`.

### 11. RSVP API: email + consent

- `rsvpInputSchema` gains `email?: string | null` (trim, lower-case, `.email()`, ≤ 254), `emailConsent?: boolean`, `locale?: 'sv' | 'en'`; refine: a non-empty email requires `emailConsent === true` (error key `consent_required`). Semantics: field omitted ⇒ keep current subscription; `null` ⇒ remove; string ⇒ set/replace.
- `POST /api/rsvp` computes `emailHash = sha256(rateLimitSalt + ':' + email)` and calls the new `upsert_rsvp(p_token, p_guest_token, p_display_name, p_status, p_email default null, p_email_hash default null, p_email_action default 'keep', p_locale default 'en')`. The old 4-argument call still resolves (new params have defaults), so the DB can deploy before the web app.
- Inside `upsert_rsvp`: after the RSVP upsert, `set` with a new or changed address checks `hit_rate_limit('optin:'||p_email_hash, 5, 86400)`; over the limit ⇒ no subscription, result `email_updates.state = 'rate_limited'`, RSVP still saved. Otherwise insert/update the subscription (`consent_at = now()`, new unsubscribe token when the address changes) and enqueue the confirmation. `remove` deletes the subscription.
- Response and `get_invite.my_rsvp` add `email_updates: { state: 'on' | 'off' | 'rate_limited', masked: 'a•••@gmail.com' }` — only for the caller's own guest token.
- Form (`rsvp-form.tsx`): optional email input, unticked checkbox "Email me updates about this event", helper text "Only for this event. The host can't see your email." For an existing subscription: "Email updates on (a•••@…) · Turn off".
- `get_invite` also returns `announcements: [{id, body, created_at}]` (newest first, max 50, not deleted) for `active` and `past` states.

### 12. Unsubscribe

- `GET /u/[token]` (Next.js page, `noindex`, no event details) shows a single "Unsubscribe" button that POSTs; GET never changes state, so link scanners can't unsubscribe (spec scenario "Link scanner").
- `POST /api/unsubscribe/[token]` (also the RFC 8058 target) → `unsubscribe_email(token)` (service role) deletes the subscription. Same response whether or not the token exists.

### 13. Personal data & retention

| Data | Lawful basis | Where | Retention |
|---|---|---|---|
| Guest email address | Consent (Art. 6(1)(a)), event-specific | `rsvp_email_subscriptions` | Until RSVP deleted (withdraw/host removal/event deletion), unsubscribe, hard bounce/complaint, or **2 days after the event ended or was cancelled** (hourly `run_retention`), whichever is first |
| Consent timestamp + consent text version | Accountability (Art. 7(1)) | same row | Same as the email |
| Unsubscribe token | Needed to honour unsubscribe | same row | Same as the email |
| Salted email hash in rate-limit bucket | Legitimate interest (abuse prevention) | `rsvp_rate_limits` | 24 hours |
| Expo push token, platform, device locale | Contract (app feature) + OS permission | `push_tokens` | Until sign-out, `DeviceNotRegistered`, account deletion, or 180 days without app start |
| Notification records (kind, event, payload incl. RSVP ids, delivery status, provider message id) | Legitimate interest (reliable delivery, debugging) | `notifications`, `notification_deliveries` | Deleted 30 days after processing; immediately with the event/account/RSVP via cascade |
| Announcement text (may contain anything the host writes) | Contract (host's event) | `event_announcements` | With the event; body erased on delete, row removed 24 h later |
| Email content at the provider | Processor under DPA | Resend (EU region) | Provider log retention set to the minimum offered |
| Push content at Expo/APNs/FCM | Processors (US) under SCCs | — | Transient; payload kept minimal (title, short text, deep link) |

Account deletion: `push_tokens`, notifications targeted at the user and their deliveries cascade from `profiles`; no change to the `delete-account` function is needed (pgTAP verifies the cascade).

### 14. Testing approach

- **pgTAP:** RLS for each new table (anon/other user/host/self), `enqueue_notification` dedupe/coalesce, quiet hours incl. DST dates, reminder scheduling, fan-out recipient rules, stale/cancel rules, rate-limit postponement, claim/complete/backoff, at-most-once on expired locks, retention, `upsert_rsvp` email paths, `get_invite` never exposing emails to hosts.
- **Vitest (`packages/shared`):** schemas, template rendering for every kind × locale, unsubscribe headers, scheduling helpers.
- **Deno tests (`supabase/functions`):** worker orchestration with fake transports.
- **Integration (local):** enqueue → worker → message visible in Mailpit's API.
- **Playwright (`apps/web`):** RSVP with email/consent, consent validation, turn-off, unsubscribe page, announcements display.
- **Jest (`apps/mobile`):** permission timing, token register/unregister on sign-in/out, notification URL routing, announcement composer validation.

## Implementation notes (decisions made while applying)

- **Resolving the `event_managers` audience.** `is_event_manager(event_id)` is `auth.uid()`-based, so it cannot list managers. `is_event_manager_for(event_id, user_id)` evaluates that same function as another user (temporarily setting the JWT claims, then restoring them). The audience is resolved as "push tokens whose owner `is_event_manager_for` the event" (managers only get push), and the RSVP digest trigger uses it to skip managers' own RSVPs. This keeps the promise that add-co-hosts only redefines `is_event_manager`.
- **Clock injection.** `hit_rate_limit` and `run_retention` gained a trailing `p_now timestamptz default now()` (old calls still work). Fan-out inserts deliveries due at `least(p_now, now())` so simulated clocks don't push real sends into the future.
- **Reminders** for an old start time are *deleted* while pending (not cancelled), so moving the start back to an earlier value can schedule a reminder again despite the unique `dedupe_key`.
- `notification_deliveries.urgent` stores urgency decided at fan-out (used by `claim_deliveries` to skip rate limits); rate limits are counted once per delivery (first attempt), not per retry.
- Consent and announcement timestamps use `clock_timestamp()` so the confirmation dedupe key and newest-first ordering are distinct within one transaction.
- Extra helpers: `kick_notifications_worker()` (Vault-configured `net.http_post`, no-op without secrets), `email_bounced(provider_message_id)` (used by `email-events`), `mask_email`, `email_consent_version()` (`rsvp-updates-v1`), `random_url_token()`.
- **Unsubscribe page** posts a plain HTML form (`source=page`) to `/api/unsubscribe/<token>`, which redirects (303) to `/u/<token>?done=1`; RFC 8058 clients get `200`. The `mailto:` target in `List-Unsubscribe` is only added when `EMAIL_UNSUBSCRIBE_MAILTO` is configured (nothing processes it otherwise).
- **Shared templates in Deno.** `packages/shared/src/notifications/*` uses explicit `.ts` imports and JSON import attributes, is exported only as `@check-in/shared/notifications` (not from the package root), and the Supabase CLI mounts `packages/shared/src` from the function's `deno.json` import map, so no copy step is needed.
- `NEXT_PUBLIC_EMAIL_UPDATES` must be `'true'` to show the email field (off by default, per the migration plan).
- Edge runtime: SMTP to Mailpit uses a tiny built-in SMTP client (`_shared/email.ts`) rather than a Node mail library.

## Risks / Trade-offs

- [Someone enters another person's email] → explicit consent, confirmation email with unsubscribe in every message, 5 opt-ins per address per day, hard-bounce/complaint deletion, emails only about one event. Double opt-in deferred (see Open Questions).
- [New sending domain lands in spam] → SPF/DKIM/DMARC from day one, plain transactional content, no tracking, low volume.
- [Push lost if the worker crashes mid-send] → accepted trade-off for at-most-once; rare and low-impact.
- [Expo/Apple/Google are US processors] → minimal push payloads, no guest emails or addresses in push; covered in the privacy notice.
- [Shared TS import into Deno may not bundle] → pure-TS module with no Node APIs; fallback is a small build step copying it to `supabase/functions/_shared/generated`.
- [Cron latency up to a minute; long fan-outs for big events] → immediate kick for urgent kinds; events are capped at 500 RSVPs, so fan-out stays small.
- [Host spam via announcements] → 5 per 24 h, quiet hours, per-recipient rate limits.
- [Edits flapping time back and forth] → 5-minute debounce shows only the final state.
- [Cannot verify real iOS push until the Apple account exists] → simulator `simctl push` for UX, unit/integration tests for the pipeline, device verification as a tracked later task.

## Migration Plan

1. Apply migrations (new tables, functions, triggers, new `upsert_rsvp` signature with defaults, `get_invite` additions, kinds seed, retention). Backwards compatible with the deployed web app.
2. Deploy `notifications-worker` and `email-events` Edge Functions; set secrets (`EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`, `WEB_BASE_URL`, `NOTIFICATIONS_WORKER_SECRET`, webhook signing secret); store worker URL + secret in Vault.
3. Enable the cron job (`notifications-worker`). Until then, enqueued rows just wait.
4. Deploy the web app with the email field behind `NEXT_PUBLIC_EMAIL_UPDATES` and enable once a DNS-verified sending domain exists.
5. Ship the mobile build with `expo-notifications`.

Rollback: `cron.unschedule('notifications-worker')` stops all sending immediately; hide the email field with the flag. Data stays consistent because nothing outside the pipeline depends on it.

## Open Questions

- Final sending domain — depends on the product domain still open from the MVP; placeholder config until then.
- Confirm in Resend's DPA where logs/metadata are stored; switch to SES eu-north-1 via the transport interface if needed.
- Exact consent and privacy-notice wording (legal review); the stored `consent_version` lets us change it later.
- Whether to add double opt-in later if abuse shows up; the confirmation email can become a confirm link without schema changes.
