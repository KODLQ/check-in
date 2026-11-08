import 'server-only';

import type { Database } from '@check-in/shared';
import { createClient } from '@supabase/supabase-js';

import { env } from './env';

const opts = { auth: { persistSession: false, autoRefreshToken: false } } as const;

/** Anonymous client: can only call get_invite. */
export const publicClient = () => createClient<Database>(env.supabaseUrl, env.publishableKey, opts);

/** Service client: used only by the RSVP route after validation and rate limiting. */
export const serviceClient = () => createClient<Database>(env.supabaseUrl, env.secretKey, opts);

export function coverUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${env.supabaseUrl}/storage/v1/object/public/covers/${path}`;
}

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${env.supabaseUrl}/storage/v1/object/public/avatars/${path}`;
}
