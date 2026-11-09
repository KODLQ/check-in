import postgres from 'postgres';

/**
 * Direct DB access for fixtures (local Supabase only). Shared by every spec file in the worker, so specs
 * must not call sql.end(); the idle timeout closes the connection once tests stop using it.
 */
export const sql = postgres(process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
  max: 1,
  idle_timeout: 2,
  onnotice: () => {},
});

const HOST_ID = 'e2e00000-0000-0000-0000-000000000001';

export async function ensureHost() {
  await sql`
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', ${HOST_ID}, 'authenticated', 'authenticated', 'e2e-host@checkin.test',
            '{"full_name":"E2E Host"}', '', '', '', '')
    on conflict (id) do nothing`;
}

let counter = 0;

/** Creates an event with a known token. Uses replica mode so past events can be created. */
export async function createEvent(opts: {
  title?: string;
  startsInHours?: number;
  cancelled?: boolean;
  guestListVisible?: boolean;
  location?: string;
  /** Guests (add-guest-capacity). */
  capacity?: number | null;
  allowPlusOnes?: boolean;
  maxPlusOnes?: number;
} = {}): Promise<string> {
  await ensureHost();
  const token = `E2e${Date.now().toString(36)}${counter++}`.padEnd(12, 'x').slice(0, 12);
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const [ev] = await tx`
      insert into public.events (host_id, title, starts_at, location_text, cancelled_at, guest_list_visible,
                                 capacity, allow_plus_ones, max_plus_ones)
      values (${HOST_ID}, ${opts.title ?? 'E2E Party'},
              now() + make_interval(hours => ${opts.startsInHours ?? 48}),
              ${opts.location ?? 'Secret Street 42'},
              ${opts.cancelled ? new Date() : null}, ${opts.guestListVisible ?? true},
              ${opts.capacity ?? null}, ${opts.allowPlusOnes ?? false}, ${opts.maxPlusOnes ?? 1})
      returning id`;
    await tx`insert into public.event_invites (token, event_id) values (${token}, ${ev!.id})`;
  });
  return token;
}

export async function revoke(token: string) {
  await sql`update public.event_invites set revoked_at = now() where token = ${token}`;
}

export const E2E_HOST_ID = HOST_ID;

export async function eventIdFor(token: string): Promise<string> {
  const [row] = await sql`select event_id from public.event_invites where token = ${token}`;
  return row!.event_id as string;
}

/** Posts an announcement as the event's host, through the same RPC the app uses. */
export async function postAnnouncement(token: string, body: string): Promise<string> {
  const eventId = await eventIdFor(token);
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: HOST_ID, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    const [row] = await tx`select public.post_announcement(${eventId}, ${body}) as a`;
    return (row!.a as { id: string }).id;
  });
}

export async function subscriptionFor(email: string) {
  const [row] = await sql`select rsvp_id, unsubscribe_token, locale from public.rsvp_email_subscriptions where email = ${email}`;
  return row as { rsvp_id: string; unsubscribe_token: string; locale: string } | undefined;
}

// ---- Notifications worker + Mailpit (local stack) ----
const FUNCTIONS_URL = process.env.FUNCTIONS_URL ?? 'http://127.0.0.1:54321/functions/v1';
const WORKER_SECRET = process.env.NOTIFICATIONS_WORKER_SECRET ?? 'dev-only-worker-secret';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';

export async function runWorker() {
  const res = await fetch(`${FUNCTIONS_URL}/notifications-worker`, {
    method: 'POST',
    headers: { 'x-worker-secret': WORKER_SECRET },
  });
  if (!res.ok) throw new Error(`worker ${res.status}: ${await res.text()}`);
  return res.json();
}

export interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function mailsTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${address}"`)}`);
  const body = (await res.json()) as { messages?: MailSummary[] };
  return body.messages ?? [];
}

/** Polls Mailpit until a message to `address` matching `subject` arrives. */
export async function waitForMail(address: string, subject: RegExp, timeoutMs = 60_000): Promise<MailSummary> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const hit = (await mailsTo(address)).find((m) => subject.test(m.Subject));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`No mail to ${address} matching ${subject} within ${timeoutMs} ms`);
}

export async function mailDetail(id: string) {
  const [msg, headers] = await Promise.all([
    fetch(`${MAILPIT}/api/v1/message/${id}`).then((r) => r.json() as Promise<{ Text: string; HTML: string; Subject: string }>),
    fetch(`${MAILPIT}/api/v1/message/${id}/headers`).then((r) => r.json() as Promise<Record<string, string[]>>),
  ]);
  return { ...msg, headers };
}

// ---- Date polls (add-date-polls) ----

/** Runs `fn` in a transaction as the E2E host (RLS and auth.uid() as in the app). */
async function asHost<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  await ensureHost();
  return sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: HOST_ID, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Creates a date-pending event through the same RPC the app uses, with one option per entry of `hours`
 * (now + h hours), and gives its link a known token.
 */
export async function createPollEvent(opts: {
  title?: string;
  hours?: number[];
  location?: string;
  guestListVisible?: boolean;
  capacity?: number | null;
} = {}): Promise<string> {
  const hours = opts.hours ?? [48, 72];
  const token = `Pol${Date.now().toString(36)}${counter++}`.padEnd(12, 'x').slice(0, 12);
  const options = hours.map((h) => ({ starts_at: new Date(Date.now() + h * 3600_000).toISOString() }));
  const event = {
    title: opts.title ?? 'E2E Poll',
    location_text: opts.location ?? 'Secret Street 42',
    guest_list_visible: opts.guestListVisible ?? true,
    capacity: opts.capacity ?? null,
  };
  const created = await asHost(async (tx) => {
    const [row] = await tx`select public.create_poll_event(${tx.json(event)}, ${tx.json(options)}) as r`;
    return row!.r as { event_id: string; token: string };
  });
  await sql`update public.event_invites set token = ${token} where event_id = ${created.event_id}`;
  return token;
}

/** Option ids of a poll, by start time. */
export async function pollOptionIds(token: string): Promise<string[]> {
  const rows = await sql`
    select o.id from public.date_poll_options o
    join public.event_invites i on i.event_id = o.event_id
    where i.token = ${token} order by o.starts_at`;
  return rows.map((r) => r.id as string);
}

/** The host picks the n-th option (0-based) through pick_poll_option. */
export async function pickOption(token: string, index: number) {
  const id = (await pollOptionIds(token))[index]!;
  return asHost(async (tx) => {
    const [row] = await tx`select public.pick_poll_option(${id}) as r`;
    return row!.r as { going: number; maybe: number; waitlisted: number };
  });
}

/** Moves a poll's voting deadline (bypassing the RPC's future-only rule, to simulate time passing). */
export async function setPollDeadline(token: string, closesAt: Date | null) {
  const eventId = await eventIdFor(token);
  await sql.begin(async (tx) => {
    await tx`select set_config('checkin.poll_rpc', 'on', true)`;
    await tx`update public.events set poll_closes_at = ${closesAt} where id = ${eventId}`;
  });
}

/** Moves every option of a poll into the past (simulates an expired poll). */
export async function expirePoll(token: string) {
  const eventId = await eventIdFor(token);
  await sql`update public.date_poll_options set starts_at = starts_at - interval '30 days' where event_id = ${eventId}`;
}
