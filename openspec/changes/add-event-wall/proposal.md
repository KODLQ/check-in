# Proposal

## Why

Today the invite page is a one-way notice: guests RSVP and then the conversation moves to a group chat the host has to set up, and after the party the photos end up scattered across everyone's camera rolls. A shared wall on each event keeps the pre-party chatter ("I'll bring the speaker") and the post-party photos ("post your pics") attached to the invite link people already have, which gives guests a reason to come back to the page and gives hosts a reason to create the next event with us.

## What Changes

- New **event wall** on every private event, shown on the web invite page and in the app: a reverse-chronological feed of short text posts (≤ 500 characters) and photos.
- **Who can read**: anyone with the active invite link (same audience as the invite page). Revoked links keep showing "invite not found". Cancelled events keep the wall visible but read-only.
- **Who can post**: the host, and guests whose current RSVP is Going or Maybe, using the same identity as their RSVP (device guest token on the web, account in the app). Posts show the poster's display name. Posting stays open for 14 days after the event ends so the wall turns into the photo wall, then the wall becomes read-only.
- **Photos**: JPEG, PNG, WebP or HEIC up to 10 MB each, at most 10 photos per guest per event. Every photo is re-encoded server-side with all metadata (EXIF/GPS) removed, whatever the client did. Photos live in a **private** storage bucket and are only served through short-lived signed URLs issued after an invite-token or host check. Web uploads go straight to storage through a single-use signed upload URL that the web server issues only after token, eligibility and rate-limit checks.
- **Guest control over their content**: a guest can delete any of their own posts at any time, and can delete all their posts on an event in one action. Withdrawing an RSVP keeps past posts by default and offers to delete them in the same step.
- **Host moderation** (host and co-hosts): delete any post, turn the wall on/off per event (with a default in the host's settings), and stop a specific guest from posting. Per-guest and per-event rate limits and caps.
- **Live updates**: the host app updates the wall live; the web page refreshes after the visitor posts or deletes.
- **Retention**: posts and photos are deleted with the event (including the existing 12-month auto-deletion) and with the poster's account.
- Changes to existing behavior: RSVP withdrawal now leaves wall posts in place unless the guest also chooses to delete them; account deletion also removes the person's wall posts on other hosts' events.

### Out of scope

- Reactions/likes, threaded replies, @mentions and link previews inside posts (URLs are shown as plain text).
- Video, GIFs, and animated images (only the first frame of an animated image is kept).
- Reporting content to platform admins / trust & safety review. Not needed while every wall is private and host-moderated, but required before walls exist on public events.
- Push notifications to guests about wall activity. (Hosts and co-hosts get a batched count-only push through the existing `notifications` capability.)
- Host announcements/broadcasts to guests (owned by `event-announcements` in `add-guest-updates`; the wall is two-way chatter, announcements are one-way from the host).
- Bulk photo download / album export for hosts.

## Capabilities

### New Capabilities
- `event-wall`: The per-event feed of text and photo posts: who can read and post, photo upload rules and privacy, guest deletion of their own content, host moderation, rate limits, live updates and retention.

### Modified Capabilities
- `event-rsvp`: "Change or withdraw RSVP" — withdrawing keeps wall posts unless the guest chooses, in the same step, to delete them too.
- `user-accounts`: new requirement "Wall content removed with account" — deleting an account also deletes its wall posts and photos on any event (incl. posts made from a browser it claimed). Added separately because the merged "Account deletion" text would exceed the 500-character limit.
- `notifications`: new requirement "Host wall digest" — batched, count-only push to the host and co-hosts when guests post.

## Impact

- **Database** (`supabase/migrations`): new tables `wall_posts`, `wall_photos`, `wall_uploads`, `wall_blocks`, `storage_deletion_queue`; new columns `events.wall_enabled` and `profiles.wall_default_enabled`; new security-definer functions for reading, posting, deleting and moderating; `run_retention()` extended; Realtime publication gains `wall_posts`.
- **Storage**: two new private buckets (`wall-incoming` quarantine, `wall` processed photos) with no client-facing policies.
- **Web** (`apps/web`): new route handlers under `/api/wall/*` (upload reservation, upload completion/processing, post create/delete, read, moderation for app clients); wall section on `/i/[token]` including cancelled state; withdraw flow gains a "also delete my posts" option. New dependency on `sharp` (and a HEIC decoder) for server-side re-encoding.
- **Mobile** (`apps/mobile`): wall screen for hosts and signed-in guests with Realtime, photo picker and upload, moderation actions, wall on/off toggle and default setting.
- **Shared** (`packages/shared`): Zod schemas for wall inputs, limits as constants, i18n strings (sv/en), regenerated DB types.
- **Integration points** (all already applied): `add-co-hosts` (moderation = owner + co-hosts via `is_event_manager`), `add-guest-updates` (`wall_digest` notification kind), `add-guest-capacity` (waitlisted guests cannot post), `add-my-invites` (claimed RSVPs keep their browser hash: both identities own the posts), `add-date-polls` (pending events: only hosts post; voters cannot).
