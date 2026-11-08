// Native config for "Share to Story" (design: add-story-share-card §4–5).
// - Android 11+ package visibility for Instagram and Snapchat (needed to detect them).
// - Snap Kit Creative Kit client ID + FileProvider (Android) / SCSDKClientId (iOS), only when
//   EXPO_PUBLIC_SNAP_CLIENT_ID is set at prebuild time. Without it, Snapchat is never offered.
const {
  AndroidConfig,
  withAndroidManifest,
  withDangerousMod,
  withInfoPlist,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ANDROID_PACKAGES = ['com.instagram.android', 'com.snapchat.android'];
const SNAP_IOS_SCHEMES = ['snapchat', 'bitmoji-sdk', 'itms-apps'];
const SNAP_PROVIDER = 'androidx.core.content.FileProvider';
const SNAP_PATHS_XML = `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
  <files-path name="files" path="." />
  <cache-path name="cached_files" path="." />
  <external-cache-path name="external_cached_files" path="." />
</paths>
`;

function addQueries(manifest) {
  const root = manifest.manifest;
  root.queries = root.queries ?? [{}];
  const q = root.queries[0];
  q.package = q.package ?? [];
  for (const name of ANDROID_PACKAGES) {
    if (!q.package.some((p) => p.$['android:name'] === name)) q.package.push({ $: { 'android:name': name } });
  }
}

function addSnapAndroid(manifest, clientId) {
  const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, 'com.snapchat.kit.sdk.clientId', clientId);
  app.provider = app.provider ?? [];
  if (!app.provider.some((p) => p.$['android:name'] === SNAP_PROVIDER && p.$['android:authorities'] === '${applicationId}.fileprovider')) {
    app.provider.push({
      $: {
        'android:name': SNAP_PROVIDER,
        'android:authorities': '${applicationId}.fileprovider',
        'android:exported': 'false',
        'android:grantUriPermissions': 'true',
      },
      'meta-data': [{ $: { 'android:name': 'android.support.FILE_PROVIDER_PATHS', 'android:resource': '@xml/snap_kit_file_paths' } }],
    });
  }
}

module.exports = function withStoryShare(config, props = {}) {
  const snapClientId = props.snapClientId ?? process.env.EXPO_PUBLIC_SNAP_CLIENT_ID ?? '';

  config = withAndroidManifest(config, (c) => {
    addQueries(c.modResults);
    if (snapClientId) addSnapAndroid(c.modResults, snapClientId);
    return c;
  });

  if (snapClientId) {
    config = withDangerousMod(config, [
      'android',
      async (c) => {
        const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'snap_kit_file_paths.xml'), SNAP_PATHS_XML);
        return c;
      },
    ]);
    config = withInfoPlist(config, (c) => {
      c.modResults.SCSDKClientId = snapClientId;
      const schemes = new Set([...(c.modResults.LSApplicationQueriesSchemes ?? []), ...SNAP_IOS_SCHEMES]);
      c.modResults.LSApplicationQueriesSchemes = [...schemes];
      return c;
    });
  }
  return config;
};
