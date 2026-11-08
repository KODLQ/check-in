import { assertEquals } from '@std/assert';

import { signWebhook } from '../_shared/webhook.ts';
import { handleEmailEvent } from './handler.ts';

const secret = 'whsec_' + btoa('test-signing-secret-0123456789');
const now = 1_800_000_000;

async function signed(payload: unknown, opts: { secret?: string; ts?: number } = {}) {
  const body = JSON.stringify(payload);
  const ts = opts.ts ?? now;
  return new Request('http://localhost/email-events', {
    method: 'POST',
    body,
    headers: {
      'svix-id': 'msg_1',
      'svix-timestamp': String(ts),
      'svix-signature': await signWebhook(opts.secret ?? secret, 'msg_1', ts, body),
    },
  });
}

function deps(forgotten: string[]) {
  return {
    secret,
    nowSeconds: () => now,
    forgetAddress: (id: string) => {
      forgotten.push(id);
      return Promise.resolve(true);
    },
  };
}

Deno.test('hard bounce deletes the subscription', async () => {
  const forgotten: string[] = [];
  const res = await handleEmailEvent(
    await signed({ type: 'email.bounced', data: { email_id: 'em_1', bounce: { type: 'Permanent' } } }),
    deps(forgotten),
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { handled: true, deleted: true });
  assertEquals(forgotten, ['em_1']);
});

Deno.test('spam complaint deletes the subscription', async () => {
  const forgotten: string[] = [];
  await handleEmailEvent(await signed({ type: 'email.complained', data: { email_id: 'em_2' } }), deps(forgotten));
  assertEquals(forgotten, ['em_2']);
});

Deno.test('transient bounces and other events are ignored', async () => {
  const forgotten: string[] = [];
  await handleEmailEvent(
    await signed({ type: 'email.bounced', data: { email_id: 'em_3', bounce: { type: 'Transient' } } }),
    deps(forgotten),
  );
  await handleEmailEvent(await signed({ type: 'email.delivered', data: { email_id: 'em_4' } }), deps(forgotten));
  assertEquals(forgotten, []);
});

Deno.test('bad or stale signatures are rejected', async () => {
  const forgotten: string[] = [];
  const wrong = await handleEmailEvent(
    await signed({ type: 'email.complained', data: { email_id: 'em_5' } }, { secret: 'whsec_' + btoa('other') }),
    deps(forgotten),
  );
  assertEquals(wrong.status, 401);
  const stale = await handleEmailEvent(
    await signed({ type: 'email.complained', data: { email_id: 'em_6' } }, { ts: now - 3600 }),
    deps(forgotten),
  );
  assertEquals(stale.status, 401);
  assertEquals(forgotten, []);
});
