// Email provider webhook (Resend): on a hard bounce or a spam complaint, forget the address
// (spec: Guest email retention - hard bounce). Signature-verified; verify_jwt is off.
import { verifyWebhook } from '../_shared/webhook.ts';

export interface EmailEventsDeps {
  secret: string;
  /** Deletes the subscription that the provider message was sent to. Returns whether a row was deleted. */
  forgetAddress(providerMessageId: string): Promise<boolean>;
  nowSeconds?: () => number;
}

interface ResendEvent {
  type?: string;
  data?: { email_id?: string; bounce?: { type?: string } };
}

export async function handleEmailEvent(req: Request, deps: EmailEventsDeps): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const body = await req.text();
  if (!(await verifyWebhook(deps.secret, req.headers, body, deps.nowSeconds?.()))) {
    return new Response('Invalid signature', { status: 401 });
  }
  let event: ResendEvent;
  try {
    event = JSON.parse(body) as ResendEvent;
  } catch {
    return new Response('Bad payload', { status: 400 });
  }
  const id = event.data?.email_id;
  const hardBounce = event.type === 'email.bounced' && event.data?.bounce?.type !== 'Transient';
  const complaint = event.type === 'email.complained';
  if (id && (hardBounce || complaint)) {
    const deleted = await deps.forgetAddress(id);
    return Response.json({ handled: true, deleted });
  }
  return Response.json({ handled: false });
}
