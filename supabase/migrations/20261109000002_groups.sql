-- Groups (change: add-groups-and-recurring-events, design D7). Named groups of app users with an owner and
-- admins, joined by link or by accepting an invitation. Every write goes through the security-definer RPCs
-- below; tables are readable through RLS by members only.

-- 1. Tables ---------------------------------------------------------------------------------------------

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  -- No cascade: an owner's account deletion hands the group over first (pass_on_owned_groups).
  owner_id uuid not null references public.profiles (id),
  name text not null check (char_length(btrim(name)) between 1 and 50),
  created_at timestamptz not null default now()
);

create index groups_owner_idx on public.groups (owner_id);

create table public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The owner's rights come from groups.owner_id, never from this flag.
  is_admin boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create index group_members_user_idx on public.group_members (user_id);

create table public.group_invitations (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days',
  -- A declined row is kept until 30 days after creation so re-inviting is silently suppressed.
  declined_at timestamptz,
  primary key (group_id, user_id)
);

create index group_invitations_user_idx on public.group_invitations (user_id);

create table public.group_invite_links (
  token text primary key default public.generate_random_token(22) check (token ~ '^[A-Za-z0-9]{22}$'),
  group_id uuid not null references public.groups (id) on delete cascade,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index group_invite_links_one_active_idx on public.group_invite_links (group_id) where revoked_at is null;

create or replace function public.max_group_members() returns int language sql immutable set search_path = '' as $$ select 50 $$;
create or replace function public.max_owned_groups() returns int language sql immutable set search_path = '' as $$ select 20 $$;

-- The owner stays a member for as long as they own the group (hand over first, then leave).
create or replace function public.group_members_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.groups g where g.id = old.group_id and g.owner_id = old.user_id) then
    raise exception 'owner_must_hand_over' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

revoke execute on function public.group_members_guard() from public, anon, authenticated;

create trigger group_members_guard
before delete on public.group_members
for each row execute function public.group_members_guard();

-- 2. Helpers ---------------------------------------------------------------------------------------------

create or replace function public.is_group_member(p_group_id uuid, p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.user_id = coalesce(p_user_id, (select auth.uid()))
  );
$$;

-- Owner or a member with is_admin.
create or replace function public.is_group_admin(p_group_id uuid, p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group_id and g.owner_id = coalesce(p_user_id, (select auth.uid()))
  ) or exists (
    select 1 from public.group_members m
    where m.group_id = p_group_id and m.user_id = coalesce(p_user_id, (select auth.uid())) and m.is_admin
  );
$$;

-- Members plus invitations that can still be accepted (they hold a seat).
create or replace function public.group_seats_used(p_group_id uuid, p_now timestamptz default now())
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*)::int from public.group_members where group_id = p_group_id)
       + (select count(*)::int from public.group_invitations
          where group_id = p_group_id and declined_at is null and expires_at > p_now);
$$;

revoke execute on function public.is_group_member(uuid, uuid) from public, anon;
revoke execute on function public.is_group_admin(uuid, uuid) from public, anon;
revoke execute on function public.group_seats_used(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.is_group_member(uuid, uuid) to authenticated, service_role;
grant execute on function public.is_group_admin(uuid, uuid) to authenticated, service_role;

-- 3. RLS (reads only; writes go through the RPCs) ---------------------------------------------------------

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.group_invite_links enable row level security;

revoke all on public.groups, public.group_members, public.group_invitations, public.group_invite_links from anon;
revoke insert, update, delete on public.groups, public.group_members, public.group_invitations, public.group_invite_links
  from authenticated;

create policy "groups: members read" on public.groups for select to authenticated
using (public.is_group_member(id));

create policy "group_members: members read" on public.group_members for select to authenticated
using (public.is_group_member(group_id));

create policy "group_invitations: invitee and admins read" on public.group_invitations for select to authenticated
using (user_id = (select auth.uid()) or public.is_group_admin(group_id));

create policy "group_invite_links: admins read" on public.group_invite_links for select to authenticated
using (public.is_group_admin(group_id));

-- 4. Notification kinds (templates: packages/shared/src/notifications) -------------------------------------

insert into public.notification_kinds (kind, urgent, channels, stale_after_start) values
  ('group_invited', false, array['push'], false),
  ('group_joined', false, array['push'], false),
  ('group_new_owner', false, array['push'], false);

-- 5. RPCs ----------------------------------------------------------------------------------------------

create or replace function public.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return uid;
end;
$$;

-- Locks the group and checks the caller's role. Non-members get the same not_found as a missing group.
create or replace function public.lock_group_for(p_group_id uuid, p_role text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  g public.groups;
begin
  select * into g from public.groups where id = p_group_id for update;
  if not found or not public.is_group_member(p_group_id, uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p_role = 'admin' and not public.is_group_admin(p_group_id, uid) then
    raise exception 'not_group_admin' using errcode = 'P0001';
  end if;
  if p_role = 'owner' and g.owner_id <> uid then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  return g;
end;
$$;

revoke execute on function public.require_uid() from public, anon;
revoke execute on function public.lock_group_for(uuid, text) from public, anon, authenticated;

create or replace function public.clean_group_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  n text := btrim(coalesce(p_name, ''));
begin
  if char_length(n) < 1 or char_length(n) > 50 then
    raise exception 'invalid_name' using errcode = '22023';
  end if;
  return n;
end;
$$;

create or replace function public.create_group(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  n text := public.clean_group_name(p_name);
  new_id uuid;
begin
  if not public.hit_rate_limit('group_create:' || uid, 20, 86400) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  -- Serialise this user's creates so two at once can't both slip under the limit.
  perform 1 from public.profiles where id = uid for update;
  if (select count(*) from public.groups where owner_id = uid) >= public.max_owned_groups() then
    raise exception 'group_limit' using errcode = 'P0001';
  end if;
  insert into public.groups (owner_id, name) values (uid, n) returning id into new_id;
  insert into public.group_members (group_id, user_id) values (new_id, uid);
  return new_id;
end;
$$;

create or replace function public.rename_group(p_group_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  n text := public.clean_group_name(p_name);
begin
  perform public.lock_group_for(p_group_id, 'admin');
  update public.groups set name = n where id = p_group_id;
end;
$$;

create or replace function public.delete_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_group_for(p_group_id, 'owner');
  perform public.end_group_series(p_group_id);
  delete from public.groups where id = p_group_id;
end;
$$;

-- Placeholder until the series migration redefines it: a group has no series yet.
create or replace function public.end_group_series(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

revoke execute on function public.end_group_series(uuid) from public, anon, authenticated;

-- Owner and admins promote; only the owner demotes. Nobody targets the owner.
create or replace function public.set_group_admin(p_group_id uuid, p_user_id uuid, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  g public.groups := public.lock_group_for(p_group_id, 'admin');
  m public.group_members;
begin
  if p_user_id = g.owner_id then
    raise exception 'owner_target' using errcode = 'P0001';
  end if;
  select * into m from public.group_members where group_id = p_group_id and user_id = p_user_id for update;
  if not found then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  if not coalesce(p_admin, false) and m.is_admin and g.owner_id <> uid then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  update public.group_members set is_admin = coalesce(p_admin, false)
  where group_id = p_group_id and user_id = p_user_id;
end;
$$;

-- Role of a user in a group: owner | admin | member | null.
create or replace function public.group_role(g public.groups, p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when g.owner_id = p_user_id then 'owner'
    when m.is_admin then 'admin'
    when m.user_id is not null then 'member'
  end
  from (select 1) x
  left join public.group_members m on m.group_id = g.id and m.user_id = p_user_id;
$$;

revoke execute on function public.group_role(public.groups, uuid) from public, anon, authenticated;

create or replace function public.get_group(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  g public.groups;
  role text;
begin
  select * into g from public.groups where id = p_group_id;
  if not found or not public.is_group_member(p_group_id, uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  role := public.group_role(g, uid);
  return jsonb_build_object(
    'id', g.id,
    'name', g.name,
    'owner_id', g.owner_id,
    'owner_name', (select display_name from public.profiles where id = g.owner_id),
    'my_role', role,
    'members', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'display_name', p.display_name,
        'role', case when m.user_id = g.owner_id then 'owner' when m.is_admin then 'admin' else 'member' end,
        'joined_at', m.joined_at
      ) order by (m.user_id = g.owner_id) desc, m.is_admin desc, m.joined_at), '[]'::jsonb)
      from public.group_members m join public.profiles p on p.id = m.user_id
      where m.group_id = g.id
    ),
    'link', case when role in ('owner', 'admin') then (
      select l.token from public.group_invite_links l where l.group_id = g.id and l.revoked_at is null
    ) end,
    'pending_invitations', case when role in ('owner', 'admin') then (
      select count(*) from public.group_invitations i
      where i.group_id = g.id and i.declined_at is null and i.expires_at > now()
    ) end
  );
end;
$$;

create or replace function public.list_my_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
begin
  return jsonb_build_object(
    'groups', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'role', public.group_role(g, uid),
        'member_count', (select count(*) from public.group_members c where c.group_id = g.id)
      ) order by (g.owner_id = uid) desc, g.name), '[]'::jsonb)
      from public.groups g join public.group_members m on m.group_id = g.id and m.user_id = uid
    ),
    'invitations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'group_id', g.id,
        'name', g.name,
        'owner_name', (select display_name from public.profiles where id = g.owner_id),
        'invited_by_name', (select display_name from public.profiles where id = i.invited_by),
        'member_count', (select count(*) from public.group_members c where c.group_id = g.id),
        'created_at', i.created_at
      ) order by i.created_at desc), '[]'::jsonb)
      from public.group_invitations i join public.groups g on g.id = i.group_id
      where i.user_id = uid and i.declined_at is null and i.expires_at > now()
        and not exists (select 1 from public.group_members m where m.group_id = g.id and m.user_id = uid)
    )
  );
end;
$$;

-- One active link per group; asking again returns the active one.
create or replace function public.create_group_link(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  tok text;
begin
  perform public.lock_group_for(p_group_id, 'admin');
  select token into tok from public.group_invite_links where group_id = p_group_id and revoked_at is null;
  if tok is null then
    insert into public.group_invite_links (group_id, created_by) values (p_group_id, uid) returning token into tok;
  end if;
  return tok;
end;
$$;

create or replace function public.revoke_group_link(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_group_for(p_group_id, 'admin');
  update public.group_invite_links set revoked_at = now() where group_id = p_group_id and revoked_at is null;
end;
$$;

-- What a group link shows before joining: name, owner name, member count. Unknown and revoked tokens give
-- the same 'invalid'. Callable signed out (web page), so it never reveals members.
create or replace function public.get_group_link_preview(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  g public.groups;
  uid uuid := (select auth.uid());
begin
  select gr.* into g
  from public.group_invite_links l join public.groups gr on gr.id = l.group_id
  where l.token = p_token and l.revoked_at is null;
  if not found then
    return jsonb_build_object('state', 'invalid');
  end if;
  return jsonb_build_object(
    'state', 'valid',
    'group_id', case when uid is not null and public.is_group_member(g.id, uid) then g.id end,
    'name', g.name,
    'owner_name', (select display_name from public.profiles where id = g.owner_id),
    'member_count', (select count(*) from public.group_members where group_id = g.id),
    'is_member', uid is not null and public.is_group_member(g.id, uid)
  );
end;
$$;

-- Adds a member and tells the owner (batched: joins within 15 minutes give one push).
create or replace function public.add_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
begin
  select * into g from public.groups where id = p_group_id;
  insert into public.group_members (group_id, user_id) values (p_group_id, p_user_id) on conflict do nothing;
  delete from public.group_invitations where group_id = p_group_id and user_id = p_user_id;
  if p_user_id <> g.owner_id then
    perform public.enqueue_notification(
      p_kind => 'group_joined', p_event_id => null, p_audience => 'user',
      p_target_user_id => g.owner_id,
      p_payload => jsonb_build_object('group_id', g.id, 'user_ids', jsonb_build_array(p_user_id)),
      p_not_before => now() + interval '15 minutes',
      p_coalesce_key => 'group_joined:' || g.id || ':' || g.owner_id);
  end if;
end;
$$;

revoke execute on function public.add_group_member(uuid, uuid) from public, anon, authenticated;

create or replace function public.join_group_by_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  gid uuid;
begin
  if not public.hit_rate_limit('group_join:' || uid, 30, 3600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  select l.group_id into gid from public.group_invite_links l where l.token = p_token and l.revoked_at is null;
  if gid is null then
    raise exception 'invalid' using errcode = 'P0001';
  end if;
  perform 1 from public.groups where id = gid for update;
  if public.is_group_member(gid, uid) then
    return gid;
  end if;
  if (select display_name from public.profiles where id = uid) is null then
    raise exception 'display_name_required' using errcode = 'P0001';
  end if;
  -- A pending invitation for this user already holds a seat.
  if public.group_seats_used(gid) - (
       select count(*)::int from public.group_invitations
       where group_id = gid and user_id = uid and declined_at is null and expires_at > now()
     ) >= public.max_group_members() then
    raise exception 'group_full' using errcode = 'P0001';
  end if;
  perform public.add_group_member(gid, uid);
  return gid;
end;
$$;

-- Account-linked guests of events the caller owns or co-hosts, minus members and pending invitations.
-- A recent decline is NOT excluded: the inviter must not learn who declined.
create or replace function public.invitable_past_guests(p_group_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
begin
  if not public.is_group_member(p_group_id, uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.is_group_admin(p_group_id, uid) then
    raise exception 'not_group_admin' using errcode = 'P0001';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('user_id', x.user_id, 'display_name', x.display_name)
                              order by lower(x.display_name)), '[]'::jsonb)
    from (
      select distinct r.user_id, p.display_name
      from public.rsvps r
      join public.events e on e.id = r.event_id
      join public.profiles p on p.id = r.user_id
      where r.user_id is not null and r.user_id <> uid and p.display_name is not null
        and (e.host_id = uid or exists (
          select 1 from public.event_co_hosts c where c.event_id = e.id and c.user_id = uid))
        and not exists (select 1 from public.group_members m where m.group_id = p_group_id and m.user_id = r.user_id)
        and not exists (
          select 1 from public.group_invitations i
          where i.group_id = p_group_id and i.user_id = r.user_id and i.declined_at is null and i.expires_at > now())
    ) x
  );
end;
$$;

-- Returns how many people the caller is told were invited (silently suppressed ones included).
create or replace function public.invite_to_group(p_group_id uuid, p_user_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  g public.groups := public.lock_group_for(p_group_id, 'admin');
  allowed uuid[];
  target uuid;
  inv public.group_invitations;
  new_count int;
  told int := 0;
begin
  select coalesce(array_agg((x ->> 'user_id')::uuid), '{}') into allowed
  from jsonb_array_elements(public.invitable_past_guests(p_group_id)) x;

  -- Only people the caller could pick; members and already-pending people are no-ops.
  select count(*) into new_count
  from (select distinct unnest(coalesce(p_user_ids, '{}')) as u) t
  where t.u = any (allowed)
    and not exists (
      select 1 from public.group_invitations i
      where i.group_id = p_group_id and i.user_id = t.u and i.declined_at is not null
        and i.created_at > now() - interval '30 days');
  if public.group_seats_used(p_group_id) + new_count > public.max_group_members() then
    raise exception 'group_full' using errcode = 'P0001';
  end if;

  for target in select distinct unnest(coalesce(p_user_ids, '{}')) loop
    if not (target = any (allowed)) then
      -- Already a member or already invited: nothing to do.
      if public.is_group_member(p_group_id, target) or exists (
           select 1 from public.group_invitations i
           where i.group_id = p_group_id and i.user_id = target and i.declined_at is null and i.expires_at > now()) then
        continue;
      end if;
      raise exception 'not_invitable' using errcode = 'P0001';
    end if;
    if not public.hit_rate_limit('group_invite:' || uid, 100, 86400) then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    told := told + 1;
    select * into inv from public.group_invitations where group_id = p_group_id and user_id = target;
    if found and inv.declined_at is not null and inv.created_at > now() - interval '30 days' then
      continue; -- Declined recently: say nothing, send nothing.
    end if;
    insert into public.group_invitations (group_id, user_id, invited_by)
    values (p_group_id, target, uid)
    on conflict (group_id, user_id) do update
      set invited_by = excluded.invited_by, created_at = now(), expires_at = now() + interval '30 days',
          declined_at = null;
    perform public.enqueue_notification(
      p_kind => 'group_invited', p_event_id => null, p_audience => 'user', p_target_user_id => target,
      p_payload => jsonb_build_object('group_id', p_group_id, 'actor_id', uid));
  end loop;
  return told;
end;
$$;

create or replace function public.respond_group_invitation(p_group_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  inv public.group_invitations;
begin
  perform 1 from public.groups where id = p_group_id for update;
  select * into inv from public.group_invitations
  where group_id = p_group_id and user_id = uid and declined_at is null and expires_at > now()
  for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if coalesce(p_accept, false) then
    if (select display_name from public.profiles where id = uid) is null then
      raise exception 'display_name_required' using errcode = 'P0001';
    end if;
    perform public.add_group_member(p_group_id, uid);
  else
    update public.group_invitations set declined_at = now() where group_id = p_group_id and user_id = uid;
  end if;
end;
$$;

create or replace function public.leave_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  g public.groups := public.lock_group_for(p_group_id, 'member');
begin
  if g.owner_id = uid then
    raise exception 'owner_must_hand_over' using errcode = 'P0001';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = uid;
end;
$$;

-- Owner removes anyone but themself; admins remove regular members only.
create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  g public.groups := public.lock_group_for(p_group_id, 'admin');
  m public.group_members;
begin
  if p_user_id = g.owner_id then
    raise exception 'owner_target' using errcode = 'P0001';
  end if;
  select * into m from public.group_members where group_id = p_group_id and user_id = p_user_id;
  if not found then
    return;
  end if;
  if m.is_admin and g.owner_id <> uid then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
end;
$$;

-- Moves ownership (and, once series exist, every date of the group's series) to a member. The previous
-- owner stays a regular member here; callers decide whether they leave.
create or replace function public.transfer_group_ownership(p_group_id uuid, p_new_owner uuid, p_enforce_limit boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.groups;
begin
  select * into g from public.groups where id = p_group_id for update;
  if not exists (select 1 from public.group_members where group_id = p_group_id and user_id = p_new_owner)
     or p_new_owner = g.owner_id then
    raise exception 'not_member' using errcode = 'P0001';
  end if;
  if p_enforce_limit and (select count(*) from public.groups where owner_id = p_new_owner) >= public.max_owned_groups() then
    raise exception 'group_limit' using errcode = 'P0001';
  end if;
  update public.groups set owner_id = p_new_owner where id = p_group_id;
  update public.group_members set is_admin = false where group_id = p_group_id and user_id = p_new_owner;
  perform public.move_group_series_owner(p_group_id, p_new_owner);
  perform public.enqueue_notification(
    p_kind => 'group_new_owner', p_event_id => null, p_audience => 'user', p_target_user_id => p_new_owner,
    p_payload => jsonb_build_object('group_id', p_group_id));
end;
$$;

-- Placeholder until the series migration redefines it.
create or replace function public.move_group_series_owner(p_group_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  return;
end;
$$;

revoke execute on function public.transfer_group_ownership(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.move_group_series_owner(uuid, uuid) from public, anon, authenticated;

create or replace function public.hand_over_and_leave_group(p_group_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
begin
  perform public.lock_group_for(p_group_id, 'owner');
  perform public.transfer_group_ownership(p_group_id, p_new_owner, true);
  delete from public.group_members where group_id = p_group_id and user_id = uid;
end;
$$;

-- Who takes over when the owner goes without choosing: longest-standing admin, else longest-standing member.
create or replace function public.group_successor(p_group_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.user_id
  from public.group_members m join public.groups g on g.id = m.group_id
  where m.group_id = p_group_id and m.user_id <> g.owner_id
  order by m.is_admin desc, m.joined_at, m.user_id
  limit 1;
$$;

-- Account deletion: every group the user owns passes to its successor (the 20-group limit is skipped so
-- erasure never fails), or is deleted when nobody else is in it. Called by the delete-account function
-- before it removes storage, and again by the profiles trigger as a safety net.
create or replace function public.pass_on_owned_groups(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  gid uuid;
  heir uuid;
begin
  for gid in select id from public.groups where owner_id = p_user_id for update loop
    heir := public.group_successor(gid);
    if heir is null then
      perform public.end_group_series(gid);
      delete from public.groups where id = gid;
    else
      perform public.transfer_group_ownership(gid, heir, false);
    end if;
  end loop;
end;
$$;

create or replace function public.profiles_pass_on_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.pass_on_owned_groups(old.id);
  return old;
end;
$$;

revoke execute on function public.group_successor(uuid) from public, anon, authenticated;
revoke execute on function public.pass_on_owned_groups(uuid) from public, anon, authenticated;
grant execute on function public.pass_on_owned_groups(uuid) to service_role;
revoke execute on function public.profiles_pass_on_groups() from public, anon, authenticated;

create trigger profiles_pass_on_groups
before delete on public.profiles
for each row execute function public.profiles_pass_on_groups();

-- 6. Grants for the app-facing RPCs ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_group(text)',
    'public.rename_group(uuid, text)',
    'public.delete_group(uuid)',
    'public.set_group_admin(uuid, uuid, boolean)',
    'public.get_group(uuid)',
    'public.list_my_groups()',
    'public.create_group_link(uuid)',
    'public.revoke_group_link(uuid)',
    'public.join_group_by_link(text)',
    'public.invitable_past_guests(uuid)',
    'public.invite_to_group(uuid, uuid[])',
    'public.respond_group_invitation(uuid, boolean)',
    'public.leave_group(uuid)',
    'public.remove_group_member(uuid, uuid)',
    'public.hand_over_and_leave_group(uuid, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke execute on function public.get_group_link_preview(text) from public;
grant execute on function public.get_group_link_preview(text) to anon, authenticated;
revoke execute on function public.clean_group_name(text) from public, anon;

-- 7. Retention: every earlier line is kept (add-event-wall version); group invitations and revoked links added.
create or replace function public.run_retention(p_now timestamptz default now())
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
begin
  delete from public.rsvp_rate_limits where window_start < p_now - interval '24 hours';
  -- Wall posts, photos, uploads and blocks cascade with the event; the photo triggers queue the files.
  delete from public.events e where public.event_ended_at(e) < p_now - interval '12 months';

  -- Date polls never picked (add-date-polls).
  delete from public.events e
  where e.starts_at is null
    and coalesce((select max(d.starts_at) from public.date_poll_options d where d.event_id = e.id), e.created_at)
        < p_now - interval '12 months';

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

  -- Groups (add-groups-and-recurring-events): invitations 30 days after creation (accepted ones are gone
  -- already; declined ones are kept that long so re-inviting stays silent), revoked links after 30 days.
  delete from public.group_invitations where created_at < p_now - interval '30 days';
  delete from public.group_invite_links where revoked_at < p_now - interval '30 days';

  -- Event wall (add-event-wall): staged uploads never posted. 22 h (not 24 h) so that with the hourly job
  -- plus the 10-minute storage cleanup the files are gone within 24 hours of the upload (spec: "Safe photo
  -- upload from the web"). The delete trigger queues their objects; orphaned objects are queued too.
  delete from public.wall_uploads where created_at < p_now - interval '22 hours';
  perform public.wall_enqueue_orphans(p_now);

  -- Waitlist safety sweep (add-guest-capacity), events in id order.
  for eid in
    select distinct r.event_id from public.rsvps r
    join public.events e on e.id = r.event_id
    where r.status = 'waitlisted' and e.cancelled_at is null and public.event_ended_at(e) >= p_now
    order by r.event_id
  loop
    perform public.promote_from_waitlist(eid);
  end loop;
end;
$$;
