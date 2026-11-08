import { assert, assertEquals, assertStringIncludes } from '@std/assert';

import { buildMime, classifyHttpStatus, resendTransport, type OutgoingEmail } from './email.ts';

const msg: OutgoingEmail = {
  from: 'check-in <updates@checkin.example>',
  to: 'guest@example.com',
  subject: 'Påminnelse: Fredagshäng',
  text: 'Hej',
  html: '<p>Hej</p>',
  headers: {
    'List-Unsubscribe': '<https://checkin.example/api/unsubscribe/tok>',
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
  idempotencyKey: 'delivery-1',
};

function mockFetch(status: number, body: unknown, seen: Request[] = []): typeof fetch {
  return (input, init) => {
    seen.push(new Request(input as string, init));
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
}

Deno.test('resend: success returns the provider id and sends the idempotency key', async () => {
  const seen: Request[] = [];
  const r = await resendTransport({ apiKey: 're_test', fetch: mockFetch(200, { id: 'em_123' }, seen) }).send(msg);
  assertEquals(r, { ok: true, id: 'em_123' });
  assertEquals(seen[0]!.headers.get('Idempotency-Key'), 'delivery-1');
  assertEquals(seen[0]!.headers.get('Authorization'), 'Bearer re_test');
  const body = await seen[0]!.json();
  assertEquals(body.to, ['guest@example.com']);
  assertEquals(body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
});

Deno.test('resend: 429 and 5xx are temporary', async () => {
  for (const status of [429, 500, 503]) {
    const r = await resendTransport({ apiKey: 'k', fetch: mockFetch(status, { name: 'x' }) }).send(msg);
    assertEquals(r.ok, false);
    assert(!r.ok && r.temporary, `${status} should be temporary`);
  }
});

Deno.test('resend: validation errors are permanent', async () => {
  const r = await resendTransport({ apiKey: 'k', fetch: mockFetch(422, { name: 'validation_error' }) }).send(msg);
  assertEquals(r, { ok: false, temporary: false, error: 'resend_422_validation_error' });
});

Deno.test('classifyHttpStatus', () => {
  assertEquals(classifyHttpStatus(202), 'ok');
  assertEquals(classifyHttpStatus(409), 'temporary');
  assertEquals(classifyHttpStatus(401), 'permanent');
});

Deno.test('MIME message encodes non-ASCII subjects and keeps unsubscribe headers', () => {
  const mime = buildMime(msg, 'delivery-1@check-in.local', new Date('2026-11-08T12:00:00Z'));
  assertStringIncludes(mime, 'Subject: =?UTF-8?B?');
  assertStringIncludes(mime, 'Message-ID: <delivery-1@check-in.local>');
  assertStringIncludes(mime, 'List-Unsubscribe: <https://checkin.example/api/unsubscribe/tok>');
  assertStringIncludes(mime, 'List-Unsubscribe-Post: List-Unsubscribe=One-Click');
});
