import { assert, assertEquals, assertStringIncludes } from '@std/assert';

import type { EmailTransport, OutgoingEmail } from '../_shared/email.ts';
import type { ExpoMessage, PushClient } from '../_shared/push.ts';
import { runWorker, type DeliveryContext, type Outcome, type WorkerDb } from './worker.ts';

const event = {
  id: 'e1',
  title: 'Fredagshäng',
  starts_at: '2026-12-11T18:00:00Z',
  ends_at: null,
  time_zone: 'Europe/Stockholm',
  location_text: 'Hornsgatan 12',
  place_name: null,
};

const ctx = (over: Partial<DeliveryContext>): DeliveryContext => ({
  delivery_id: 'd',
  notification_id: 'n',
  channel: 'push',
  kind: 'announcement',
  attempts: 1,
  locale: 'en',
  to: 'ExponentPushToken[a]',
  unsubscribe_token: null,
  invite_token: 'DemoFredag01',
  url_path: '/i/DemoFredag01',
  event,
  host_name: 'Demo Host',
  payload: {},
  announcement: { body: 'Doors 19:30' },
  replies: null,
  ...over,
});

/** In-memory stand-in for the claim/complete functions: deliveries go pending -> sending -> outcome. */
function fakeDb(contexts: DeliveryContext[]) {
  const status = new Map(contexts.map((c) => [c.delivery_id, 'pending' as string]));
  const completions: { id: string; outcome: Outcome; providerId?: string | null; error?: string | null }[] = [];
  const db: WorkerDb = {
    fanOut: () => Promise.resolve(0),
    claim: () => {
      const due = contexts.filter((c) => status.get(c.delivery_id) === 'pending');
      due.forEach((c) => status.set(c.delivery_id, 'sending'));
      return Promise.resolve(due);
    },
    complete: (id, outcome, providerId, error) => {
      completions.push({ id, outcome, providerId, error });
      // temporary => pending again, but with a backoff (not due within this run)
      status.set(id, outcome === 'temporary' ? 'retry_later' : outcome);
      return Promise.resolve();
    },
    dueReceipts: () => Promise.resolve([{ delivery_id: 'old', ticket_id: 'ticket-old' }]),
    recordReceipt: (id, s, error) => {
      completions.push({ id, outcome: s === 'ok' ? 'sent' : 'permanent', error });
      return Promise.resolve();
    },
  };
  return { db, status, completions };
}

const config = { webBaseUrl: 'https://checkin.example/', emailFrom: 'check-in <updates@checkin.example>' };

Deno.test('full cycle: renders, sends push and email, records outcomes and receipts', async () => {
  const contexts = [
    ctx({ delivery_id: 'p1' }),
    ctx({ delivery_id: 'p2', to: 'ExponentPushToken[b]', locale: 'sv' }),
    ctx({ delivery_id: 'e1', channel: 'email', to: 'guest@example.com', unsubscribe_token: 'unsub1', locale: 'sv' }),
  ];
  const { db, completions } = fakeDb(contexts);
  const pushed: ExpoMessage[] = [];
  const mailed: OutgoingEmail[] = [];
  const push: PushClient = {
    send: (m) => {
      pushed.push(...m);
      return Promise.resolve(m.map((x) => ({ ok: true as const, ticketId: `t-${x.to}` })));
    },
    receipts: () => Promise.resolve(new Map([['ticket-old', { ok: false, error: 'DeviceNotRegistered' }]])),
  };
  const email: EmailTransport = {
    name: 'fake',
    send: (m) => {
      mailed.push(m);
      return Promise.resolve({ ok: true, id: 'msg-1' });
    },
  };

  const stats = await runWorker({ db, push, email, config });

  assertEquals(stats.sent, 3);
  assertEquals(pushed.length, 2);
  assertEquals(pushed[0]!.data, { kind: 'announcement', url: '/i/DemoFredag01' });
  assertStringIncludes(pushed[0]!.body, 'Doors 19:30');
  assertEquals(mailed.length, 1);
  assertEquals(mailed[0]!.idempotencyKey, 'e1');
  assertEquals(mailed[0]!.subject, 'Ny uppdatering om Fredagshäng');
  assertStringIncludes(mailed[0]!.text, 'https://checkin.example/i/DemoFredag01');
  assertStringIncludes(mailed[0]!.text, 'https://checkin.example/u/unsub1');
  assertEquals(mailed[0]!.headers['List-Unsubscribe'], '<https://checkin.example/api/unsubscribe/unsub1>');
  assertEquals(completions.find((c) => c.id === 'p1')?.providerId, 't-ExponentPushToken[a]');
  assertEquals(completions.find((c) => c.id === 'old'), { id: 'old', outcome: 'permanent', error: 'DeviceNotRegistered' });
});

Deno.test('a thrown send leaves the delivery retryable', async () => {
  const { db, status, completions } = fakeDb([
    ctx({ delivery_id: 'p1' }),
    ctx({ delivery_id: 'e1', channel: 'email', to: 'guest@example.com', unsubscribe_token: 'u' }),
  ]);
  const push: PushClient = { send: () => Promise.reject(new Error('ECONNRESET')), receipts: () => Promise.resolve(new Map()) };
  const email: EmailTransport = { name: 'fake', send: () => Promise.reject(new Error('timeout')) };
  const stats = await runWorker({ db, push, email, config });
  assertEquals(stats.retry, 2);
  assertEquals(status.get('p1'), 'retry_later');
  assertEquals(status.get('e1'), 'retry_later');
  assert(completions.every((c) => c.id === 'old' || c.outcome === 'temporary'));
});

Deno.test('provider errors map to temporary or permanent outcomes', async () => {
  const { db, completions } = fakeDb([ctx({ delivery_id: 'p1' }), ctx({ delivery_id: 'p2', to: 'ExponentPushToken[b]' })]);
  const push: PushClient = {
    send: () =>
      Promise.resolve([
        { ok: false as const, temporary: true, error: 'MessageRateExceeded' },
        { ok: false as const, temporary: false, error: 'DeviceNotRegistered' },
      ]),
    receipts: () => Promise.resolve(new Map()),
  };
  const email: EmailTransport = { name: 'fake', send: () => Promise.resolve({ ok: true, id: 'x' }) };
  await runWorker({ db, push, email, config });
  assertEquals(completions.find((c) => c.id === 'p1')?.outcome, 'temporary');
  assertEquals(completions.find((c) => c.id === 'p2'), { id: 'p2', outcome: 'permanent', providerId: null, error: 'DeviceNotRegistered' });
});

Deno.test('unknown kinds fail permanently instead of looping', async () => {
  const { db, completions } = fakeDb([ctx({ delivery_id: 'x', kind: 'nope' })]);
  const push: PushClient = { send: () => Promise.resolve([]), receipts: () => Promise.resolve(new Map()) };
  const email: EmailTransport = { name: 'fake', send: () => Promise.resolve({ ok: true, id: 'x' }) };
  await runWorker({ db, push, email, config });
  assertEquals(completions[0], { id: 'x', outcome: 'permanent', providerId: null, error: 'unknown_kind' });
});

Deno.test('group membership pushes render without an event (add-groups-and-recurring-events)', async () => {
  const { db, completions } = fakeDb([
    ctx({ delivery_id: 'g1', kind: 'group_invited', event: null, invite_token: null, url_path: '/groups',
      group: { id: 'g', name: 'AW crew' }, actor_name: 'Anna' }),
    ctx({ delivery_id: 'g2', kind: 'group_joined', event: null, invite_token: null, url_path: '/groups/g', locale: 'sv',
      group: { id: 'g', name: 'AW crew' }, joined_names: ['Erik', 'Sara'] }),
    ctx({ delivery_id: 'g3', kind: 'group_new_owner', event: null, invite_token: null, url_path: '/groups/g', group: null }),
    ctx({ delivery_id: 'g4', kind: 'group_date_open', url_path: '/invites/e1' }),
  ]);
  const pushed: ExpoMessage[] = [];
  const push: PushClient = {
    send: (m) => {
      pushed.push(...m);
      return Promise.resolve(m.map(() => ({ ok: true as const, ticketId: 't' })));
    },
    receipts: () => Promise.resolve(new Map()),
  };
  const email: EmailTransport = { name: 'fake', send: () => Promise.resolve({ ok: true, id: 'x' }) };
  await runWorker({ db, push, email, config });
  assertEquals(pushed.map((p) => p.title), ['Anna invited you to AW crew', 'AW crew', 'Fredagshäng: are you in?']);
  assertEquals(pushed[0]!.data, { kind: 'group_invited', url: '/groups' });
  assertEquals(pushed[1]!.body, '2 personer gick med: Erik, Sara');
  assertEquals(pushed[2]!.data, { kind: 'group_date_open', url: '/invites/e1' });
  assertEquals(completions.find((c) => c.id === 'g3')?.error, 'render_error');
});
