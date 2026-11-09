/**
 * Concurrency tests for guest capacity (change: add-guest-capacity, task 2.9; spec: event-capacity
 * "No overbooking under concurrency"). pgTAP runs in one session, so it can't race two transactions;
 * these tests open many real connections to the local Supabase database and fire the same RPCs PostgREST
 * calls (as service_role / authenticated, one transaction each) at the same instant.
 *
 * Run: npm run test:concurrency   (needs `npx supabase start`; DB_URL overrides the default local URL)
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PARALLEL = 50;
const HOST_ID = 'cc000000-0000-0000-0000-0000000000a1';

const sql = postgres(DB_URL, { max: PARALLEL + 5, idle_timeout: 5, onnotice: () => {} });

let seq = 0;
const runId = Date.now().toString(36).slice(-5);

/** Token: 12 base62 chars, unique per event created in this run. */
function nextToken(): string {
  return `Cc${runId}${(seq++).toString(36)}`.padEnd(12, 'x').slice(0, 12);
}

const guestToken = (name: string) => `conc-${runId}-${name}`.padEnd(30, 'x');

async function createEvent(capacity: number | null, allowPlusOnes = false, maxPlusOnes = 1) {
  const token = nextToken();
  const [ev] = await sql<{ id: string }[]>`
    insert into public.events (host_id, title, starts_at, location_text, capacity, allow_plus_ones, max_plus_ones)
    values (${HOST_ID}, 'Concurrency', now() + interval '2 days', 'Room', ${capacity}, ${allowPlusOnes}, ${maxPlusOnes})
    returning id`;
  await sql`update public.event_invites set token = ${token} where event_id = ${ev!.id}`;
  return { id: ev!.id, token };
}

/** A promise every caller awaits; resolves once `n` callers have arrived (all transactions are open). */
function barrier(n: number) {
  let arrived = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  return async () => {
    arrived += 1;
    if (arrived === n) release();
    await gate;
  };
}

/** Runs `fn` in its own transaction as service_role (like PostgREST with the service key). */
function asService<T>(wait: () => Promise<void>, fn: (tx: postgres.TransactionSql) => Promise<T>) {
  return sql.begin(async (tx) => {
    await tx`set local role service_role`;
    await wait();
    return fn(tx);
  });
}

const rsvp = (tx: postgres.TransactionSql, token: string, name: string, plusOnes = 0) =>
  tx`select public.upsert_rsvp(${token}, ${guestToken(name)}, ${name}, 'going', p_plus_ones => ${plusOnes}) as r`;

const withdraw = (tx: postgres.TransactionSql, token: string, name: string) =>
  tx`select public.withdraw_rsvp(${token}, ${guestToken(name)}) as r`;

async function state(eventId: string) {
  const rows = await sql<{ display_name: string; status: string; plus_ones: number; waitlisted_at: Date | null }[]>`
    select display_name, status::text, plus_ones, waitlisted_at from public.rsvps where event_id = ${eventId}
    order by waitlisted_at, id`;
  const [ev] = await sql<{ capacity: number | null }[]>`select capacity from public.events where id = ${eventId}`;
  const going = rows.filter((r) => r.status === 'going');
  const heads = going.reduce((n, r) => n + 1 + r.plus_ones, 0);
  const waitlist = rows.filter((r) => r.status === 'waitlisted');
  return { rows, heads, going, waitlist, capacity: ev!.capacity };
}

/** Invariant after every committed write: nobody waiting fits in the spots left. */
function expectNoWaitingGuestFits(s: Awaited<ReturnType<typeof state>>) {
  if (s.capacity === null) {
    expect(s.waitlist).toHaveLength(0);
    return;
  }
  const left = s.capacity - s.heads;
  for (const w of s.waitlist) expect(1 + w.plus_ones).toBeGreaterThan(left);
}

beforeAll(async () => {
  await sql`
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, confirmation_token, recovery_token,
                            email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', ${HOST_ID}, 'authenticated', 'authenticated',
            'concurrency-host@checkin.test', '{"full_name":"Conc Host"}', '', '', '', '')
    on conflict (id) do nothing`;
});

afterAll(async () => {
  await sql`delete from public.events where host_id = ${HOST_ID}`;
  await sql.end();
});

describe('capacity under concurrency', () => {
  it(`${PARALLEL} parallel Going answers on a 10-spot event admit exactly 10`, async () => {
    const ev = await createEvent(10);
    const wait = barrier(PARALLEL);
    const results = await Promise.allSettled(
      Array.from({ length: PARALLEL }, (_, i) => asService(wait, (tx) => rsvp(tx, ev.token, `g${i}`))),
    );
    const failures = results.filter((r) => r.status === 'rejected');
    expect(failures).toEqual([]);

    const s = await state(ev.id);
    expect(s.heads).toBe(10);
    expect(s.going).toHaveLength(10);
    expect(s.waitlist).toHaveLength(PARALLEL - 10);
    // Waitlist positions are a gapless 1..40 in the order the answers were admitted.
    const positions = await sql<{ p: number }[]>`
      select public.waitlist_position(r.id) as p from public.rsvps r where r.event_id = ${ev.id} and r.status = 'waitlisted'
      order by 1`;
    expect(positions.map((r) => r.p)).toEqual(Array.from({ length: PARALLEL - 10 }, (_, i) => i + 1));
  });

  it('parallel answers with plus-ones never exceed capacity', async () => {
    const ev = await createEvent(25, true, 3);
    const wait = barrier(PARALLEL);
    const results = await Promise.allSettled(
      Array.from({ length: PARALLEL }, (_, i) => asService(wait, (tx) => rsvp(tx, ev.token, `p${i}`, i % 4))),
    );
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const s = await state(ev.id);
    expect(s.heads).toBeLessThanOrEqual(25);
    expectNoWaitingGuestFits(s);
  });

  it('two guests taking the last spot at once: exactly one is Going', async () => {
    for (let round = 0; round < 10; round++) {
      const ev = await createEvent(3);
      const setup = barrier(1);
      for (const n of ['a', 'b']) await asService(setup, (tx) => rsvp(tx, ev.token, `${round}${n}`));
      const wait = barrier(2);
      await Promise.all(['x', 'y'].map((n) => asService(wait, (tx) => rsvp(tx, ev.token, `${round}${n}`))));
      const s = await state(ev.id);
      expect(s.heads).toBe(3);
      expect(s.waitlist).toHaveLength(1);
    }
  });

  it('withdraw and a new Going answer race: the spot goes to the first waitlisted guest', async () => {
    for (let round = 0; round < 10; round++) {
      const ev = await createEvent(10);
      const one = barrier(1);
      for (let i = 0; i < 10; i++) await asService(one, (tx) => rsvp(tx, ev.token, `r${round}g${i}`));
      await asService(one, (tx) => rsvp(tx, ev.token, `r${round}w1`));
      const wait = barrier(2);
      const results = await Promise.allSettled([
        asService(wait, (tx) => withdraw(tx, ev.token, `r${round}g0`)),
        asService(wait, (tx) => rsvp(tx, ev.token, `r${round}new`)),
      ]);
      expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
      const s = await state(ev.id);
      const status = (n: string) => s.rows.find((r) => r.display_name === n)?.status;
      expect(status(`r${round}w1`)).toBe('going');
      expect(status(`r${round}new`)).toBe('waitlisted');
      expect(s.heads).toBe(10);
    }
  });

  it('a storm of joins, withdrawals, plus-one changes and capacity edits keeps the invariants', async () => {
    const ev = await createEvent(12, true, 3);
    const one = barrier(1);
    for (let i = 0; i < 20; i++) await asService(one, (tx) => rsvp(tx, ev.token, `s${i}`, i % 3));
    const ops: ((tx: postgres.TransactionSql) => Promise<unknown>)[] = [];
    for (let i = 0; i < 20; i++) ops.push((tx) => withdraw(tx, ev.token, `s${i}`));
    for (let i = 20; i < 40; i++) ops.push((tx) => rsvp(tx, ev.token, `s${i}`, i % 4));
    // Relative raises only, so the final capacity is never below heads that were admitted legitimately.
    for (let i = 0; i < 5; i++) ops.push((tx) => tx`update public.events set capacity = capacity + 1 where id = ${ev.id}`);
    const wait = barrier(ops.length);
    const results = await Promise.allSettled(ops.map((op) => asService(wait, op)));
    // Withdrawals of answers that a racing op already removed just return false; nothing may fail
    // (in particular: no deadlock_detected / serialization errors).
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const s = await state(ev.id);
    expect(s.heads).toBeLessThanOrEqual(s.capacity!);
    expectNoWaitingGuestFits(s);
  });

  it('host removals (remove_rsvp) racing new answers keep the invariants', async () => {
    const ev = await createEvent(8);
    const one = barrier(1);
    for (let i = 0; i < 16; i++) await asService(one, (tx) => rsvp(tx, ev.token, `h${i}`));
    const ids = await sql<{ id: string }[]>`
      select id from public.rsvps where event_id = ${ev.id} and status = 'going' order by id limit 5`;
    const claims = JSON.stringify({ sub: HOST_ID, role: 'authenticated' });
    const ops: Promise<unknown>[] = [];
    const wait = barrier(ids.length + 10);
    for (const { id } of ids) {
      ops.push(
        sql.begin(async (tx) => {
          await tx`select set_config('request.jwt.claims', ${claims}, true)`;
          await tx`set local role authenticated`;
          await wait();
          return tx`select public.remove_rsvp(${id}) as r`;
        }),
      );
    }
    for (let i = 16; i < 26; i++) ops.push(asService(wait, (tx) => rsvp(tx, ev.token, `h${i}`)));
    const results = await Promise.allSettled(ops);
    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const s = await state(ev.id);
    expect(s.heads).toBe(8);
    expectNoWaitingGuestFits(s);
  });
});
