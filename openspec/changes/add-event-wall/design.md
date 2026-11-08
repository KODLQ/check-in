# Design

## Context

See proposal.md for motivation and specs/event-wall for the required behavior. What exists today and constrains this design:

- **Guests never touch tables.** Every guest read and write goes through security-definer functions keyed by the invite token (`get_invite`, `upsert_rsvp`, `withdraw_rsvp`). Guest writes go through Next.js route handlers (`apps/web/src/app/api/rsvp/route.ts`) that hash the client IP, call `hit_rate_limit`, then call service-role-only RPCs. `open_event_for_token` resolves token → event and rejects cancelled/ended events.
- **Guest identity** is a random device token (cookie `ci_guest` + localStorage); the DB stores only `hash_guest_token()` (SHA-256 hex). Signed-in users are identified by `auth.uid()`.
- **Storage** has only public buckets (`covers`, `avatars`), written directly by the owner from the app. The app strips JPEG metadata client-side (`apps/mobile/src/lib/strip-metadata.ts`) but nothing is processed server-side.
- `events_guard` rejects every update to an event once it has ended; `run_retention()` deletes events 12 months after they end (hourly pg_cron).
- Realtime is used for `rsvps` with host-only RLS.
- Vercel route handlers have a ~4.5 MB request body limit, so 10 MB photos cannot be posted through Next.js.

## Goals / Non-Goals

**Goals:**
- One write path for all clients (web guests, app guests, hosts) so eligibility, rate limits and photo processing cannot be bypassed.
- No photo byte reaches any viewer unless the server has decoded and re-encoded it.
- Wall content is exactly as private as the invite page: no public URLs, no direct table access for anon.
- Moderation checks go through one helper so `add-co-hosts` can extend them in one place.

**Non-Goals:**
- Live updates on the web invite page (no anon Realtime; refresh-on-action is enough).
- Image CDN / on-the-fly resizing; we store two fixed renditions.
- Content scanning (nudity/CSAM hashing). Revisit together with platform-admin reporting before public events get walls.

## Decisions

### 1. Data model

| Table | Key columns | Notes |
|---|---|---|
| `wall_posts` | `id`, `event_id` → events (cascade), `author_user_id` → profiles (cascade, nullable), `author_guest_hash` (nullable), `author_display_name`, `is_host`, `body` (≤ 500, nullable), `created_at` | Check: exactly one identity; `body` or ≥ 1 photo enforced in the create function. Index `(event_id, created_at desc)` |
| `wall_photos` | `id`, `post_id` → wall_posts (cascade), `event_id`, author identity columns, `full_path`, `thumb_path`, `width`, `height`, `position` | Identity duplicated for cheap quota counts. Index `(event_id, author_guest_hash)`, `(event_id, author_user_id)` |
| `wall_uploads` | `id`, `event_id` → events (cascade), author identity, `incoming_path`, `status` (`pending`/`ready`/`rejected`), `full_path`, `thumb_path`, `width`, `height`, `expires_at`, `created_at` | Staging rows. Consumed (deleted) when a post is created; expired rows purged by retention |
| `wall_blocks` | `event_id` → events (cascade), author identity, `display_name`, `created_at` | Unique per (event, identity) |
| `storage_deletion_queue` | `id`, `bucket`, `path`, `enqueued_at`, `attempts` | Filled by triggers; drained by the web app |
| `events.wall_enabled` | `boolean not null` | Set from the host's default on insert |
| `profiles.wall_default_enabled` | `boolean not null default true` | Host setting |

- **Identity snapshot**: `author_display_name` is copied from the RSVP (guests) or profile (users/host) at post time, and a trigger on `rsvps`/`profiles` updates it when the name changes, so the wall always matches the guest list. Posts are deliberately **not** foreign-keyed to `rsvps`: withdrawing or host removal must not cascade into posts (spec: posts kept unless the guest chooses).
- Existing events get `wall_enabled = true` in the migration.
- `events_guard` is changed to allow an update that changes **only** `wall_enabled` after the event has ended or been cancelled (otherwise the host could not close the photo wall afterwards).

### 2. RLS

- `wall_posts`: `select` for authenticated users where `can_moderate_event(event_id, auth.uid())` (needed for host Realtime) or `author_user_id = auth.uid()`. No insert/update/delete policies — all writes via service-role functions. No anon policy.
- `wall_photos`, `wall_uploads`, `wall_blocks`, `storage_deletion_queue`: RLS enabled, **no policies** (service role / security-definer only). Hosts read photos and blocks through the API, which returns signed URLs.
- `storage.objects` for buckets `wall-incoming` and `wall`: **no policies** for anon or authenticated. Only the service role (web server) reads, writes, signs and deletes. Uploads from clients happen only through signed upload URLs, which bypass RLS by design but are scoped to one pre-chosen path.
- pgTAP proves anon and a non-host authenticated user get zero rows from every wall table and cannot write any of them.

### 3. One write path: `/api/wall/*` on the web app, service-role RPCs

All wall operations go through Next.js route handlers, for web and app alike:

| Route | Purpose |
|---|---|
| `GET /api/wall?token=…&before=…` / `GET /api/wall?eventId=…` | Feed page (30 posts) with signed photo URLs; `eventId` form requires a moderator bearer token |
| `POST /api/wall/uploads` | Reserve an upload → returns `{uploadId, signedUploadUrl}` |
| `POST /api/wall/uploads/:id/complete` | Process the uploaded file (decision 5) |
| `POST /api/wall/posts` | Create post from `body` + ready `uploadIds` (≤ 4) |
| `DELETE /api/wall/posts/:id` | Delete own post, or any post as moderator |
| `DELETE /api/wall/mine` | Delete all own posts on the event (also used by RSVP withdraw) |
| `POST/DELETE /api/wall/blocks`, `PATCH /api/wall/settings` | Moderator actions (block/unblock by post id, toggle wall) |

- **Actor resolution**: web guests send `token` + `guestToken` (same Zod schema as RSVP). The app sends `Authorization: Bearer <Supabase access token>`; the route verifies it with `auth.getUser(jwt)` and passes the user id. The route never trusts a client-supplied user id.
- **RPCs** (`wall_feed`, `wall_reserve_upload`, `wall_mark_upload`, `wall_create_post`, `wall_delete_post`, `wall_delete_mine`, `wall_block_author`, `wall_unblock`, `wall_set_enabled`) are `security definer`, granted to `service_role` only, and take `(p_token | p_event_id, p_user_id, p_guest_token, …)`. They hash the guest token themselves and return the same `not_found` for unknown/revoked tokens as `get_invite`.
- **Why not direct RPCs from the app**: photos must pass through server processing anyway, IP rate limiting is only possible in the web tier, and one path means one set of tests. Cost: the app depends on the web app being up for wall features (acceptable; it already does for invite links).
- **Eligibility** lives in one SQL function `wall_can_post(event, user_id, guest_hash)` returning `ok` or a reason (`not_attending`, `blocked`, `disabled`, `closed`, `cancelled`): host → ok; else RSVP with status `going`/`maybe` and not in `wall_blocks`; and `wall_enabled`; and not cancelled; and `now() < event_ended_at + 14 days`. The feed returns this reason so the UI can explain why the form is hidden.
- **Moderation helper**: `can_moderate_event(p_event_id, p_user_id)` (explicit user id, because `auth.uid()` is null under the service role). Today it equals `events.host_id = p_user_id`; `add-co-hosts` extends it to co-hosts. Every moderator check in this change uses it.

### 4. Read path and private photo delivery

- `wall_feed` returns posts newest first (keyset pagination on `created_at, id`), each with `display_name`, `is_host`, `body`, `created_at`, photo paths and dimensions, and `mine`. It never returns user ids or guest hashes; for moderators each post also carries `can_block`. It works for cancelled events (read-only) but returns `not_found` for revoked links and `disabled` (no posts) to non-moderators when the wall is off.
- The server then calls `createSignedUrls` (service client) for thumb and full renditions with a **1-hour** expiry. The invite page does this during server rendering, so photos appear in the first HTML; `GET /api/wall` does the same for pagination and for the app.
- Responses are `Cache-Control: private, no-store`. Image `<img>` tags use `referrerpolicy="no-referrer"`.
- **Alternative considered**: an access-checked proxy route streaming each image. Rejected: every image would cost a function invocation in Stockholm and add latency in in-app browsers; signed URLs are served by the Storage CDN. Trade-off: a copied signed URL works for up to an hour.

### 5. Photo pipeline

1. **Reserve** (`POST /api/wall/uploads` with `contentType`, `size`): route applies IP rate limit, rejects `size > 10 MB` or unknown type early, then `wall_reserve_upload` checks eligibility, the 10-photo quota (existing photos + non-expired pending/ready uploads), per-event caps and per-poster upload rate, and inserts a `pending` row with `incoming_path = <event_id>/<upload_id>` and `expires_at = now() + 2h`. The route returns `createSignedUploadUrl` for that path in bucket `wall-incoming`. Paths are unique and `upsert` is off, so the URL can be used once.
2. **Upload**: client `PUT`s the file directly to Storage (bypasses the Vercel body limit). Bucket `wall-incoming` enforces `file_size_limit = 10 MB` and the MIME allow-list on the header.
3. **Complete** (`POST /api/wall/uploads/:id/complete`): route downloads the object, checks real size, sniffs magic bytes (`file-type`) for JPEG/PNG/WebP/HEIC, decodes (sharp; HEIC through a libheif WASM decoder then sharp), with `limitInputPixels` ≈ 50 MP against decompression bombs, first frame only. It auto-orients, resizes to `full` (max 2048 px) and `thumb` (max 640 px), and encodes **JPEG** with no metadata (sharp drops EXIF/XMP/IPTC unless `withMetadata` is called; ICC is converted to sRGB). Results go to private bucket `wall` at `<event_id>/<upload_id>/{full,thumb}.jpg`; the incoming object is deleted; the row becomes `ready` (or `rejected`, with the incoming object deleted). Runs on the Node runtime, region `arn1`, `maxDuration` 30 s, 1 GB memory.
4. **Post** (`POST /api/wall/posts`): `wall_create_post` re-checks eligibility and caps, verifies each upload is `ready`, belongs to the same actor and event, then in one transaction inserts the post and `wall_photos` rows and deletes the upload rows.

- The app keeps its client-side JPEG strip and downscales with `expo-image-manipulator` before uploading (saves bandwidth), but the server pipeline is identical.
- **Why JPEG output**: decodes everywhere, including old in-app webviews and the story share card renderer. **Alternative**: Supabase image transformations — rejected because the original (with EXIF) would still be stored and served-on-request.
- **Why not a Supabase Edge Function**: sharp/libvips doesn't run on Deno; pure-JS encoders are too slow for 10 MB inputs.

### 6. Deletion and storage cleanup

- Postgres cannot delete Storage objects directly. `after delete` triggers on `wall_photos` and `wall_uploads` insert their paths into `storage_deletion_queue`. FK cascades fire these triggers, so event deletion, `run_retention()` and account deletion are covered automatically.
- On user-initiated deletes, the route drains the queue rows for that post synchronously (`storage.remove`) before responding, so the photos stop loading immediately. A Vercel Cron route (`/api/cron/storage-cleanup`, every 10 min, `CRON_SECRET`) drains the rest, with retries and an alert after 5 attempts.
- `run_retention()` additionally marks `wall_uploads` older than 24 h for deletion (which enqueues their objects) and also deletes orphaned `wall-incoming` objects with no row via the cron route.
- **RSVP withdraw**: `DELETE /api/rsvp` accepts `deletePosts: boolean`; when true, the route calls `wall_delete_mine` before `withdraw_rsvp`. In the app, withdrawing (direct RLS delete on `rsvps`) is followed by `DELETE /api/wall/mine` when the option is chosen.
- Host removal of a guest's RSVP does not touch posts.

### 7. Rate limits and caps

Shared constants in `packages/shared` (tunable without spec change):

| Limit | Value | Where |
|---|---|---|
| Wall writes per IP + invite | 30 / 10 min | `hit_rate_limit`, bucket `wall:<iphash>:<token>` |
| Feed reads per IP | 120 / 10 min | `hit_rate_limit` (signing is not free) |
| Posts per poster per event | 10 / 10 min | `wall_create_post` (count of recent posts) |
| Upload reservations per poster per event | 20 / hour | `wall_reserve_upload` |
| Photos per guest per event | 10 | `wall_reserve_upload` + `wall_create_post` |
| Posts per event | 1 000 | `wall_create_post` |
| Photos per event | 500 | reserve + create |

Rate-limit buckets reuse `rsvp_rate_limits` (24 h retention unchanged).

### 8. Live updates

- **App (hosts)**: `wall_posts` is added to `supabase_realtime`. The host wall screen subscribes to `postgres_changes` filtered by `event_id`; RLS limits delivery to moderators. Any insert/delete triggers a debounced (1 s) refetch of the first page via `GET /api/wall?eventId=` because signed URLs must come from the server anyway.
- **App (guests)** and **web**: refetch/`router.refresh()` after the user's own post or delete, on pull-to-refresh and on tab focus. No anon Realtime.
- **Notifications**: `add-guest-updates` can attach its batched host push to `wall_posts` inserts (trigger into its outbox). No notification logic lives in this change.

### 9. UI placement

- Web: wall section on `/i/[token]` below the guest list; also rendered for `cancelled` (the page currently shows only `NotFound` for cancelled — it gains the read-only wall). A client `WallComposer` handles text, file input (`accept` JPEG/PNG/WebP/HEIC), client-side size/count prechecks and the reserve → PUT → complete → post sequence with per-photo progress. "Delete all my posts" lives in a small "Your posts" menu; the withdraw dialog gets a checkbox.
- App: event screen tab "Wall" for hosts and for signed-in guests who opened an invite; host gets delete, "stop posting", wall toggle; settings screen gets the default toggle.
- Text is rendered as React text nodes (escaped), no linkification. sv/en strings in `packages/shared`.

### 10. Testing

- **pgTAP**: RLS on every new table; each RPC across host / going / maybe / declined / no RSVP / blocked / disabled / cancelled / past+13d / past+15d / revoked token; quota and caps; cascade triggers enqueueing storage paths; `events_guard` wall-toggle exception; retention purge of uploads.
- **Vitest** (`apps/web` lib + `packages/shared`): Zod schemas; image processing module with fixtures (JPEG with GPS EXIF, PNG with tEXt, HEIC, WebP, renamed non-image, decompression bomb) asserting via `exifr` that outputs carry no metadata.
- **Playwright**: guest RSVP Going → post text + photo → see it → delete; withdraw keeping vs. deleting posts; cancelled and revoked pages; non-attendee sees no composer.
- **Jest + RNTL** (mobile) for composer validation and moderation menus; **iOS Simulator** manual check of Realtime and photo upload.

## Personal data & retention

| Data | Lawful basis | Retention |
|---|---|---|
| Post text and photos (may show other people) | Legitimate interest of host and guests in sharing an event they attend; poster chooses to publish to the invite audience | Until deleted by poster or host, the event is deleted (incl. 12 months after end), or the poster's account is deleted |
| Poster display name (snapshot, kept in sync with RSVP/profile) | Same as above | Same as the post |
| Guest token hash / user id on posts, photos, uploads, blocks | Needed to let the poster delete their content and enforce quotas/blocks | Same as the row it is on |
| Block entries (identity + display name) | Legitimate interest (host moderation) | Until unblocked or event deleted |
| Staged uploads (incl. original files with EXIF) | Processing step only | Deleted on processing or within 24 h; never served |
| Hashed IP in rate-limit buckets | Abuse prevention | 24 hours (unchanged) |

Photo metadata (EXIF/GPS) is never retained beyond the incoming bucket. When account data export is added, it must include the account's wall posts and photos.

## Risks / Trade-offs

- [Guest clears cookies or uses another device → cannot delete their own posts] → UI states "you can delete your posts from this device"; host can delete on request; the privacy notice tells guests to ask the host.
- [Blocked guest returns with a new device token] → accepted (same as RSVP spam today); host can regenerate the link and delete posts.
- [Signed photo URL forwarded outside the group] → valid for at most 1 hour; accepted.
- [Inappropriate/illegal images on a private wall] → host moderation now; platform reporting and scanning required before public events (out of scope).
- [HEIC decoding in WASM is slow/memory-heavy] → pixel limit, 1 GB function memory; iOS Safari usually converts HEIC to JPEG on upload anyway. Measure p95 in staging.
- [Storage objects orphaned if queue draining fails] → retries, alert after 5 attempts, cron also sweeps incoming objects without rows.
- [Web app outage disables wall writes from the app] → accepted; RSVPs in the app are unaffected.
- [Storage cost] → caps of 500 photos/event at ≤ ~1 MB per full rendition; deleted with the event.

## Migration Plan

1. Additive migration: new tables, columns (`wall_enabled` backfilled `true`), functions, buckets, triggers, Realtime publication, `events_guard` change, `run_retention()` update. Regenerate shared types.
2. Deploy web (routes + cron) with the wall section behind env flag `WALL_ENABLED`; then enable the flag in staging, run Playwright, then production.
3. Ship the app update; older app versions simply don't show the wall.
4. Rollback: turn off `WALL_ENABLED` (hides UI and makes `/api/wall/*` return 404). Data stays; a down-migration is only needed if the feature is abandoned.

## Open Questions

- Exact numeric caps and rate limits (section 7) may need tuning after real usage; they are constants, not spec values.
- Whether hosts should later get "download all photos" (would be a separate change).
