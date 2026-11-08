-- Co-hosts (change: add-co-hosts). Membership table, co-host invite links, owner / co-host / manager
-- helpers and membership-aware policies. See openspec/changes/add-co-hosts/design.md (permission matrix §1).
--
-- is_event_manager() already exists (add-guest-updates) and is used by announcements, the
-- event_managers notification audience, the reply digest and list_my_invites. Redefining it here
-- extends all of those to co-hosts without touching them.

-- 1. Tokens ---------------------------------------------------------------------------------------

-- Random base62 token of p_length chars. Rejection sampling avoids modulo bias.
create or replace function public.generate_random_token(p_length int)
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
  if p_length is null or p_length < 1 or p_length > 256 then
    raise exception 'invalid_length' using errcode = '22023';
  end if;
  while char_length(result) < p_length loop
    bytes := extensions.gen_random_bytes(32);
    for i in 0..31 loop
      b := get_byte(bytes, i);
      if b < 248 and char_length(result) < p_length then -- 248 = 62 * 4
        result := result || substr(alphabet, (b % 62) + 1, 1);
      end if;
    end loop;
  end loop;
  return result;
end;
$$;

-- Guest invite links keep their 12-char format (~71 bits).
create or replace function public.generate_invite_token()
returns text
language sql
volatile
set search_path = ''
as $$
  select public.generate_random_token(12);
$$;

-- 2. Tables ---------------------------------------------------------------------------------------

create table public.event_co_hosts (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index event_co_hosts_user_idx on public.event_co_hosts (user_id);

-- 22 chars base62 ~ 131 bits: a co-host link grants write access. Never matches the guest-link format.
create table public.co_host_invites (
  token text primary key default public.generate_random_token(22)
    check (token ~ '^[A-Za-z0-9]{22}$'),
  event_id uuid not null references public.events (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz
);

create index co_host_invites_event_idx on public.co_host_invites (event_id);

create or replace function public.max_co_hosts()
returns int language sql immutable set search_path = '' as $$ select 5 $$;

-- The owner is never also a co-host.
create or replace function public.event_co_hosts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.events e where e.id = new.event_id and e.host_id = new.user_id) then
    raise exception 'owner_is_host' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.event_co_hosts_guard() from public, anon, authenticated;

create trigger event_co_hosts_guard
before insert or update on public.event_co_hosts
for each row execute function public.event_co_hosts_guard();

alter table public.event_co_hosts enable row level security;
alter table public.co_host_invites enable row level security;

-- Writes only through the RPCs below (and the delete policy for leave / remove).
revoke all on public.event_co_hosts from anon;
revoke all on public.co_host_invites from anon;
revoke insert, update on public.event_co_hosts from authenticated;
revoke insert, update, delete on public.co_host_invites from authenticated;

-- 3. Helpers (security definer: they read tables the caller may not see) ---------------------------

create or replace function public.is_event_owner(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id and e.host_id = (select auth.uid())
  );
$$;

-- Only reads event_co_hosts, so it is safe inside the events policies (no recursion).
create or replace function public.is_event_co_host(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_co_hosts c
    where c.event_id = p_event_id and c.user_id = (select auth.uid())
  );
$$;

-- Manager = owner or co-host. Single definition for every "can manage this event" check, including
-- announcements, the event_managers notification audience (via is_event_manager_for) and my-invites.
create or replace function public.is_event_manager(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_event_owner(p_event_id) or public.is_event_co_host(p_event_id);
$$;

-- Kept as an OWNER-ONLY alias so nothing that still references it silently widens. Use
-- is_event_manager for manager rights and is_event_owner for owner-only actions.
create or replace function public.is_event_host(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_event_owner(p_event_id);
$$;

revoke execute on function public.is_event_owner(uuid) from public, anon;
revoke execute on function public.is_event_co_host(uuid) from public, anon;
revoke execute on function public.is_event_manager(uuid) from public, anon;
revoke execute on function public.is_event_host(uuid) from public, anon;
grant execute on function public.is_event_owner(uuid) to authenticated, service_role;
grant execute on function public.is_event_co_host(uuid) to authenticated, service_role;
grant execute on function public.is_event_manager(uuid) to authenticated, service_role;
grant execute on function public.is_event_host(uuid) to authenticated, service_role;

-- Null instead of an error for malformed input, so a bad storage path fails a policy check cleanly.
create or replace function public.try_uuid(p_text text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

revoke execute on function public.try_uuid(text) from public, anon;
grant execute on function public.try_uuid(text) to authenticated, service_role;

-- 4. Policies on existing tables -------------------------------------------------------------------

drop policy "events: host can read" on public.events;
drop policy "events: host can update" on public.events;

create policy "events: managers can read"
on public.events for select
to authenticated
using (host_id = (select auth.uid()) or public.is_event_co_host(id));

create policy "events: managers can update"
on public.events for update
to authenticated
using (host_id = (select auth.uid()) or public.is_event_co_host(id))
with check (host_id = (select auth.uid()) or public.is_event_co_host(id));
-- "events: host can create" and "events: host can delete" stay owner-only.

drop policy "invites: host can read" on public.event_invites;
drop policy "invites: host can create" on public.event_invites;
drop policy "invites: host can revoke" on public.event_invites;

create policy "invites: managers can read"
on public.event_invites for select
to authenticated
using (public.is_event_manager(event_id));

create policy "invites: managers can create"
on public.event_invites for insert
to authenticated
with check (public.is_event_manager(event_id));

create policy "invites: managers can revoke"
on public.event_invites for update
to authenticated
using (public.is_event_manager(event_id))
with check (public.is_event_manager(event_id));

drop policy "rsvps: host or self can read" on public.rsvps;
drop policy "rsvps: host or self can delete" on public.rsvps;

-- Realtime applies this per subscriber and per change: a removed co-host stops receiving rows.
create policy "rsvps: manager or self can read"
on public.rsvps for select
to authenticated
using (public.is_event_manager(event_id) or user_id = (select auth.uid()));

create policy "rsvps: manager or self can delete"
on public.rsvps for delete
to authenticated
using (public.is_event_manager(event_id) or user_id = (select auth.uid()));

-- Covers chosen in the edit screen belong to the event, not the uploader: covers/e/<event id>/<uuid>.
create policy "covers: managers can upload to event folder"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'covers'
  and (storage.foldername(name))[1] = 'e'
  and array_length(storage.foldername(name), 1) = 2
  and public.is_event_manager(public.try_uuid((storage.foldername(name))[2]))
);

-- New tables.
create policy "event_co_hosts: managers can read"
on public.event_co_hosts for select
to authenticated
using (public.is_event_manager(event_id));

create policy "event_co_hosts: owner removes, co-host leaves"
on public.event_co_hosts for delete
to authenticated
using (public.is_event_owner(event_id) or user_id = (select auth.uid()));

create policy "co_host_invites: owner can read"
on public.co_host_invites for select
to authenticated
using (public.is_event_owner(event_id));

-- 5. events_guard: owner-only cancel, cover path validation ----------------------------------------

create or replace function public.events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    if new.starts_at <= now() then
      raise exception 'start_in_past' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.host_id is distinct from old.host_id then
    raise exception 'host_immutable' using errcode = 'P0001';
  end if;
  -- Cancel / un-cancel is owner-only (co-hosts can edit everything else). Service role and
  -- maintenance jobs (no auth.uid()) are not restricted.
  if new.cancelled_at is distinct from old.cancelled_at and uid is not null and uid <> old.host_id then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  if public.event_ended_at(old) < now() then
    raise exception 'event_ended' using errcode = 'P0001';
  end if;
  -- A cover must be in the editor's own folder or the event's folder, so nobody can point the
  -- event at an arbitrary object.
  if new.cover_path is distinct from old.cover_path and new.cover_path is not null and uid is not null then
    if new.cover_path like '%..%'
       or not (starts_with(new.cover_path, uid::text || '/') or starts_with(new.cover_path, 'e/' || old.id::text || '/')) then
      raise exception 'invalid_cover' using errcode = 'P0001';
    end if;
  end if;
  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    if new.starts_at is distinct from old.starts_at and new.starts_at <= now() then
      raise exception 'start_in_past' using errcode = 'P0001';
    end if;
    new.time_changed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- 6. Guest invite link: managers may regenerate --------------------------------------------------

create or replace function public.regenerate_invite(p_event_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_token text;
begin
  if not public.is_event_manager(p_event_id) then
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

-- 7. Co-host invite links --------------------------------------------------------------------------

-- Pending = can still be accepted. Counts toward the limit together with existing co-hosts.
create or replace function public.co_host_slots_used(p_event_id uuid, p_now timestamptz default now())
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.event_co_hosts c where c.event_id = p_event_id)::int
       + (select count(*) from public.co_host_invites i
          where i.event_id = p_event_id and i.accepted_at is null and i.revoked_at is null
            and i.expires_at > p_now)::int;
$$;

revoke execute on function public.co_host_slots_used(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.create_co_host_invite(p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ev public.events;
  new_token text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Lock the event so concurrent creates can't both slip under the limit.
  select * into ev from public.events where id = p_event_id for update;
  if not found or (ev.host_id <> uid and not public.is_event_co_host(p_event_id)) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if ev.host_id <> uid then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  if ev.cancelled_at is not null or public.event_ended_at(ev) < now() then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  if public.co_host_slots_used(p_event_id) >= public.max_co_hosts() then
    raise exception 'co_host_limit' using errcode = 'P0001';
  end if;

  insert into public.co_host_invites (event_id) values (p_event_id) returning token into new_token;
  return new_token;
end;
$$;

revoke execute on function public.create_co_host_invite(uuid) from public, anon;
grant execute on function public.create_co_host_invite(uuid) to authenticated;

create or replace function public.revoke_co_host_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  inv public.co_host_invites;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into inv from public.co_host_invites where token = p_token for update;
  if not found or not public.is_event_owner(inv.event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.co_host_invites
  set revoked_at = now()
  where token = p_token and revoked_at is null and accepted_at is null;
end;
$$;

revoke execute on function public.revoke_co_host_invite(text) from public, anon;
grant execute on function public.revoke_co_host_invite(text) to authenticated;

-- Shared validity check. Unknown, expired, revoked, used, cancelled, ended and deleted all look the same.
create or replace function public.open_co_host_invite(p_token text, p_lock boolean default false)
returns public.co_host_invites
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  inv public.co_host_invites;
  ev public.events;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9]{22}$' then
    return null;
  end if;
  if p_lock then
    select * into inv from public.co_host_invites where token = p_token for update;
  else
    select * into inv from public.co_host_invites where token = p_token;
  end if;
  if not found or inv.revoked_at is not null or inv.accepted_at is not null or inv.expires_at <= now() then
    return null;
  end if;
  if p_lock then
    select * into ev from public.events where id = inv.event_id for update;
  else
    select * into ev from public.events where id = inv.event_id;
  end if;
  if not found or ev.cancelled_at is not null or public.event_ended_at(ev) < now() then
    return null;
  end if;
  return inv;
end;
$$;

revoke execute on function public.open_co_host_invite(text, boolean) from public, anon, authenticated;

-- What the accept screen shows. Signed-in users only.
create or replace function public.get_co_host_invite(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  inv public.co_host_invites;
  ev public.events;
  owner_name text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  inv := public.open_co_host_invite(p_token);
  if inv.token is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into ev from public.events where id = inv.event_id;
  select p.display_name into owner_name from public.profiles p where p.id = ev.host_id;

  if ev.host_id = uid then
    return jsonb_build_object('state', 'owner', 'event', jsonb_build_object('id', ev.id, 'title', ev.title),
                              'owner', jsonb_build_object('display_name', owner_name));
  end if;
  if exists (select 1 from public.event_co_hosts c where c.event_id = ev.id and c.user_id = uid) then
    return jsonb_build_object('state', 'already_co_host', 'event', jsonb_build_object('id', ev.id, 'title', ev.title),
                              'owner', jsonb_build_object('display_name', owner_name));
  end if;
  return jsonb_build_object('state', 'valid', 'event', jsonb_build_object('title', ev.title),
                            'owner', jsonb_build_object('display_name', owner_name));
end;
$$;

revoke execute on function public.get_co_host_invite(text) from public, anon;
grant execute on function public.get_co_host_invite(text) to authenticated;

-- Accept: returns the event id. The owner and existing co-hosts don't consume the link.
create or replace function public.accept_co_host_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  inv public.co_host_invites;
  ev public.events;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = uid and btrim(coalesce(display_name, '')) <> '') then
    raise exception 'name_required' using errcode = 'P0001';
  end if;

  inv := public.open_co_host_invite(p_token, true);
  if inv.token is null then
    raise exception 'invalid_invite' using errcode = 'P0001';
  end if;
  select * into ev from public.events where id = inv.event_id;

  if ev.host_id = uid then
    raise exception 'already_host' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.event_co_hosts c where c.event_id = ev.id and c.user_id = uid) then
    return ev.id;
  end if;
  if (select count(*) from public.event_co_hosts c where c.event_id = ev.id) >= public.max_co_hosts() then
    raise exception 'co_host_limit' using errcode = 'P0001';
  end if;

  insert into public.event_co_hosts (event_id, user_id) values (ev.id, uid);
  update public.co_host_invites set accepted_by = uid, accepted_at = now() where token = inv.token;
  return ev.id;
end;
$$;

revoke execute on function public.accept_co_host_invite(text) from public, anon;
grant execute on function public.accept_co_host_invite(text) to authenticated;

-- 8. Membership ---------------------------------------------------------------------------------------

create or replace function public.leave_event(p_event_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted int;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  delete from public.event_co_hosts where event_id = p_event_id and user_id = (select auth.uid());
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

revoke execute on function public.leave_event(uuid) from public, anon;
grant execute on function public.leave_event(uuid) to authenticated;

create or replace function public.remove_co_host(p_event_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted int;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_event_owner(p_event_id) then
    if public.is_event_co_host(p_event_id) then
      raise exception 'owner_only' using errcode = 'P0001';
    end if;
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  delete from public.event_co_hosts where event_id = p_event_id and user_id = p_user_id;
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

revoke execute on function public.remove_co_host(uuid, uuid) from public, anon;
grant execute on function public.remove_co_host(uuid, uuid) to authenticated;

-- Owner first, then co-hosts in join order. Managers only (others get no rows).
create or replace function public.list_event_hosts(p_event_id uuid)
returns table (user_id uuid, display_name text, avatar_path text, role text, added_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select h.user_id, h.display_name, h.avatar_path, h.role, h.added_at
  from (
    select e.host_id as user_id, p.display_name, p.avatar_path, 'owner'::text as role, e.created_at as added_at, 0 as ord
    from public.events e
    join public.profiles p on p.id = e.host_id
    where e.id = p_event_id
    union all
    select c.user_id, p.display_name, p.avatar_path, 'co_host', c.added_at, 1
    from public.event_co_hosts c
    join public.profiles p on p.id = c.user_id
    where c.event_id = p_event_id
  ) h
  where public.is_event_manager(p_event_id)
  order by h.ord, h.added_at, h.user_id;
$$;

revoke execute on function public.list_event_hosts(uuid) from public, anon;
grant execute on function public.list_event_hosts(uuid) to authenticated;

-- 9. Web landing page for co-host links (service role only): title + owner name, nothing else.
create or replace function public.get_co_host_invite_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  inv public.co_host_invites;
  ev public.events;
  owner_name text;
begin
  inv := public.open_co_host_invite(p_token);
  if inv.token is null then
    return jsonb_build_object('state', 'invalid');
  end if;
  select * into ev from public.events where id = inv.event_id;
  select p.display_name into owner_name from public.profiles p where p.id = ev.host_id;
  return jsonb_build_object('state', 'valid', 'event', jsonb_build_object('title', ev.title),
                            'owner', jsonb_build_object('display_name', owner_name));
end;
$$;

revoke execute on function public.get_co_host_invite_preview(text) from public, anon, authenticated;
grant execute on function public.get_co_host_invite_preview(text) to service_role;

-- 10. Invite payload: co-host names (only names, in join order). Otherwise unchanged from add-my-invites.
create or replace function public.invite_payload(
  ev public.events,
  me public.rsvps,
  p_guest_device boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  host public.profiles;
  sub public.rsvp_email_subscriptions;
begin
  select * into host from public.profiles where id = ev.host_id;
  if p_guest_device and me.id is not null then
    select * into sub from public.rsvp_email_subscriptions s where s.rsvp_id = me.id;
  end if;

  return jsonb_build_object(
    'state', case when public.event_ended_at(ev) < now() then 'past' else 'active' end,
    'event', jsonb_build_object(
      'title', ev.title,
      'description', ev.description,
      'starts_at', ev.starts_at,
      'ends_at', ev.ends_at,
      'time_zone', ev.time_zone,
      'location_text', ev.location_text,
      'place_name', ev.place_name,
      'latitude', ev.latitude,
      'longitude', ev.longitude,
      'cover_path', ev.cover_path,
      'theme', ev.theme,
      'time_changed_at', ev.time_changed_at,
      'guest_list_visible', ev.guest_list_visible
    ),
    'host', jsonb_build_object('display_name', host.display_name, 'avatar_path', host.avatar_path),
    'co_hosts', (
      select coalesce(jsonb_agg(jsonb_build_object('display_name', p.display_name)
                                order by c.added_at, c.user_id), '[]'::jsonb)
      from public.event_co_hosts c
      join public.profiles p on p.id = c.user_id
      where c.event_id = ev.id and btrim(coalesce(p.display_name, '')) <> ''
    ),
    'counts', (
      select jsonb_build_object(
        'going', count(*) filter (where r.status = 'going'),
        'maybe', count(*) filter (where r.status = 'maybe')
      )
      from public.rsvps r where r.event_id = ev.id
    ),
    -- Guests see names only for going/maybe, and only if the host allows it.
    'guests', case when ev.guest_list_visible then (
      select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'status', r.status)
                                order by r.status, r.created_at), '[]'::jsonb)
      from public.rsvps r
      where r.event_id = ev.id and r.status in ('going', 'maybe')
    ) end,
    'my_rsvp', case when me.id is not null then
      jsonb_build_object('status', me.status, 'display_name', me.display_name)
      || case when p_guest_device then jsonb_build_object('email_updates', jsonb_build_object(
           'state', case when sub.rsvp_id is not null then 'on' else 'off' end,
           'masked', case when sub.rsvp_id is not null then public.mask_email(sub.email) end
         )) else '{}'::jsonb end
    end,
    'announcements', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'body', a.body, 'created_at', a.created_at)
                                order by a.created_at desc), '[]'::jsonb)
      from (
        select * from public.event_announcements x
        where x.event_id = ev.id and x.deleted_at is null
        order by x.created_at desc
        limit 50
      ) a
    )
  );
end;
$$;

revoke execute on function public.invite_payload(public.events, public.rsvps, boolean) from public, anon, authenticated;

-- 11. Retention: every earlier cleanup line is kept; co-host links go 30 days after they stopped
-- being usable (expired, revoked or accepted).
create or replace function public.run_retention(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rsvp_rate_limits where window_start < p_now - interval '24 hours';
  delete from public.events e where public.event_ended_at(e) < p_now - interval '12 months';

  -- Guest emails: no later than 2 days after the event ended or was cancelled.
  delete from public.rsvp_email_subscriptions s
  using public.events e
  where e.id = s.event_id
    and (public.event_ended_at(e) < p_now - interval '2 days' or e.cancelled_at < p_now - interval '2 days');

  -- Notification records (deliveries cascade) 30 days after processing.
  delete from public.notifications
  where state <> 'pending' and processed_at < p_now - interval '30 days';

  -- Devices that haven't opened the app for 180 days.
  delete from public.push_tokens where last_seen_at < p_now - interval '180 days';

  -- Deleted announcements are kept 24h only (for the 5-per-24h limit).
  delete from public.event_announcements where deleted_at < p_now - interval '24 hours';

  -- Claim tickets: used or expired.
  delete from public.rsvp_claim_tickets where used_at is not null or expires_at <= p_now;

  -- Co-host invite links: 30 days after expiry, revocation or use.
  delete from public.co_host_invites
  where expires_at < p_now - interval '30 days'
     or revoked_at < p_now - interval '30 days'
     or accepted_at < p_now - interval '30 days';
end;
$$;

revoke execute on function public.run_retention(timestamptz) from public, anon, authenticated;
