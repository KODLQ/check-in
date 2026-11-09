/**
 * Concurrency tests for date polls (change: add-date-polls; spec: date-polls "Two managers pick at once",
 * "Vote after pick", "Pick respects capacity", "Voter cap reached"). Like capacity.test.ts these open real
 * connections to the local database and fire the RPCs at the same instant.
 *
 * Run: npm run test:concurrency   (needs `npx supabase start`)
 */
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DB_URL = process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const PARALLEL = 40;
const OWNER = 'cc000000-0000-0000-0000-0000000000d1';
const COHOST = 'cc000000-0000-0000-0000-0000000000d2';

const sql = postgres(DB_URL, { max: PARALLEL + 5, idle_timeout: 5, onnotice: () => {} });
const runId = Date.now().toString(36).slice(-5);
let seq = 0;
const nextToken = () => `Dp${runId}${(seq++).toString(36)}`.padEnd(12, 'x').slice(0, 12);
const guestToken = (name: string) => `dpconc-${runId}-${name}`.padEnd(30, 'x');

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

const claims = (sub: string) => JSON.stringify({ sub, role: 'authenticated' });

/** A pending event owned by OWNER (COHOST co-hosts) with options at the given hours, created via the RPC. */
async function createPoll(hours: number[], capacity: number | null = null) {
  const token = nextToken();
  const options = hours.map((h) => ({ starts_at: new Date(Date.now() + h * 3600_000).toISOString() }));
  const created = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(OWNER)}, true)`;
    await tx`set local role authenticated`;
    const [row] = await tx`select public.create_poll_event(${tx.json({ title: 'Conc poll', location_text: 'Room', capacity })},
                                                          ${tx.json(options)}) as r`;
    return row!.r as { event_id: string };
  });
  const id = created.event_id;
  await sql`update public.event_invites set token = ${token} where event_id = ${id}`;
  await sql`insert into public.event_co_hosts (event_id, user_id) values (${id}, ${COHOST})`;
  const opts = await sql<{ id: string }[]>`select id from public.date_poll_options where event_id = ${id} order by starts_at`;
  return { id, token, options: opts.map((o) => o.id) };
}

function vote(wait: () => Promise<void>, token: string, name: string, optionId: string, choice = 'yes') {
  return sql.begin(async (tx) => {
    await tx`set local role service_role`;
    await wait();
    return tx`select public.submit_votes(${token}, ${guestToken(name)}, ${name},
                                         ${tx.json([{ option_id: optionId, choice }])}) as r`;
  });
}

function pick(wait: () => Promise<void>, as: string, optionId: string) {
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${claims(as)}, true)`;
    await tx`set local role authenticated`;
    await wait();
    return tx`select public.pick_poll_option(${optionId}) as r`;
  });
}

beforeAll(async () => {
  for (const [id, name] of [
    [OWNER, 'Poll Owner'],
    [COHOST, 'Poll Cohost'],
  ] as const) {
    await sql`
      insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, confirmation_token, recovery_token,
                              email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', ${id}, 'authenticated', 'authenticated',
              ${`${id}@checkin.test`}, ${sql.json({ full_name: name })}, '', '', '', '')
      on conflict (id) do nothing`;
  }
});

afterAll(async () => {
  await sql`delete from public.events where host_id = ${OWNER}`;
  await sql.end();
});

describe('date polls under concurrency', () => {
  it('owner and co-host picking at once: exactly one pick applies', async () => {
    for (let round = 0; round < 10; round++) {
      const p = await createPoll([48, 72]);
      const wait = barrier(2);
      const results = await Promise.allSettled([pick(wait, OWNER, p.options[0]!), pick(wait, COHOST, p.options[1]!)]);
      const ok = results.filter((r) => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(String(failed[0]!.reason.message)).toContain('already_picked');
    }
  });

  it('votes racing a pick are either converted or rejected, never left behind', async () => {
    const p = await createPoll([48, 72], 10);
    const wait = barrier(PARALLEL + 1);
    const results = await Promise.allSettled([
      ...Array.from({ length: PARALLEL }, (_, i) => vote(wait, p.token, `r${i}`, p.options[0]!)),
      pick(wait, OWNER, p.options[0]!),
    ]);
    const pickResult = results[PARALLEL]!;
    expect(pickResult.status).toBe('fulfilled');
    const rejected = results.slice(0, PARALLEL).filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    for (const r of rejected) expect(String(r.reason.message)).toContain('poll_closed');

    const accepted = PARALLEL - rejected.length;
    const [counts] = await sql<{ going: number; waitlisted: number; voters: number; heads: number }[]>`
      select count(*) filter (where status = 'going')::int as going,
             count(*) filter (where status = 'waitlisted')::int as waitlisted,
             (select count(*)::int from public.date_poll_voters where event_id = ${p.id}) as voters,
             public.event_going_heads(${p.id}) as heads
      from public.rsvps where event_id = ${p.id}`;
    // Every vote that got in before the pick became an RSVP; capacity 10 holds; no votes survive the pick.
    expect(counts!.going + counts!.waitlisted).toBe(accepted);
    expect(counts!.heads).toBeLessThanOrEqual(10);
    expect(counts!.going).toBe(Math.min(accepted, 10));
    expect(counts!.voters).toBe(0);
  });

  it('parallel new voters never exceed the voter cap', async () => {
    const p = await createPoll([48, 72]);
    // Fill up to 5 below the cap directly, then race 20 new voters for the last 5 places.
    await sql`
      insert into public.date_poll_voters (event_id, guest_token_hash, display_name)
      select ${p.id}, public.hash_guest_token('dpfill-' || ${runId} || '-' || g), 'Filler ' || g
      from generate_series(1, public.max_rsvps_per_event() - 5) g`;
    const wait = barrier(20);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => vote(wait, p.token, `cap${i}`, p.options[1]!)),
    );
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(15);
    for (const r of rejected) expect(String(r.reason.message)).toContain('rate_limited');
    const [row] = await sql<{ n: number }[]>`select count(*)::int as n from public.date_poll_voters where event_id = ${p.id}`;
    expect(row!.n).toBe(500);
  });
});
