# Design

## Context

Greenfield repository: nothing exists yet besides OpenSpec. See proposal.md for motivation and specs/ for required behavior. The two hard constraints that shape the architecture:

1. **Invite pages must be server-rendered.** Chat apps' link-preview crawlers do not run JavaScript, so per-event Open Graph tags and preview images must come from the server.
2. **Guests have no account.** Every guest action goes through the invite token, never through direct table access.

## Goals / Non-Goals

**Goals:**
- A monorepo that will also hold public events, friends and check-ins later without restructuring.
- All authorization enforced in Postgres (RLS + narrowly scoped functions), so the client can never leak a private event.
- Invite page loads fast inside in-app browsers (small JS, server-rendered HTML).

**Non-Goals:**
- Offline support in the host app.
- A web version of the host app (hosts use iOS/Android for now; the web only serves invite pages).
- Analytics/telemetry beyond basic error reporting.

## Decisions

### 1. Monorepo: Expo app + Next.js invite site + shared package

```
apps/mobile     Expo (SDK latest), Expo Router, TypeScript — host app (iOS/Android)
apps/web        Next.js (App Router) — invite pages, OG images, RSVP endpoint, deep-link files
packages/shared Types generated from the DB, i18n catalogs (sv/en), validation schemas, date helpers
supabase/       Migrations, RLS policies, seed data, pgTAP tests
```
npm workspaces (npm is already installed; no extra tooling).

- **Why Next.js for the invite site instead of Expo web:** Expo web is mainly a static/client-rendered SPA, and its server rendering is still maturing. Next.js renders HTML and OG tags per request and generates preview images (`next/og`) out of the box. The invite page is small and mostly read-only, so a second framework costs little.
- **Alternative considered:** Supabase Edge Function serving raw HTML. Rejected: we would have to build templating, i18n and image generation ourselves.

### 2. Hosting

- Supabase project in **eu-north-1 (Stockholm)**.
- `apps/web` on Vercel with functions pinned to the **arn1 (Stockholm)** region, on a custom short domain (see Open Questions).
- Mobile builds with EAS Build.

### 3. Data model

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | `id` (= auth.users.id), `display_name`, `avatar_path`, `locale` | Created on first sign-in |
| `events` | `id`, `host_id`, `title`, `description`, `starts_at timestamptz`, `ends_at`, `time_zone` (default `Europe/Stockholm`), `location_text`, `location_point geography(Point)` (PostGIS, nullable), `place_name`, `cover_path`, `theme`, `guest_list_visible bool`, `cancelled_at`, `time_changed_at` | PostGIS enabled now so public events can reuse it |
| `event_invites` | `token` (PK, 12 chars base62 ≈ 71 bits), `event_id`, `created_at`, `revoked_at` | One active row per event; regeneration revokes and inserts |
| `rsvps` | `id`, `event_id`, `user_id` (nullable), `guest_token_hash` (nullable), `display_name`, `status` enum(`going`,`maybe`,`declined`), timestamps | Unique on (`event_id`,`user_id`) and (`event_id`,`guest_token_hash`) |
| `rsvp_rate_limits` | `bucket` (hashed IP + event), `window_start`, `count` | Rows expire after 24h |

"Ended" is computed: `coalesce(ends_at, starts_at + interval '12 hours') < now()`.

### 4. Authorization (RLS)

- `profiles`: owner can select/update their own row. Other users' names reach guests only through the invite functions below.
- `events`: `select/insert/update/delete` only where `host_id = auth.uid()`. **No anon policy at all.**
- `event_invites`: host can select/insert/update rows of their own events. No anon policy.
- `rsvps`: host of the event can select/delete. A signed-in user can select/update/delete their own row (`user_id = auth.uid()`). No anon policy.
- `rsvp_rate_limits`: no policies (only reachable from security-definer functions).
- **Guest access goes only through `SECURITY DEFINER` functions** that take the invite token:
  - `get_invite(token, guest_token?)` → event details safe for guests, host name/avatar, counts, guest list (only if `guest_list_visible`, only going/maybe), and the caller's own RSVP if `guest_token` matches.
  - `upsert_rsvp(token, guest_token, display_name, status)` → validates the event is active, then upserts by `guest_token_hash`.
  - `withdraw_rsvp(token, guest_token)`.
  These functions return the same "not found" result for unknown, revoked, or deleted invites.
- Storage bucket `covers`: public read on the object path (paths are random UUIDs), write only by the event's host. `avatars` similarly.

### 5. Guest identity

The invite page generates a random 128-bit `guest_token` on the first RSVP and stores it in a first-party cookie (plus localStorage as fallback for in-app browsers that drop cookies). The database stores only its SHA-256 hash. This satisfies "change from the same device" without accounts. Losing it just makes the guest new again (accepted in the spec).

### 6. RSVP write path and rate limiting

The browser posts to a Next.js route handler (`POST /api/rsvp`), not to Supabase directly. The handler hashes the client IP with a rotating salt, checks `rsvp_rate_limits` (e.g. max 10 RSVP writes per IP per event per 10 min, and max 500 RSVPs per event), then calls `upsert_rsvp` with the service role. **Why:** Postgres functions can't see the client IP, and keeping the anon key away from write paths shrinks the attack surface.

### 7. Link previews

`apps/web/app/i/[token]/page.tsx` renders HTML with `generateMetadata` (title, "Sat 14 Dec 20:00 · hosted by Anna"). `opengraph-image.tsx` renders a 1200×630 card from cover + title + date. Location and guests are never included (spec). Response cached at the edge for a short time and invalidated when the event is edited.

### 8. Auth

Supabase Auth with email OTP magic links, Apple and Google providers. Mobile uses `expo-auth-session`/`expo-apple-authentication` with a deep-link redirect. A trigger creates the `profiles` row; the app blocks event creation until `display_name` is set.

### 9. Deep links

`apps/web` serves `/.well-known/apple-app-site-association` and `/.well-known/assetlinks.json` for paths `/i/*`, so installed apps open invite links (Expo Router route `/i/[token]`).

### 10. Live guest list

The host app subscribes to Supabase Realtime `postgres_changes` on `rsvps` filtered by `event_id`. Realtime respects RLS, so only the host receives the rows.

### 11. i18n

`packages/shared/i18n/{sv,en}.json` used by both apps (i18next). Locale comes from the device (`expo-localization`) or the `Accept-Language` header on the web, with English as fallback.

### 12. Testing

- **Database:** pgTAP tests (`supabase test db`) for every RLS policy and invite function. This is the security boundary, so it gets the most tests.
- **Shared:** Vitest for validation and date logic.
- **Web:** Playwright for the guest flow (open invite → RSVP → change → withdraw), plus snapshot checks of OG metadata.
- **Mobile:** Jest + React Native Testing Library for create-event form validation; manual checks in the iOS Simulator.

## Personal data & retention

| Data | Lawful basis | Retention |
|---|---|---|
| Host email, display name, avatar | Contract (account) | Until account deletion |
| Event content | Contract | Until host deletes event/account. Events auto-deleted 12 months after they end |
| Guest display name + RSVP status | Legitimate interest (host organising an event the guest chose to answer) | Deleted with the event, or by the guest withdrawing |
| Hashed guest token | Same as above | Same as the RSVP |
| Hashed IP in rate-limit buckets | Legitimate interest (abuse prevention) | 24 hours |

No location of guests or hosts is collected in this change.

## Risks / Trade-offs

- [Cookies/localStorage wiped by in-app browsers (Instagram/Snapchat webviews)] → guest becomes "new" and may create a duplicate. Mitigation: host can remove duplicates. Later: optional "remember me" via phone/email.
- [Anyone with the link can RSVP with any name] → accepted for MVP (same as Partiful). Mitigation: rate limits, host removal, link regeneration.
- [Two frameworks (Expo + Next.js) to maintain] → shared package for types/i18n/validation keeps duplication low.
- [Link-preview caching by chat apps shows stale details after edits] → can't be controlled. The page itself is always fresh.
- [Free-text cover uploads could contain inappropriate content] → host-owned private events lower the risk. Add reporting with public events.

## Migration Plan

First deploy, so no migration. Supabase migrations are versioned in `supabase/migrations` and applied by CI. The web app deploys on merge to `main`.

## Open Questions

- Product name and short domain for invite links (e.g. `xyz.se/i/AbC123`). Placeholder config value until decided.
- Apple Developer and Google Play accounts. Needed before store builds but not for development.
