import { inviteUrl } from '@check-in/shared';

import { toIcs } from '@/lib/calendar';
import { env } from '@/lib/env';
import { getInvite } from '@/lib/invite';

export async function GET(_req: Request, ctx: RouteContext<'/i/[token]/calendar.ics'>) {
  const { token } = await ctx.params;
  const invite = await getInvite(token);
  if (invite.state !== 'active' && invite.state !== 'past') {
    return new Response('Not found', { status: 404 });
  }
  const e = invite.event;
  const ics = toIcs({
    uid: token,
    title: e.title,
    description: e.description,
    location: e.location_text,
    start: new Date(e.starts_at),
    end: e.ends_at ? new Date(e.ends_at) : null,
    url: inviteUrl(env.siteUrl, token),
  });
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="invite.ics"',
      'cache-control': 'private, no-store',
    },
  });
}
