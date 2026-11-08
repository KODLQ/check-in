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
};
