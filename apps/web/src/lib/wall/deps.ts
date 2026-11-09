import 'server-only';

import { createHash } from 'node:crypto';

import { env } from '../env';
import { serviceClient } from '../supabase';
import type { WallDb, WallDeps } from './handlers';

function clientIp(req: Request): string {
  return req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}

/** Service client as the loosely typed WallDb (the generated RPC types are checked in the SQL tests). */
export const wallDb = (): WallDb => serviceClient() as unknown as WallDb;

/** Real dependencies for the /api/wall/* route handlers. */
export function wallDeps(): WallDeps {
  const db = wallDb();
  return {
    db,
    enabled: env.wallEnabled,
    async getUser(jwt) {
      const { data, error } = await serviceClient().auth.getUser(jwt);
      return error ? null : (data.user?.id ?? null);
    },
    async rateLimit(bucket, max, windowSeconds) {
      const { data, error } = await db.rpc('hit_rate_limit', { p_bucket: bucket, p_max: max, p_window_seconds: windowSeconds });
      return !error && data === true;
    },
    ipHash: (req) => createHash('sha256').update(`${env.rateLimitSalt}:${clientIp(req)}`).digest('hex'),
  };
}
