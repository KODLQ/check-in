# check-in mobile app

Expo (SDK 58) app. It needs a development build (native modules such as Apple sign-in, `react-native-share`
and Snap Kit are not in Expo Go).

## Local development build (iOS Simulator)

```sh
cp .env.example .env.local            # fill in values from `npx supabase status`
npx expo prebuild --platform ios --no-install
cd ios && pod install && cd ..
xcodebuild -workspace ios/checkin.xcworkspace -scheme checkin -configuration Debug \
  -sdk iphonesimulator -derivedDataPath ios/build CODE_SIGNING_ALLOWED=NO
npx expo start --dev-client
```

Native config lives in `app.json` and `plugins/`; `ios/` and `android/` are generated. Re-run prebuild and
rebuild after changing native config or adding native dependencies (an OTA update is not enough).

## Share to Story setup (optional)

"Share to Story" always works through the native share sheet. Instagram Stories and Snapchat are offered as
direct destinations only when the app is installed on the phone **and** the matching ID below is set at build
time. Leave them empty to ship with the share-sheet fallback only.

### Instagram Stories: Facebook App ID

1. Create (or reuse) an app at https://developers.facebook.com/apps. Check Meta's "Sharing to Stories" docs
   (https://developers.facebook.com/docs/instagram-platform/sharing-to-stories) for current requirements.
2. Copy the **App ID** from the app dashboard.
3. Set `EXPO_PUBLIC_FACEBOOK_APP_ID=<app id>` in `.env.local` (and in the EAS environment for builds).

Instagram has no API to add a link sticker: the app copies the invite link to the clipboard and tells the host
to add it with the Link sticker. The URL is also printed on the image.

### Snapchat: Snap Kit client ID (Creative Kit)

1. Create an app at https://kit.snapchat.com/manage (Snap Kit developer portal) and enable **Creative Kit**.
2. Add the platform identifiers: iOS bundle ID `se.checkin.app`, Android package `se.checkin.app`.
3. Use the **Staging** OAuth client ID while testing: only Snapchat accounts listed under *Demo Users* can
   share with it. Production needs Snap's app review; submit the app version for review and switch to the
   **Production** client ID once approved.
4. Set `EXPO_PUBLIC_SNAP_CLIENT_ID=<client id>` and re-run prebuild + rebuild: `plugins/with-story-share.js`
   writes `SCSDKClientId` and the `bitmoji-sdk`/`itms-apps` query schemes (iOS) and the
   `com.snapchat.kit.sdk.clientId` meta-data plus a FileProvider (Android) only when it is set.

### Checking the fallback

With neither ID set, tapping "Share to Story" on an active event downloads the story image
(`/i/<token>/story?lang=<app language>` from `EXPO_PUBLIC_INVITE_BASE_URL`) and opens the share sheet
directly, with the invite link on the clipboard.

## Invite links that open the app (universal links / Android app links)

`https://<host>/i/<token>` (invites) and `https://<host>/c/<token>` (co-host links) open the app when it is
installed. `app.json` carries the placeholder host `checkin.example`; `plugins/with-app-links.js` replaces it at
prebuild time with `APP_LINK_HOST`, or with the host of `EXPO_PUBLIC_INVITE_BASE_URL` when that is an `https`
URL. Re-run prebuild and rebuild after changing it.

- **iOS**: `applinks:<host>` in the entitlements; the web app serves `/.well-known/apple-app-site-association`.
- **Android**: an `autoVerify` intent filter for `/i/*` and `/c/*`. Android only opens the app directly once
  it has verified `https://<host>/.well-known/assetlinks.json`, which needs:
  1. the real domain (verification never succeeds for `checkin.example`), and
  2. the SHA-256 fingerprint of the **release** signing certificate (for Play builds: Play Console → App
     integrity → App signing key certificate) in the web app's `ANDROID_SHA256_CERT_FINGERPRINT`. Debug builds
     are signed with a different key, so they stay unverified unless you also add the debug fingerprint.

  Check with `adb shell pm get-app-links se.checkin.app` (expect `verified` for the host) and re-run
  verification with `adb shell pm verify-app-links --re-verify se.checkin.app`.

## Brand colours on Android

`plugins/with-android-accent.js` sets the app theme's `colorPrimary`/`colorAccent` (and the date/time picker
and alert dialog themes) to the brand pink `#FF4D6D`, so native pickers, switches and dialog buttons don't use
the stock Material colours.
