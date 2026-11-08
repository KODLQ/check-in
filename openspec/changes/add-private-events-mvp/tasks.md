# Tasks

## 1. Repository foundation

- [x] 1.1 Create npm workspaces root (`apps/*`, `packages/*`), `.gitignore`, `.nvmrc` (Node 24), shared `tsconfig.base.json`, ESLint + Prettier; verify `npm install` and `npm run lint` succeed at the root
- [x] 1.2 Scaffold `apps/mobile` with Expo (latest SDK, Expo Router, TypeScript); verify it boots in the iOS Simulator showing a placeholder home screen
- [x] 1.3 Scaffold `apps/web` with Next.js App Router + TypeScript; verify `npm run dev -w apps/web` serves a placeholder page
- [x] 1.4 Create `packages/shared` (types, i18n catalogs `sv`/`en`, Zod schemas) with Vitest; verify both apps import a shared constant and `npm test -w packages/shared` passes
- [x] 1.5 Initialise Supabase locally (`supabase init`, `supabase start`), enable PostGIS, add `npm run db:types` that generates types into `packages/shared`; verify local Studio opens and types generate
- [ ] 1.6 Add GitHub Actions CI running lint, typecheck, unit tests and `supabase test db`; verify the workflow passes on a test push

## 2. Database schema and security

- [x] 2.1 Migration: `profiles` table + trigger creating a row on sign-up + RLS; pgTAP tests prove a user can read/update only their own profile
- [x] 2.2 Migration: `events` table (incl. `time_zone`, `location_point geography`, `guest_list_visible`, `cancelled_at`, `time_changed_at`) + RLS host-only; pgTAP tests prove anon and other users get zero rows and cannot write
- [x] 2.3 Migration: `event_invites` with base62 token generation (≥ 64 bits) + revoke/regenerate function + RLS; pgTAP tests cover regeneration revoking the old token
- [x] 2.4 Migration: `rsvps` with status enum, unique constraints and RLS (host read/delete, user own row); pgTAP tests cover host vs. other-user vs. anon access
- [x] 2.5 Functions `get_invite`, `upsert_rsvp`, `withdraw_rsvp` (security definer, hashed guest token, active/ended/cancelled checks, guest-list visibility rules); pgTAP tests for each scenario in specs/event-rsvp and the "invite not found" equivalence in specs/event-invites
- [x] 2.6 `rsvp_rate_limits` table + check function + scheduled cleanup (24h), plus event auto-deletion 12 months after end; pgTAP tests cover limit exceeded and cleanup
- [x] 2.7 Storage buckets `covers` and `avatars` with host/owner-only write policies; verify with a test that a non-owner upload is rejected
- [x] 2.8 Seed script with a demo host, events and RSVPs; verify `supabase db reset` loads it

## 3. Host accounts (mobile)

- [ ] 3.1 Supabase client + session persistence in `apps/mobile`; verify the session survives an app restart
- [ ] 3.2 Email magic-link sign-in with deep-link redirect and an expired-link error state; verify end-to-end against local Supabase (Inbucket)
- [ ] 3.3 Sign in with Apple and Google (dev configs); verify Apple sign-in on the iOS Simulator
- [x] 3.4 First-run display-name screen + optional avatar upload; Jest test that event creation is blocked without a name
- [ ] 3.5 Account deletion flow (confirm dialog → edge function deleting user and cascading data); pgTAP/integration test proves events and RSVPs are gone
- [ ] 3.6 i18n wiring with `expo-localization` (sv/en, en fallback); verify the UI switches when the simulator language is Swedish

## 4. Private events (mobile)

- [x] 4.1 Create-event screen: title, start time, location (required), optional end/description; Zod validation incl. "start in the past"; Jest tests for validation scenarios
- [ ] 4.2 Location search with optional map point (place name + coordinates) and free-text fallback; verify both paths save correctly
- [ ] 4.3 Cover picker: built-in themes, image upload to `covers`, default theme; verify the uploaded image appears on the event screen
- [ ] 4.4 After creation, show the invite link with Share (native share sheet) and Copy; verify on the simulator. Measure that a minimal event can be created in < 30 s
- [ ] 4.5 Event list (upcoming first, then past) with Going/Maybe counts; verify against seed data
- [ ] 4.6 Edit event (sets `time_changed_at` when time changes) and cancel event; verify via the invite page that changes and cancellation show up
- [ ] 4.7 Guest list screen grouped by status with Realtime updates, remove-guest action, guest-list visibility toggle, regenerate link; verify a web RSVP appears live within seconds

## 5. Invite page and RSVP (web)

- [x] 5.1 `/i/[token]` server-rendered page calling `get_invite`: cover, host, date/time in Europe/Stockholm, location with "open in maps", description, cancelled/past/not-found states; Playwright tests for each state
- [x] 5.2 `generateMetadata` + `opengraph-image` (title, date, host, cover; no address or guests); test asserting the meta tags and that the location string is absent
- [x] 5.3 RSVP UI (name + Going/Maybe/Can't go), guest token in cookie + localStorage, change and withdraw; Playwright test for the full guest flow including a reload on the same device
- [x] 5.4 `POST /api/rsvp` route handler with hashed-IP rate limiting calling `upsert_rsvp`/`withdraw_rsvp` with the service role; test that the 11th rapid request is rejected
- [ ] 5.5 "Add to calendar" (.ics download + Google Calendar link); verify the .ics opens in Apple Calendar with correct time zone
- [x] 5.6 sv/en via `Accept-Language` with en fallback; Playwright test with `sv-SE` locale
- [ ] 5.7 Serve `apple-app-site-association` and `assetlinks.json` for `/i/*`, and add Expo Router route `/i/[token]` in the app; verify a link opens the app on the simulator

## 6. Integration checks

- [ ] 6.1 Manually share a real invite link (Vercel preview) into iMessage, WhatsApp, Snapchat, Instagram DM and Discord; record that previews render and the page works in each in-app browser
- [ ] 6.2 Run the full flow on a device: sign in → create → share → RSVP from another phone → see it live → edit → cancel; record any issues as follow-up changes

## Workflow follow-up

- Deploy Supabase project in eu-north-1 and Vercel project (arn1) once a domain is chosen.
- Archive this change with `/opsx:archive` after review, which moves the specs into `openspec/specs/`.
