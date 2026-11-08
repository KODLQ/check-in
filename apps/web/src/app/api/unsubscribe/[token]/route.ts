import { serviceClient } from '@/lib/supabase';

// Unsubscribe from event update emails (spec: one-click unsubscribe).
// - RFC 8058 one-click: mail clients POST "List-Unsubscribe=One-Click" here and get 200.
// - The confirm page (/u/<token>) posts a plain form here and is redirected to its "done" state.
// Same response whether or not the token exists, so it reveals nothing. GET is not handled (405),
// so link scanners that merely fetch URLs never unsubscribe anyone.
const TOKEN = /^[A-Za-z0-9_-]{22}$/;

export async function POST(req: Request, ctx: RouteContext<'/api/unsubscribe/[token]'>) {
  const { token } = await ctx.params;
  if (TOKEN.test(token)) {
    await serviceClient().rpc('unsubscribe_email', { p_token: token });
  }
  const form = await req.formData().catch(() => null);
  if (form?.get('source') === 'page') {
    return Response.redirect(new URL(`/u/${encodeURIComponent(token)}?done=1`, req.url), 303);
  }
  return new Response('Unsubscribed', { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
