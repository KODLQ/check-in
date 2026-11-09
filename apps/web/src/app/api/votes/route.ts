import { ballotInputSchema } from '@check-in/shared';
import { z } from 'zod';

import { allowedWrite } from '@/lib/rate-limit';
import { serviceClient } from '@/lib/supabase';

// Date-poll ballots from the web invite page (change: add-date-polls). Same per-IP + invite rate limit as
// RSVPs, in its own ':votes' bucket; the database enforces every poll rule (open, deadline, passed option,
// voter cap) in submit_votes / withdraw_votes.

const json = (body: unknown, status = 200) => Response.json(body, { status });

/** Database error -> HTTP status + the error key the page shows. */
function mapError(message: string | undefined) {
  const m = message ?? '';
  // The poll changed under the guest (picked, deadline passed, option removed/re-timed): reload the page.
  if (m.includes('poll_closed')) return json({ error: 'poll_closed' }, 409);
  if (m.includes('option_passed')) return json({ error: 'option_passed' }, 409);
  if (m.includes('option_not_found')) return json({ error: 'option_not_found' }, 409);
  if (m.includes('event_closed')) return json({ error: 'event_closed' }, 409);
  if (m.includes('not_found')) return json({ error: 'not_found' }, 404);
  if (m.includes('name_required')) return json({ error: 'name_required' }, 400);
  if (m.includes('no_votes')) return json({ error: 'no_votes' }, 400);
  if (m.includes('invalid_choice')) return json({ error: 'invalid_choice' }, 400);
  if (m.includes('rate_limited')) return json({ error: 'rate_limited' }, 429);
  return json({ error: 'unknown' }, 500);
}

function inputError(issues: { path: PropertyKey[]; message: string }[]): string {
  const fields = issues.map((i) => i.path[0]);
  if (fields.includes('displayName')) return 'name_required';
  const votes = issues.find((i) => i.path[0] === 'votes');
  if (votes) return votes.message === 'no_votes' ? 'no_votes' : 'invalid_choice';
  return 'invalid';
}

export async function POST(req: Request) {
  const parsed = ballotInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: inputError(parsed.error.issues) }, 400);
  const { token, guestToken, displayName, votes } = parsed.data;
  if (!(await allowedWrite(req, token, ':votes'))) return json({ error: 'rate_limited' }, 429);

  const { data, error } = await serviceClient().rpc('submit_votes', {
    p_token: token,
    p_guest_token: guestToken,
    p_display_name: displayName,
    p_votes: votes.map((v) => ({ option_id: v.optionId, choice: v.choice })),
  });
  if (error) return mapError(error.message);
  return json(data);
}

const withdrawSchema = z.object({
  token: ballotInputSchema.shape.token,
  guestToken: ballotInputSchema.shape.guestToken,
});

export async function DELETE(req: Request) {
  const parsed = withdrawSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: 'invalid' }, 400);
  const { token, guestToken } = parsed.data;
  if (!(await allowedWrite(req, token, ':votes'))) return json({ error: 'rate_limited' }, 429);

  const { data, error } = await serviceClient().rpc('withdraw_votes', { p_token: token, p_guest_token: guestToken });
  if (error) return mapError(error.message);
  return json({ withdrawn: data });
}
