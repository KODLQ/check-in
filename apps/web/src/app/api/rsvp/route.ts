import { rsvpInputSchema } from '@check-in/shared';
import { createHash } from 'node:crypto';
import { z } from 'zod';

import { env } from '@/lib/env';
import { serviceClient } from '@/lib/supabase';

// Per IP + invite: max 10 writes per 10 minutes (spec: abuse limits).
const LIMIT = 10;
const WINDOW_SECONDS = 600;

function clientIp(req: Request): string {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}

async function allowed(req: Request, token: string): Promise<boolean> {
  const ipHash = createHash('sha256').update(`${env.rateLimitSalt}:${clientIp(req)}`).digest('hex');
  const { data, error } = await serviceClient().rpc('hit_rate_limit', {
    p_bucket: `${ipHash}:${token}`,
    p_max: LIMIT,
    p_window_seconds: WINDOW_SECONDS,
  });
  return !error && data === true;
}

const json = (body: unknown, status = 200) => Response.json(body, { status });

function mapError(message: string | undefined) {
  if (message?.includes('event_closed')) return json({ error: 'event_closed' }, 409);
  if (message?.includes('not_found')) return json({ error: 'not_found' }, 404);
  if (message?.includes('name_required')) return json({ error: 'name_required' }, 400);
  if (message?.includes('rate_limited')) return json({ error: 'rate_limited' }, 429);
  return json({ error: 'unknown' }, 500);
}

export async function POST(req: Request) {
  const parsed = rsvpInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.some((i) => i.path[0] === 'displayName');
    return json({ error: nameIssue ? 'name_required' : 'invalid' }, 400);
  }
  const { token, guestToken, displayName, status } = parsed.data;
  if (!(await allowed(req, token))) return json({ error: 'rate_limited' }, 429);

  const { data, error } = await serviceClient().rpc('upsert_rsvp', {
    p_token: token,
    p_guest_token: guestToken,
    p_display_name: displayName,
    p_status: status,
  });
  if (error) return mapError(error.message);
  return json(data);
}

const withdrawSchema = z.object({
  token: rsvpInputSchema.shape.token,
  guestToken: rsvpInputSchema.shape.guestToken,
});

export async function DELETE(req: Request) {
  const parsed = withdrawSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { token, guestToken } = parsed.data;
  if (!(await allowed(req, token))) return json({ error: 'rate_limited' }, 429);

  const { data, error } = await serviceClient().rpc('withdraw_rsvp', {
    p_token: token,
    p_guest_token: guestToken,
  });
  if (error) return mapError(error.message);
  return json({ withdrawn: data });
}

