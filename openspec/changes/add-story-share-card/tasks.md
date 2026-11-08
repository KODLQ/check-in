# Tasks

## 1. Shared strings and helpers

- [x] 1.1 Add sv/en i18n keys in `packages/shared` for the story CTA, "Share to Story", destination names, "Link copied — add it with the Link sticker", "Couldn't prepare the image", "Save image" and "Copy link"; verify the i18n key-parity test (or a new Vitest check) passes for both locales
- [x] 1.2 Add `displayInviteUrl(baseUrl, token)` to `packages/shared` (invite URL without scheme or trailing slash) with Vitest cases for http/https and trailing slashes; verify `npm test -w packages/shared` passes

## 2. Story image route (web)

- [x] 2.1 Extract shared image helpers from `opengraph-image.tsx` into `apps/web/src/lib/invite-image.tsx` (theme background, cover URL, fonts) plus a `storyImageModel(invite, locale, token)` that returns only title, time text, host name, cover/theme, CTA and display URL; keep the OG image output unchanged and verify by an existing/added Playwright check that `/i/<token>/opengraph-image` still returns a 1200×630 PNG
- [x] 2.2 Add unit tests for `storyImageModel` proving location text, place name, coordinates, description, guests and counts are never present in its output, and that long titles are truncated with an ellipsis; verify the tests pass
- [x] 2.3 Implement `GET /i/[token]/story` returning a 1080×1920 PNG for `active` invites with the layout in design §1 (safe zones, CTA, display URL) and `?lang=` / `Accept-Language` handling; verify manually in the browser for a cover event and a theme-only event in sv and en
- [x] 2.4 Return an identical empty 404 with `Cache-Control: no-store` for `not_found`, `cancelled` and `past`; add Playwright tests for unknown, revoked, cancelled and ended fixtures and verify all four responses are byte-identical
- [x] 2.5 Cache the render with `'use cache'` keyed by the content key (design §2) and set `Cache-Control: public, max-age=60, s-maxage=60` on success; add a Playwright test that editing the title changes the image bytes and that the header is present, and apply the same header to the OG image

## 3. Guest Share on the web invite page

- [x] 3.1 Build the `ShareInvite` client component (fetch story on tap, `navigator.canShare` with files, retry without `url` on `TypeError`, silent on `AbortError`) and render it only for active invites; verify with a Playwright test that mocks `navigator.share`/`canShare` and asserts a PNG file and the invite URL are passed
- [x] 3.2 Add the fallback "Save image" (download link to the story route) and "Copy link" (clipboard with select-text fallback) actions; verify with Playwright that they appear when `canShare` is absent, that copy puts the invite URL on the clipboard, and that no Share action renders on cancelled or ended invites

## 4. Mobile setup and native config

- [x] 4.1 Add `react-native-share`, `expo-file-system` and `@snapchat/snap-kit-react-native` to `apps/mobile`, add `LSApplicationQueriesSchemes` (`instagram-stories`, `instagram`, `snapchat`) to `app.json`, and add `EXPO_PUBLIC_FACEBOOK_APP_ID` / `EXPO_PUBLIC_SNAP_CLIENT_ID` to `lib/config.ts` and `.env.example`; verify `npx expo prebuild --clean` succeeds and the generated Info.plist contains the schemes
- [x] 4.2 Write a local config plugin that adds Android `<queries>` for `com.instagram.android` and `com.snapchat.android` and the Snap Kit client ID / redirect entries (only when the env var is set); verify the prebuilt AndroidManifest.xml and Info.plist contain the entries with the ID set and omit Snap entries without it
- [ ] 4.3 Build iOS and Android development clients with EAS (or local `expo run`) and verify the app launches and existing Share invite still works
  - Not done: iOS dev client rebuilt locally (prebuild + pod install + xcodebuild) and verified in the iOS Simulator (launches, Share invite and Share to Story work). Android not built: no Android SDK in this environment.

## 5. Mobile Share to Story

- [x] 5.1 Implement `apps/mobile/src/lib/story-share.ts`: download the story image (with `lang`) to the cache dir, compute available destinations (installed × configured), clipboard copy, and delete the file after sharing; verify with Jest tests covering the availability matrix and that a failed download starts no share
- [x] 5.2 Implement the share-sheet destination (iOS `Share.share` with image + message, Android `expo-sharing` + clipboard) and fall-through from failed direct destinations; verify with Jest tests that errors from Instagram/Snapchat handlers open the share sheet and show an error
- [ ] 5.3 Implement the Instagram Stories destination via `react-native-share` (`Social.InstagramStories`, `appId`, `backgroundImage`, `attributionURL`) with the link-copied toast; verify with a Jest test of the call arguments and manually on a real iPhone and Android phone with Instagram installed (story composer opens with the image)
  - Not done: implemented and Jest-tested (call arguments, link-copied toast, fall-through); needs a Facebook App ID and real iPhone/Android phones with Instagram.
- [ ] 5.4 Implement the Snapchat destination via Creative Kit `sharePhoto` with `attachmentUrl`; verify with a Jest test of the call arguments and manually on a real device with a Snap Kit dev client ID that the snap preview shows the image with the link attached
  - Not done: implemented and Jest-tested (call arguments, fall-through); needs a Snap Kit client ID (staging + demo user) and a real device with Snapchat.
- [x] 5.5 Add the "Share to Story" button and destination action sheet to `events/[id]/index.tsx`, shown only when the existing share buttons are shown, skipping the sheet when only the share sheet is available; verify with a React Native Testing Library test (button hidden for cancelled/ended events) and manually in the iOS Simulator (share-sheet path, Swedish and English image)

## 6. Integration check

- [ ] 6.1 End-to-end on a real phone: host shares to Instagram/Snapchat (or share sheet without IDs), a second phone opens the link from the story, RSVPs on the web page and shares again from the web; then regenerate the link and verify the old story image URL returns 404 within a minute
  - Not done: needs real phones and Instagram/Snapchat. Parts verified locally: share-sheet path in the simulator, web Share/fallback in Playwright, old token → 404 immediately after revoke (Playwright).
- [x] 6.2 Document setup of the Facebook App ID and Snap Kit client ID (where to create them, env vars, Snap review) in `apps/mobile/README.md`; verify a fresh checkout builds with the documented steps and the fallback works without the IDs
