import 'server-only';

import { createHash } from 'node:crypto';

import { env } from './env';
import { serviceClient } from './supabase';

// Per IP + invite: max 10 writes per 10 minutes (spec: event-rsvp abuse limits, date-polls voting abuse limits).
const LIMIT = 10;
const WINDOW_SECONDS = 600;

function clientIp(req: Request): string {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

/**
 * Counts one write for this client and invite. `kind` separates the buckets of different writes to the same
 * invite (RSVPs use none, votes ':votes'); each gets the same limit. The IP is only stored salted and hashed.
 */
export async function allowedWrite(req: Request, token: string, kind = ''): Promise<boolean> {
  const ipHash = createHash('sha256').update(`${env.rateLimitSalt}:${clientIp(req)}`).digest('hex');
  const { data, error } = await serviceClient().rpc('hit_rate_limit', {
    p_bucket: `${ipHash}:${token}${kind}`,
    p_max: LIMIT,
    p_window_seconds: WINDOW_SECONDS,
  });
  return !error && data === true;
}
