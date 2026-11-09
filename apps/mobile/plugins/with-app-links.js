// Universal links (iOS) and verified app links (Android) for invite (/i/*) and co-host (/c/*) URLs.
// app.json carries the placeholder host; set APP_LINK_HOST (or an https EXPO_PUBLIC_INVITE_BASE_URL) at
// prebuild time to use the real domain. Android verification also needs the release signing certificate's
// SHA-256 in the web app's ANDROID_SHA256_CERT_FINGERPRINT (see README).
const PLACEHOLDER_HOST = 'checkin.example';

function appLinkHost() {
  if (process.env.APP_LINK_HOST) return process.env.APP_LINK_HOST;
  const base = process.env.EXPO_PUBLIC_INVITE_BASE_URL;
  if (base && base.startsWith('https://')) return new URL(base).host;
  return PLACEHOLDER_HOST;
}

function withAppLinks(config) {
  const host = appLinkHost();
  config.ios = config.ios ?? {};
  config.ios.associatedDomains = (config.ios.associatedDomains ?? [])
    .filter((d) => !d.startsWith('applinks:'))
    .concat(`applinks:${host}`);
  config.android = config.android ?? {};
  config.android.intentFilters = (config.android.intentFilters ?? []).map((filter) =>
    filter.autoVerify
      ? { ...filter, data: (filter.data ?? []).map((d) => (d.host ? { ...d, host } : d)) }
      : filter,
  );
  return config;
}

module.exports = withAppLinks;
module.exports.appLinkHost = appLinkHost;
