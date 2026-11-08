import { assertEquals } from '@std/assert';

import { expoPushClient, type ExpoMessage } from './push.ts';

const msg = (i: number): ExpoMessage => ({ to: `ExponentPushToken[${i}]`, title: 't', body: 'b' });

Deno.test('expo: batches of 100 and maps tickets', async () => {
  const sizes: number[] = [];
  const fetchMock: typeof fetch = async (_url, init) => {
    const batch = JSON.parse(String(init!.body)) as ExpoMessage[];
    sizes.push(batch.length);
    return Response.json({
      data: batch.map((m) =>
        m.to === 'ExponentPushToken[1]'
          ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
          : m.to === 'ExponentPushToken[2]'
            ? { status: 'error', details: { error: 'MessageRateExceeded' } }
            : { status: 'ok', id: `ticket-${m.to}` },
      ),
    });
  };
  const results = await expoPushClient({ fetch: fetchMock }).send(Array.from({ length: 250 }, (_, i) => msg(i)));
  assertEquals(sizes, [100, 100, 50]);
  assertEquals(results[0], { ok: true, ticketId: 'ticket-ExponentPushToken[0]' });
  assertEquals(results[1], { ok: false, temporary: false, error: 'DeviceNotRegistered' });
  assertEquals(results[2], { ok: false, temporary: true, error: 'MessageRateExceeded' });
});

Deno.test('expo: whole-request failures are temporary for 5xx and permanent for 4xx', async () => {
  const r503 = await expoPushClient({ fetch: () => Promise.resolve(new Response('', { status: 503 })) }).send([msg(0)]);
  assertEquals(r503, [{ ok: false, temporary: true, error: 'expo_503' }]);
  const r400 = await expoPushClient({ fetch: () => Promise.resolve(new Response('', { status: 400 })) }).send([msg(0)]);
  assertEquals(r400, [{ ok: false, temporary: false, error: 'expo_400' }]);
});

Deno.test('expo: receipts', async () => {
  const fetchMock: typeof fetch = () =>
    Promise.resolve(
      Response.json({ data: { a: { status: 'ok' }, b: { status: 'error', details: { error: 'DeviceNotRegistered' } } } }),
    );
  const r = await expoPushClient({ fetch: fetchMock }).receipts(['a', 'b']);
  assertEquals(r.get('a'), { ok: true });
  assertEquals(r.get('b'), { ok: false, error: 'DeviceNotRegistered' });
});
