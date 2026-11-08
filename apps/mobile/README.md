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
