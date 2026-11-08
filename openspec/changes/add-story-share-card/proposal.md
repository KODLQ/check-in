# Proposal

## Why

Invites today only look good as chat link previews (1200×630 card). Our audience spreads plans through Instagram Stories and Snapchat, where a landscape preview card does not fit and a bare link is easy to ignore. A tall, good-looking story image of the event is the cheapest growth lever we have: every host (and every excited guest) becomes a distribution channel, with no new backend data.

## What Changes

- New server-rendered **story image** per invite: 1080×1920 (9:16) PNG with the event cover or theme, title, date and time, host name, a short call to action and the invite URL as text. Same privacy rule as link previews: no address, no description, no guest list.
- The story image is served only for active invites. Unknown, revoked, deleted, cancelled and ended events return the same "not found" response with no image. After an edit, the image reflects the new details.
- Host app: a **Share to Story** action on the event screen that sends the story image to Instagram Stories or Snapchat when the app is installed (and integration is configured), with the invite link ready to attach, and falls back to the native share sheet with image + link otherwise.
- Web invite page: a **Share** action for guests that shares the story image file and link through the browser share sheet where supported, otherwise offers "Save image" and "Copy link".
- Existing link previews and the existing "Share invite" action are unchanged.

**Out of scope:**
- TikTok and any other destination beyond Instagram Stories, Snapchat and the native share sheet.
- Analytics, attribution or tracking of who shared or which share brought a guest.
- Custom story templates, stickers or layouts beyond the existing built-in themes and uploaded covers.
- Video or animated story formats.
- Sharing past, cancelled or revoked events.

## Capabilities

### New Capabilities

_None._ Story sharing is another way of spreading the invite link, so it belongs with the existing invite-sharing behaviors.

### Modified Capabilities

- `event-invites`: adds requirements for the story image (content, privacy, availability, freshness, language), for sharing it from the host app (Instagram Stories, Snapchat, share-sheet fallback) and for guests sharing it from the web invite page. No existing requirement changes behavior.

## Impact

- **apps/web**: new story image route under `/i/[token]/` built with `next/og` (sharing layout helpers with the existing `opengraph-image.tsx`), render caching keyed by event content, and a small client "Share" component on the invite page.
- **apps/mobile**: new Share to Story action on `events/[id]`, a native sharing dependency for Instagram Stories / Snapchat (requires a development build, already the case), iOS `LSApplicationQueriesSchemes` and Android package-visibility config, file download to cache.
- **packages/shared**: i18n strings (sv/en) for the call to action and share UI; a helper that formats the short invite URL for display.
- **supabase**: no schema or RLS changes. `get_invite` already returns everything the image needs.
- **External setup (not blocking)**: a Facebook App ID for Instagram Stories sharing and a Snap Kit client ID (with Snap app review) for Snapchat Creative Kit. Without them the app uses the share-sheet fallback.
