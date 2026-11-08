import { claimTicketInputSchema } from '@check-in/shared';
import { createHash } from 'node:crypto';

import { env } from '@/lib/env';
import { serviceClient } from '@/lib/supabase';

// Per IP: max 10 claim tickets per 10 minutes (design: hand-off).
const LIMIT = 10;
const WINDOW_SECONDS = 600;

function clientIp(req: Request): string {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Creates a single-use, 24h claim ticket for this browser's RSVPs. The guest token comes in the
 * JSON body and the ticket goes back in the body, so neither ever appears in a URL or access log.
 */
export async function POST(req: Request) {
  const parsed = claimTicketInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid' }, 400);

  const ipHash = createHash('sha256')
    .update(`${env.rateLimitSalt}:${clientIp(req)}`)
    .digest('hex');
  const db = serviceClient();
  const { data: ok, error: rlError } = await db.rpc('hit_rate_limit', {
    p_bucket: `${ipHash}:claim`,
    p_max: LIMIT,
    p_window_seconds: WINDOW_SECONDS,
  });
  if (rlError || ok !== true) return json({ error: 'rate_limited' }, 429);

  const { data, error } = await db.rpc('create_claim_ticket', {
    p_guest_token: parsed.data.guestToken,
  });
  if (error || !data) return json({ error: 'unknown' }, 500);
  return json({ ticket: data });
}
