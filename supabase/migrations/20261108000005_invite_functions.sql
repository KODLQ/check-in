-- Guest-facing API. Guests never touch tables directly; everything goes through
-- these functions, keyed by the invite token. Unknown, revoked and deleted
-- invites all return the exact same {"state":"not_found"} payload.

create or replace function public.hash_guest_token(p_guest_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_guest_token, 'sha256'), 'hex');
$$;

create or replace function public.get_invite(p_token text, p_guest_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
  host public.profiles;
  st text;
  guest_hash text;
  me public.rsvps;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9]{12}$' then
    return jsonb_build_object('state', 'not_found');
  end if;

  select e.* into ev
  from public.event_invites i
  join public.events e on e.id = i.event_id
  where i.token = p_token and i.revoked_at is null;

  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;

  if ev.cancelled_at is not null then
    return jsonb_build_object('state', 'cancelled', 'event', jsonb_build_object('title', ev.title));
  end if;

  st := case when public.event_ended_at(ev) < now() then 'past' else 'active' end;

  select * into host from public.profiles where id = ev.host_id;

  if (select auth.uid()) is not null then
    select * into me from public.rsvps r where r.event_id = ev.id and r.user_id = (select auth.uid());
  elsif p_guest_token is not null then
    guest_hash := public.hash_guest_token(p_guest_token);
    select * into me from public.rsvps r where r.event_id = ev.id and r.guest_token_hash = guest_hash;
  end if;

  return jsonb_build_object(
    'state', st,
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
    end
  );
end;
$$;

revoke execute on function public.get_invite(text, text) from public;
grant execute on function public.get_invite(text, text) to anon, authenticated, service_role;

-- Resolves an active, open event for an invite token or raises.
create or replace function public.open_event_for_token(p_token text)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  select e.* into ev
  from public.event_invites i
  join public.events e on e.id = i.event_id
  where i.token = p_token and i.revoked_at is null;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if ev.cancelled_at is not null or public.event_ended_at(ev) < now() then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  return ev;
end;
$$;

revoke execute on function public.open_event_for_token(text) from public, anon, authenticated;

-- Max responses per event, to stop guest-list flooding.
create or replace function public.max_rsvps_per_event()
returns int language sql immutable set search_path = '' as $$ select 500 $$;

-- Anonymous guest RSVP. Called only by the web server (service role), which
-- applies per-IP rate limiting before calling.
create or replace function public.upsert_rsvp(
  p_token text,
  p_guest_token text,
  p_display_name text,
  p_status public.rsvp_status
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  guest_hash text;
  name text := btrim(coalesce(p_display_name, ''));
  existing uuid;
begin
  if char_length(name) = 0 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if p_guest_token is null or char_length(p_guest_token) < 22 then
    raise exception 'invalid_guest_token' using errcode = 'P0001';
  end if;

  ev := public.open_event_for_token(p_token);
  guest_hash := public.hash_guest_token(p_guest_token);

  select id into existing from public.rsvps
  where event_id = ev.id and guest_token_hash = guest_hash;

  if existing is null
     and (select count(*) from public.rsvps where event_id = ev.id) >= public.max_rsvps_per_event() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.rsvps (event_id, guest_token_hash, display_name, status)
  values (ev.id, guest_hash, left(name, 50), p_status)
  on conflict (event_id, guest_token_hash)
  do update set display_name = excluded.display_name, status = excluded.status;

  return jsonb_build_object('status', p_status, 'display_name', left(name, 50));
end;
$$;

revoke execute on function public.upsert_rsvp(text, text, text, public.rsvp_status) from public, anon, authenticated;
grant execute on function public.upsert_rsvp(text, text, text, public.rsvp_status) to service_role;

create or replace function public.withdraw_rsvp(p_token text, p_guest_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted int;
begin
  delete from public.rsvps r
  using public.event_invites i
  where i.token = p_token
    and i.revoked_at is null
    and r.event_id = i.event_id
    and r.guest_token_hash = public.hash_guest_token(p_guest_token);
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

revoke execute on function public.withdraw_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.withdraw_rsvp(text, text) to service_role;

-- RSVP by a signed-in user (from the app). Uses their profile name.
create or replace function public.rsvp_as_user(p_token text, p_status public.rsvp_status)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  uid uuid := (select auth.uid());
  name text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select display_name into name from public.profiles where id = uid;
  if name is null then
    raise exception 'name_required' using errcode = 'P0001';
  end if;

  ev := public.open_event_for_token(p_token);

  if not exists (select 1 from public.rsvps where event_id = ev.id and user_id = uid)
     and (select count(*) from public.rsvps where event_id = ev.id) >= public.max_rsvps_per_event() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.rsvps (event_id, user_id, display_name, status)
  values (ev.id, uid, name, p_status)
  on conflict (event_id, user_id)
  do update set display_name = excluded.display_name, status = excluded.status;

  return jsonb_build_object('status', p_status, 'display_name', name);
end;
$$;

revoke execute on function public.rsvp_as_user(text, public.rsvp_status) from public, anon;
grant execute on function public.rsvp_as_user(text, public.rsvp_status) to authenticated;
