import postgres from 'postgres';

/** Direct DB access for fixtures (local Supabase only). */
export const sql = postgres(process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', {
  max: 1,
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
} = {}): Promise<string> {
  await ensureHost();
  const token = `E2e${Date.now().toString(36)}${counter++}`.padEnd(12, 'x').slice(0, 12);
  await sql.begin(async (tx) => {
    await tx`set local session_replication_role = replica`;
    const [ev] = await tx`
      insert into public.events (host_id, title, starts_at, location_text, cancelled_at, guest_list_visible)
      values (${HOST_ID}, ${opts.title ?? 'E2E Party'},
              now() + make_interval(hours => ${opts.startsInHours ?? 48}),
              ${opts.location ?? 'Secret Street 42'},
              ${opts.cancelled ? new Date() : null}, ${opts.guestListVisible ?? true})
      returning id`;
    await tx`insert into public.event_invites (token, event_id) values (${token}, ${ev!.id})`;
  });
  return token;
}

export async function revoke(token: string) {
  await sql`update public.event_invites set revoked_at = now() where token = ${token}`;
}
