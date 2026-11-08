# Design

## Context

See proposal.md (Why) and specs/event-invites/spec.md for the required behavior. Current state that shapes the approach:

- `apps/web/src/app/i/[token]/opengraph-image.tsx` renders the 1200×630 preview with `next/og` from `getInvite(token)` (the `get_invite` security-definer RPC via the anon client). It renders a placeholder image for not-found/cancelled invites and has **no explicit caching** today (the MVP design's "invalidated on edit" was never implemented).
- `get_invite` returns `state` (`not_found` | `cancelled` | `active` | `past`), the guest-safe event fields, and host display name/avatar. `events.updated_at` exists but is not returned.
- The host event screen `apps/mobile/src/app/events/[id]/index.tsx` shares the link with React Native `Share.share` and copies with `expo-clipboard`. Share actions show only when the event is editable (not ended, not cancelled).
- The mobile app already needs a development build (Apple sign-in, `expo-sharing` plugin), so native modules without Expo Go support are acceptable.
- No new tables are needed: everything the image shows is already guest-visible through `get_invite`.

## Goals / Non-Goals

**Goals:**
- One image endpoint used by the host app, the web page and any future surface.
- The share-sheet fallback works in every build, with no third-party IDs.
- Revocation and cancellation take effect within a minute, even for already-shared image URLs.

**Non-Goals:**
- Changing the existing OG preview's behavior (only shared layout helpers are extracted).
- Pre-generating or storing images in Supabase Storage.
- Android/iOS share extensions or widgets.

## Decisions

### 1. Story image as a route handler next to the OG image

`GET /i/[token]/story` (route handler returning `ImageResponse`, 1080×1920 PNG), not a second `opengraph-image` file convention. The OG file convention is wired into page metadata; the story image must not be advertised as a preview image, and it needs custom status codes and cache headers.

- Layout: full-bleed cover (`object-fit: cover`) or theme gradient top ~60%, dark gradient scrim, then title (max 3 lines, ellipsis), date/time via `formatEventTime`, "hosted by {name}", a pill CTA ("RSVP at" / "Svara på") and the short URL text (`checkin.example/i/AbC123`, no scheme) in large type. Keep the top 250 px and bottom 340 px free of key text so Instagram/Snapchat UI chrome does not cover it.
- Shared helpers (`loadInviteForImage`, theme background, fonts) move to `apps/web/src/lib/invite-image.tsx` and are used by both images. The privacy rule is enforced by the helper only ever passing `title`, `starts_at`, `time_zone`, `cover_path`, `theme` and host `display_name` to layouts.
- States: `active` → image; everything else (`not_found`, `cancelled`, `past`) → `404` with an empty body and `Cache-Control: no-store`. Identical for all non-active cases, matching "invite not found".
- Language: `?lang=sv|en` when given (host app passes its locale), otherwise `Accept-Language` via the existing `getLocale()`.
- **Alternative considered:** render on device (React Native view → `react-native-view-shot`). Rejected: two renderers to keep in sync, guests on the web could not reuse it, and cover image loading on device is slower.
- **Alternative considered:** Supabase Edge Function with Satori. Rejected for the same reasons as in the MVP design: Next.js already has `next/og`, fonts and i18n.

### 2. Caching: look up every request, cache only the render

Each request calls `get_invite` (cheap, ~1 indexed query), so revocation, cancellation and host deletion apply immediately at the origin. The PNG render (expensive: cover fetch + Satori + resvg) is cached in the Next.js data cache with `'use cache'` + `cacheLife('days')`, keyed by a **content key**: hash of `token, title, starts_at, time_zone, cover_path, theme, host display_name, locale`. Any edit changes the key, so a stale render can never be served for changed details; old entries simply age out.

HTTP response: `Cache-Control: public, max-age=60, s-maxage=60, stale-while-revalidate=0`. This bounds CDN/browser staleness to one minute, which is what the freshness requirement states.

- **Alternative considered:** versioned immutable URLs (`?v=updated_at`). Rejected: an immutable CDN copy keeps serving after revocation/cancellation, which violates the availability requirement, and it needs `get_invite` to expose `updated_at`.
- **Alternative considered:** `revalidateTag` on edit via a DB webhook → Next endpoint. Rejected: new moving part (webhook secret, retries) for no gain over content keys.
- The existing OG image gets the same short `Cache-Control` as a small hardening, without behavior changes.

### 3. Host app: one "Share to Story" action with a destination picker

A new secondary button "Share to Story" under "Share invite" on the event screen, shown when the existing share buttons are (editable + link present). Flow:

1. Download `${INVITE_BASE_URL}/i/${token}/story?lang=${locale}` to the cache directory with `expo-file-system` (`File.downloadFileAsync`). Fail → error message, no share (spec: image cannot be fetched).
2. Show an action sheet with the destinations available on this device: Instagram Stories, Snapchat, "More…" (share sheet). Availability = app installed (`Linking.canOpenURL('instagram-stories://')`, `'snapchat://'`) **and** the integration's ID is configured (`EXPO_PUBLIC_FACEBOOK_APP_ID`, `EXPO_PUBLIC_SNAP_CLIENT_ID`). If only "More…" is available, skip the sheet and open the share sheet directly.
3. Destination handlers live in `apps/mobile/src/lib/story-share.ts` behind a small interface so each can be unit tested with mocks.

### 4. Instagram Stories via `react-native-share`

`react-native-share` `Share.shareSingle({ social: Social.InstagramStories, appId, backgroundImage: fileUri, attributionURL: link })`. On iOS it writes Instagram's pasteboard items and opens `instagram-stories://share?source_application=<appId>`; on Android it fires the `com.instagram.share.ADD_TO_STORY` intent with a content URI. Before opening, the invite link is copied with `expo-clipboard` and a toast says "Link copied — add it with the Link sticker".

- **Why not a link sticker automatically:** Instagram's sharing-to-stories API has no field that creates a link sticker; `attributionURL`/content URL is not a tappable link for viewers. The URL printed on the image plus the copied link is the reliable path.
- **Facebook App ID** is required by Instagram for story sharing. It is read from config; when absent, Instagram is not offered (fallback still works).
- Config: `ios.infoPlist.LSApplicationQueriesSchemes: ["instagram-stories", "instagram", "snapchat"]` in `app.json`; Android 11+ package visibility via a tiny local config plugin adding `<queries>` for `com.instagram.android` and `com.snapchat.android`.
- **Alternative considered:** hand-written Expo module for the pasteboard/intent. Rejected for now: `react-native-share` is widely used, maintained and works in development builds without its own config plugin; revisit only if it blocks an Expo SDK upgrade.
- **Alternative considered:** share sheet only. It is the fallback, but Instagram's share-sheet entry often posts to feed/DM rather than Stories, and loses the background-image story layout.

### 5. Snapchat via Creative Kit (optional, behind client ID)

Use Snap's official React Native Creative Kit package (`@snapchat/snap-kit-react-native`) with `sharePhoto({ content: { uri }, attachmentUrl: link, caption })`. The attachment URL is a real tappable link on the snap, which is the main reason to integrate. Requires a Snap Kit client ID, the `SCSDKClientId`/redirect setup in Info.plist and AndroidManifest (via config plugin/`app.json`), and Snap's app review before it works for non-test users.

- Because approval is outside our control, Snapchat is **feature-flagged by the presence of `EXPO_PUBLIC_SNAP_CLIENT_ID`** and not offered otherwise. Implementation tasks build and test it against a dev client ID; production enablement is a setup item.
- **Alternative considered:** Snapchat via share sheet only (no SDK). Works today with no review and is what users get until approval, but the link is not attached.
- **Alternative considered:** `snapchat.com/scan` / web Creative Kit URLs. Rejected: web Creative Kit also needs a client ID and does not take a local image.

### 6. Share-sheet fallback

`expo-sharing` `shareAsync(fileUri, { mimeType: 'image/png', UTI: 'public.png' })` shares the image. Because most share targets accept only one payload type reliably, the link is copied to the clipboard first with the same toast. On iOS we use React Native `Share.share({ url: fileUri, message })` instead when available, since it carries image and text together; on Android `expo-sharing` plus clipboard. Errors from a direct destination fall through to this path.

### 7. Web: guest Share button

Client component `ShareInvite` on the invite page, rendered only for `active`:

1. On tap, `fetch('/i/<token>/story')` → `Blob` → `File('invite.png')`.
2. If `navigator.canShare?.({ files: [file] })` → `navigator.share({ files: [file], text, url })`. Some browsers reject `files` + `url` together; on `TypeError` retry with files + text containing the URL.
3. Otherwise (or if `share` is unavailable, typical in Instagram/Snapchat in-app browsers) show inline actions: "Save image" (`<a href=story download>`) and "Copy link" (`navigator.clipboard.writeText`, with a select-text fallback).

The fetch starts on tap, not on page load, to keep the invite page light inside in-app browsers. User cancel (`AbortError`) is silent.

### 8. Authorization and personal data

- **No new tables, no RLS changes.** The image route uses the existing anon `get_invite` path, which already returns only guest-safe fields for valid tokens.
- **Personal data:** the rendered PNG contains the host's display name and the cover image, which are already shown to anyone with the link. Renders are kept only in the Next.js data cache (Vercel, EU region `arn1`) with a lifetime of at most 7 days and are unreachable once the invite is not active, because every request checks `get_invite` first. Downloaded images on the host's device live in the app cache directory and are deleted after sharing. No sharing events, destinations or recipients are recorded.

### 9. Testing

- **Web (Playwright):** story route returns `image/png` 1080×1920 for an active fixture; returns identical 404 for unknown, revoked, cancelled and past tokens; edited title changes the response bytes; cache header is set. Pure layout data function (`storyImageModel`) unit-tested to prove location/description/guests are never passed. Share button: fallback actions appear when `navigator.canShare` is absent; share is called with a file when mocked present.
- **Mobile (Jest):** `story-share.ts` destination availability matrix (installed × configured), fallback on error, no share on download failure, clipboard copy before Instagram/share sheet.
- **Manual:** real devices for Instagram and Snapchat (simulators lack the apps).

## Risks / Trade-offs

- [Instagram/Snap change their sharing APIs or requirements] → Isolated behind `story-share.ts` destinations; share-sheet fallback always available.
- [Snap Kit review delays or rejection] → Snapchat stays off via missing client ID; users share to Snapchat through the share sheet.
- [Link is not clickable on Instagram stories without a manual link sticker] → URL printed large on the image, link pre-copied with a hint. Accepted platform limit.
- [Rendering cost spikes when a popular invite is shared] → Render cache by content key plus 60 s CDN cache; renders happen at most once per content change per region.
- [Large uploaded covers slow down rendering] → Request a resized cover via Supabase Storage image transformation (`width=1080`) when available; otherwise the raw object.
- [Web Share with files is inconsistent across browsers and in-app webviews] → Feature-detect with `canShare`, retry without `url`, always offer save + copy.
- [Shared images persist on Instagram/Snapchat after cancellation] → Cannot be recalled; they never contain the address, and the link shows "not found"/cancelled.

## Migration Plan

No database migration. Deploy web first (route is additive), then ship a mobile build with the new dependencies and native config (requires a new EAS build, not an OTA update). Rollback: hide the mobile button via a new build or by unsetting the integration IDs (fallback remains); remove the web Share component in a web deploy.

## Open Questions

- Facebook App ID for Instagram Stories and Snap Kit client ID (plus Snap app review): who owns the developer accounts. Setup items; the feature ships with the share-sheet fallback until they exist.
- Final CTA copy in Swedish and English ("RSVP at" / "Svara på") — copy tweak, no design impact.
