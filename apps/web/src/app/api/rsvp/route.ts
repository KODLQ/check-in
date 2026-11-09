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

function mapError(message: string | undefined, details?: string | null) {
  // Capacity (add-guest-capacity). The detail carries the spots left / the host's maximum.
  const n = details != null && /^\d+$/.test(details) ? Number(details) : null;
  if (message?.includes('capacity_exceeded')) return json({ error: 'capacity_exceeded', spots_left: n }, 409);
  if (message?.includes('too_many_plus_ones')) return json({ error: 'too_many_plus_ones', max_plus_ones: n }, 400);
  if (message?.includes('plus_ones_not_allowed')) return json({ error: 'plus_ones_not_allowed' }, 400);
  if (message?.includes('invalid_status')) return json({ error: 'invalid_status' }, 400);
  if (message?.includes('event_closed')) return json({ error: 'event_closed' }, 409);
  if (message?.includes('not_found')) return json({ error: 'not_found' }, 404);
  if (message?.includes('name_required')) return json({ error: 'name_required' }, 400);
  if (message?.includes('rate_limited')) return json({ error: 'rate_limited' }, 429);
  if (message?.includes('invalid_email')) return json({ error: 'invalid_email' }, 400);
  return json({ error: 'unknown' }, 500);
}

/** Maps schema issues to the error keys the form shows (name first, then email fields). */
function inputError(issues: { path: PropertyKey[] }[]): string {
  const fields = issues.map((i) => i.path[0]);
  if (fields.includes('displayName')) return 'name_required';
  if (fields.includes('email')) return 'invalid_email';
  if (fields.includes('emailConsent')) return 'consent_required';
  if (fields.includes('plusOnes')) return 'too_many_plus_ones';
  if (fields.includes('status')) return 'invalid_status';
  return 'invalid';
}

/** Salted so the opt-in rate-limit bucket never contains a guessable hash of the address. */
const emailHash = (email: string) =>
  createHash('sha256').update(`${env.rateLimitSalt}:${email}`).digest('hex');

export async function POST(req: Request) {
  const parsed = rsvpInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: inputError(parsed.error.issues) }, 400);
  const { token, guestToken, displayName, status, plusOnes, email, locale } = parsed.data;
  if (!(await allowed(req, token))) return json({ error: 'rate_limited' }, 429);

  // email omitted = keep the current subscription, null = turn updates off, string = opt in / replace.
  const emailAction = email === undefined ? 'keep' : email === null ? 'remove' : 'set';
  if (emailAction === 'set' && !env.emailUpdatesEnabled) return json({ error: 'invalid' }, 400);
  const { data, error } = await serviceClient().rpc('upsert_rsvp', {
    p_token: token,
    p_guest_token: guestToken,
    p_display_name: displayName,
    p_status: status,
    p_email: email ?? undefined,
    p_email_hash: email ? emailHash(email) : undefined,
    p_email_action: emailAction,
    p_locale: locale ?? 'en',
    // Omitted = keep the current plus-ones (e.g. an email-only change). Maybe/Can't go always carry none.
    p_plus_ones: plusOnes,
  });
  if (error) return mapError(error.message, error.details);
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

