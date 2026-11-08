import 'server-only';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export const env = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  supabaseUrl: required('SUPABASE_URL'),
  publishableKey: required('SUPABASE_PUBLISHABLE_KEY'),
  get secretKey() {
    return required('SUPABASE_SECRET_KEY');
  },
  rateLimitSalt: process.env.RATE_LIMIT_SALT ?? 'dev-only-salt',
  /** Email opt-in on the RSVP form. Off until a DNS-verified sending domain exists (design: migration plan). */
  emailUpdatesEnabled: process.env.NEXT_PUBLIC_EMAIL_UPDATES === 'true',
  /** Store listings for the app (placeholders until the listings exist). */
  appStoreUrl: process.env.NEXT_PUBLIC_APP_STORE_URL || 'https://apps.apple.com/app/check-in',
  playStoreUrl: process.env.NEXT_PUBLIC_PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=se.checkin.app',
};
