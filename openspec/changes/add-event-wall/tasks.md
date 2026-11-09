# Tasks

## 1. Database: schema and RLS

- [x] 1.1 Migration: `wall_posts`, `wall_photos`, `wall_blocks` tables (identity check constraints, indexes, FK cascades as in design §1) with RLS enabled and the `wall_posts` select policy for moderators/own user; pgTAP proves anon and non-host users get zero rows from every wall table and cannot insert/update/delete
- [x] 1.2 Migration: `wall_uploads` and `storage_deletion_queue` tables (no policies) plus `after delete` triggers on `wall_photos`/`wall_uploads` that enqueue storage paths; pgTAP proves deleting an event (cascade) and deleting a profile enqueue every photo path
- [x] 1.3 Migration: `events.wall_enabled` (backfill `true`), `profiles.wall_default_enabled` (default `true`), insert trigger copying the host default, and `events_guard` exception allowing a `wall_enabled`-only update after end/cancel; pgTAP covers default-off host, toggle after end, and that other field edits after end are still rejected
- [x] 1.4 Migration: triggers keeping `author_display_name` in sync with `rsvps.display_name` and `profiles.display_name`; pgTAP proves a renamed RSVP renames that guest's posts and no one else's
- [x] 1.5 Migration: private buckets `wall-incoming` (10 MB, JPEG/PNG/WebP/HEIC) and `wall` (no client policies); pgTAP/storage test proves anon and authenticated users cannot read, list or write objects in either bucket

## 2. Database: wall functions

- [x] 2.1 `can_moderate_event(event_id, user_id)` and `wall_can_post(...)` returning `ok` or a reason (`not_attending`, `blocked`, `disabled`, `closed`, `cancelled`); pgTAP matrix: host, going, maybe, declined, no RSVP, blocked, disabled, cancelled, ended+13 days, ended+15 days
- [x] 2.2 `wall_feed` (token or event id, keyset pagination, `mine`/`can_block` flags, `not_found` for unknown/revoked, read-only for cancelled, hidden for non-moderators when disabled, never returns ids/hashes); pgTAP for each case including that its JSON contains no `guest_token_hash`/`user_id`
- [x] 2.3 `wall_reserve_upload` and `wall_mark_upload` (eligibility, 10-photo quota incl. pending uploads, 20 reservations/hour, 500 photos/event, 2 h expiry); pgTAP covers 11th photo rejected, host exempt from quota, expired upload not counted
- [x] 2.4 `wall_create_post` (text ≤ 500 or 1–4 ready uploads, upload ownership/event match, 10 posts/10 min, 1 000 posts/event, atomic insert + upload consumption); pgTAP covers empty post, foreign upload id, pending upload, caps
- [x] 2.5 `wall_delete_post`, `wall_delete_mine`, `wall_block_author`, `wall_unblock`, `wall_set_enabled`; pgTAP proves a guest cannot delete others' posts, moderators can delete any, deletes work after withdraw/cancel/close, and a blocked identity is rejected by `wall_create_post`
- [x] 2.6 Extend `withdraw_rsvp` path (no cascade into posts) and `run_retention()` to purge `wall_uploads` older than 24 h; add `wall_posts` to `supabase_realtime`; regenerate shared types; pgTAP covers withdraw keeping posts and retention purge enqueueing paths

## 3. Shared package

- [x] 3.1 Zod schemas for wall inputs (post body, upload reservation, ids), limit constants (design §7), and sv/en i18n strings for the wall, reasons and errors; verify with Vitest (`npm test -w packages/shared`)

## 4. Web: API and photo processing

- [x] 4.1 Actor resolution helper (guest token from body vs. Supabase bearer token via `auth.getUser`) and `wall:` rate-limit buckets reusing `hit_rate_limit`; Vitest covers invalid/expired JWT, missing guest token, and limit exceeded → 429
- [x] 4.2 Image processing module: magic-byte sniffing, size check, sharp decode with pixel limit, HEIC via WASM decoder, auto-orient, first frame, `full`/`thumb` JPEG without metadata; Vitest with fixtures (GPS-tagged JPEG, PNG with text chunks, HEIC, WebP, animated WebP, renamed text file, decompression bomb) asserting via `exifr` that outputs have no metadata
- [x] 4.3 `POST /api/wall/uploads` (reserve + `createSignedUploadUrl`) and `POST /api/wall/uploads/:id/complete` (process, write to `wall`, delete incoming, mark ready/rejected), Node runtime in `arn1`; Vitest with a mocked service client covers oversize, wrong actor and rejected-file paths
- [x] 4.4 `POST /api/wall/posts`, `DELETE /api/wall/posts/:id`, `DELETE /api/wall/mine` with synchronous storage removal of queued paths; Vitest covers error mapping (`not_found` 404, `closed` 409, `not_attending`/`blocked` 403, `rate_limited` 429)
- [x] 4.5 `GET /api/wall` (token or moderator `eventId`) with batch signed URLs (1 h) and `private, no-store`; moderator routes for blocks and wall toggle; Vitest proves signed URLs are only produced after a successful `wall_feed` and expire in ≤ 3600 s
- [x] 4.6 `DELETE /api/rsvp` accepts `deletePosts` and calls `wall_delete_mine` first; Vitest covers both branches
- [x] 4.7 Vercel Cron route `/api/cron/storage-cleanup` (secret-protected, drains queue with retries, sweeps orphaned incoming objects) and `WALL_ENABLED` flag; verify locally against `supabase start` that a deleted event's files disappear from Storage after one run

## 5. Web: invite page UI

- [x] 5.1 Server-rendered wall section on `/i/[token]` (posts, host label, signed thumbnails, lightbox, "load more", plain-text body, reason messages instead of composer) and read-only wall on the cancelled page; Playwright: non-attendee sees posts but no composer, revoked link shows "invite not found" with no wall, cancelled shows read-only wall
- [x] 5.2 `WallComposer` client component (text counter, file picker, client prechecks for 10 MB / quota / 4 per post, reserve → PUT → complete → post with progress, `router.refresh()` on success); Playwright: Going guest posts text + a GPS-tagged photo, sees it at top, downloaded photo has no EXIF
- [x] 5.3 Own-post delete, "Delete all my posts", and withdraw dialog checkbox "also delete my posts"; Playwright covers delete one, delete all, withdraw keeping posts (still deletable, composer gone) and withdraw deleting posts
- [x] 5.4 Verify link preview metadata and OG image contain no wall content; Playwright snapshot of `generateMetadata` output for an event with posts

## 6. Mobile app

- [x] 6.1 Wall API client (bearer token) and wall screen/tab on the event (feed, pagination, pull-to-refresh, composer with image picker, client-side strip + downscale, upload progress); Jest + RNTL for composer validation; simulator check of posting a photo as a signed-in guest
  - Downscaling is done by the image picker (`quality: 0.8`) instead of `expo-image-manipulator` (no native rebuild); the server re-encodes every photo anyway (design R10).
- [x] 6.2 Host Realtime subscription on `wall_posts` with debounced refetch; simulator check that a post made on the web appears in the host's wall within a few seconds and a deletion disappears
- [x] 6.3 Host moderation: delete any post, delete all by poster, stop/allow posting, blocked list, wall on/off toggle on the event and default toggle in settings; Jest for the menus; simulator check that toggling off hides the wall on the web page
- [x] 6.4 Own-post delete and "delete my posts" option when withdrawing an RSVP in the app; Jest for the withdraw dialog; simulator check

## 7. Integration checks

- [ ] 7.1 End-to-end on staging: Playwright run of the full guest flow plus a scripted account deletion proving the account's posts on another host's event and their Storage files are gone within one cleanup run
  - Not done: needs a staging deployment (Vercel + hosted Supabase). Locally covered by Playwright `e2e/wall.spec.ts`, pgTAP (account deletion removes posts incl. claimed-browser posts and queues their files) and a manual run of `/api/cron/storage-cleanup` that removed a deleted event's files. Also measure HEIC p95 there (design R11).
- [ ] 7.2 Document wall data in the privacy notice / design data table and confirm co-host integration point (`can_moderate_event`) with the `add-co-hosts` change owner; verify the notice renders in sv and en
  - Not done: the design's personal-data table is updated, and the co-host integration is in code (`can_moderate_event` → `is_event_manager`, add-co-hosts already applied), but the product has no privacy notice page yet to add the wall section to and render in sv/en; confirming with the change owner is a human step.
