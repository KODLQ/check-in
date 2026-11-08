-- Random base62 token, 12 chars (~71 bits). Rejection sampling avoids modulo bias.
create or replace function public.generate_invite_token()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  result text := '';
  bytes bytea;
  b int;
  i int;
begin
  while char_length(result) < 12 loop
    bytes := extensions.gen_random_bytes(16);
    for i in 0..15 loop
      b := get_byte(bytes, i);
      if b < 248 and char_length(result) < 12 then -- 248 = 62 * 4
        result := result || substr(alphabet, (b % 62) + 1, 1);
      end if;
    end loop;
  end loop;
  return result;
end;
$$;

create table public.event_invites (
  token text primary key default public.generate_invite_token()
    check (token ~ '^[A-Za-z0-9]{12}$'),
  event_id uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- At most one active link per event.
create unique index event_invites_one_active_idx
on public.event_invites (event_id)
where revoked_at is null;

alter table public.event_invites enable row level security;

create policy "invites: host can read"
on public.event_invites for select
to authenticated
using (public.is_event_host(event_id));

create policy "invites: host can create"
on public.event_invites for insert
to authenticated
with check (public.is_event_host(event_id));

create policy "invites: host can revoke"
on public.event_invites for update
to authenticated
using (public.is_event_host(event_id))
with check (public.is_event_host(event_id));

-- Every new event gets an invite link.
create or replace function public.create_initial_invite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.event_invites (event_id) values (new.id);
  return new;
end;
$$;

create trigger events_create_invite
after insert on public.events
for each row execute function public.create_initial_invite();

-- Revoke the active link and issue a new one. Existing RSVPs are untouched.
create or replace function public.regenerate_invite(p_event_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_token text;
begin
  if not public.is_event_host(p_event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.event_invites
  set revoked_at = now()
  where event_id = p_event_id and revoked_at is null;

  insert into public.event_invites (event_id)
  values (p_event_id)
  returning token into new_token;

  return new_token;
end;
$$;

revoke execute on function public.regenerate_invite(uuid) from public, anon;
grant execute on function public.regenerate_invite(uuid) to authenticated;
