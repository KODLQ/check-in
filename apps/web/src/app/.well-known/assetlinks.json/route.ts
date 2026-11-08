// Android app links for /i/* and /c/*. assetlinks.json only verifies the domain; the handled paths are
// declared by the app's intent filters.
export function GET() {
  const fingerprint = process.env.ANDROID_SHA256_CERT_FINGERPRINT;
  return Response.json([
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'se.checkin.app',
        sha256_cert_fingerprints: fingerprint ? [fingerprint] : [],
      },
    },
  ]);
}
