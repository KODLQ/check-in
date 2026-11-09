-- Recurring events (change: add-groups-and-recurring-events, design D1-D6, D8, D9). A series belongs to a
-- group; each date is an ordinary events row created ahead by ensure_series_dates. The group's owner and
-- admins manage the series and its dates. Group members reach group events as guests through the my-invites
-- RPCs. Maintenance paths set the transaction-local flag checkin.series_rpc so events_guard lets them move
-- an event's owner or detach its group/series without tripping the usual edit rules.

-- 1. Tables and columns -----------------------------------------------------------------------------------

create table public.event_series (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly')),
  -- The rule counts from anchor_index, whose date is anchor_local_date (re-anchored when the rule changes).
  anchor_local_date date not null,
  anchor_index int not null default 0,
  local_start_time time not null,
  duration interval check (duration is null or duration > interval '0'),
  time_zone text not null default 'Europe/Stockholm',
  ends_on date,
  next_index int not null default 0,
  ended_at timestamptz,
  -- Template copied onto every new date.
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text check (char_length(description) <= 2000),
  location_text text not null check (char_length(btrim(location_text)) between 1 and 200),
  place_name text check (char_length(place_name) <= 200),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  cover_path text,
  theme text not null default 'sunset',
  guest_list_visible boolean not null default true,
  allow_plus_ones boolean not null default false,
  max_plus_ones smallint not null default 1,
  capacity integer,
  wall_enabled boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index event_series_group_idx on public.event_series (group_id);
create index event_series_active_idx on public.event_series (id) where ended_at is null;

alter table public.events
  add column series_id uuid references public.event_series (id) on delete set null,
  add column occurrence_index int,
  add column group_id uuid references public.groups (id) on delete set null,
  add constraint events_series_index_together check (series_id is null or occurrence_index is not null),
  add constraint events_series_occurrence_unique unique (series_id, occurrence_index);

create index events_series_idx on public.events (series_id) where series_id is not null;
create index events_group_idx on public.events (group_id) where group_id is not null;

create or replace function public.max_active_series() returns int language sql immutable set search_path = '' as $$ select 10 $$;
create or replace function public.series_upcoming_dates() returns int language sql immutable set search_path = '' as $$ select 4 $$;

-- 2. Rights -----------------------------------------------------------------------------------------------

create or replace function public.is_series_admin(p_series_id uuid, p_user_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.event_series s
    where s.id = p_series_id and public.is_group_admin(s.group_id, coalesce(p_user_id, (select auth.uid())))
  );
$$;

-- Owner rights: the event's host, or for a date of a group's series, the group's owner and admins.
-- is_event_manager (owner or co-host) picks this up, and with it every policy and RPC built on it.
create or replace function public.is_event_owner(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and (e.host_id = (select auth.uid())
           or (e.series_id is not null and public.is_series_admin(e.series_id)))
  );
$$;

revoke execute on function public.is_series_admin(uuid, uuid) from public, anon;
grant execute on function public.is_series_admin(uuid, uuid) to authenticated, service_role;

alter table public.event_series enable row level security;
revoke all on public.event_series from anon;
revoke insert, update, delete on public.event_series from authenticated;

create policy "event_series: group admins read" on public.event_series for select to authenticated
using (public.is_group_admin(group_id));

drop policy "events: managers can read" on public.events;
drop policy "events: managers can update" on public.events;

create policy "events: managers can read"
on public.events for select
to authenticated
using (host_id = (select auth.uid()) or public.is_event_co_host(id)
       or (series_id is not null and public.is_series_admin(series_id)));

create policy "events: managers can update"
on public.events for update
to authenticated
using (host_id = (select auth.uid()) or public.is_event_co_host(id)
       or (series_id is not null and public.is_series_admin(series_id)))
with check (host_id = (select auth.uid()) or public.is_event_co_host(id)
            or (series_id is not null and public.is_series_admin(series_id)));
-- "events: host can delete" stays host-only: group admins never delete a date.

-- 3. events_guard: every earlier rule kept (add-event-wall version), plus series and group rules -----------

create or replace function public.events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  poll_rpc boolean := coalesce(current_setting('checkin.poll_rpc', true), '') = 'on';
  series_rpc boolean := coalesce(current_setting('checkin.series_rpc', true), '') = 'on';
  structural text[] := array['host_id', 'group_id', 'series_id', 'occurrence_index', 'updated_at', 'location_point'];
begin
  if tg_op = 'INSERT' then
    if (new.starts_at is null or new.poll_closes_at is not null or new.date_picked_at is not null) and not poll_rpc then
      raise exception 'start_required' using errcode = 'P0001';
    end if;
    if new.starts_at <= now() then
      raise exception 'start_in_past' using errcode = 'P0001';
    end if;
    if (new.series_id is not null or new.occurrence_index is not null) and not series_rpc then
      raise exception 'series_rpc_only' using errcode = 'P0001';
    end if;
    if new.group_id is not null and not series_rpc then
      if new.starts_at is null then
        raise exception 'group_needs_date' using errcode = 'P0001';
      end if;
      if uid is not null and not public.is_group_admin(new.group_id, uid) then
        raise exception 'not_group_admin' using errcode = 'P0001';
      end if;
    end if;
    return new;
  end if;

  -- UPDATE
  -- Maintenance (series RPCs, group handover, group/series deletion): only owner/group/series links change.
  if series_rpc and (to_jsonb(new) - structural) = (to_jsonb(old) - structural) then
    new.updated_at := now();
    return new;
  end if;
  -- Wall toggle (add-event-wall): only wall_enabled changes -> allowed at any time.
  if (to_jsonb(new) - 'wall_enabled' - 'updated_at' - 'location_point')
     = (to_jsonb(old) - 'wall_enabled' - 'updated_at' - 'location_point') then
    new.updated_at := now();
    return new;
  end if;
  if new.host_id is distinct from old.host_id then
    raise exception 'host_immutable' using errcode = 'P0001';
  end if;
  if (new.series_id is distinct from old.series_id or new.occurrence_index is distinct from old.occurrence_index)
     and not series_rpc then
    raise exception 'series_fixed' using errcode = 'P0001';
  end if;
  -- A series date always invites its group; on a one-off event only the owner picks a group they administer.
  if new.group_id is distinct from old.group_id and not series_rpc then
    if old.series_id is not null then
      raise exception 'series_group_fixed' using errcode = 'P0001';
    end if;
    if uid is not null and uid <> old.host_id then
      raise exception 'owner_only' using errcode = 'P0001';
    end if;
    if new.group_id is not null and uid is not null and not public.is_group_admin(new.group_id, uid) then
      raise exception 'not_group_admin' using errcode = 'P0001';
    end if;
    if new.group_id is not null and new.starts_at is null then
      raise exception 'group_needs_date' using errcode = 'P0001';
    end if;
  end if;
  -- Cancel / un-cancel needs owner rights (host, or group admin on a series date). Service role and
  -- maintenance jobs (no auth.uid()) are not restricted.
  if new.cancelled_at is distinct from old.cancelled_at and uid is not null and not public.is_event_owner(old.id) then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  -- Null for a pending event: never ended.
  if public.event_ended_at(old) < now() then
    raise exception 'event_ended' using errcode = 'P0001';
  end if;
  -- A cover must be in the editor's own folder or the event's folder. Series RPCs validate it themselves.
  if new.cover_path is distinct from old.cover_path and new.cover_path is not null and uid is not null and not series_rpc then
    if new.cover_path like '%..%'
       or not (starts_with(new.cover_path, uid::text || '/') or starts_with(new.cover_path, 'e/' || old.id::text || '/')) then
      raise exception 'invalid_cover' using errcode = 'P0001';
    end if;
  end if;
  -- Date polls.
  if old.starts_at is not null and new.starts_at is null then
    raise exception 'start_required' using errcode = 'P0001';
  end if;
  if not poll_rpc and (
       (old.starts_at is null and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at))
       or new.poll_closes_at is distinct from old.poll_closes_at
       or new.date_picked_at is distinct from old.date_picked_at) then
    raise exception 'date_pending' using errcode = 'P0001';
  end if;
  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    if new.starts_at is distinct from old.starts_at and new.starts_at <= now() then
      raise exception 'start_in_past' using errcode = 'P0001';
    end if;
    if old.starts_at is not null then
      new.time_changed_at := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- Series dates take the wall setting from the series template, not the host's default.
create or replace function public.events_wall_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.series_id is null then
    new.wall_enabled := coalesce((select p.wall_default_enabled from public.profiles p where p.id = new.host_id), true);
  end if;
  return new;
end;
$$;

create or replace function public.set_series_rpc(p_on boolean)
returns void
language sql
set search_path = ''
as $$
  select set_config('checkin.series_rpc', case when p_on then 'on' else '' end, true);
$$;

revoke execute on function public.set_series_rpc(boolean) from public, anon, authenticated;

-- 4. Owner-rights co-host invite: group admins may invite co-hosts on series dates -----------------------

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
  if not found or not public.is_event_manager(p_event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.is_event_owner(p_event_id) then
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

-- 5. Date computation (design D3) ----------------------------------------------------------------------------

create or replace function public.series_local_date(s public.event_series, k int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  m date;
  dow int := extract(dow from s.anchor_local_date)::int;
  last_day date;
  first_day date;
  n int;
begin
  if s.frequency = 'weekly' then
    return s.anchor_local_date + (k - s.anchor_index) * 7;
  elsif s.frequency = 'biweekly' then
    return s.anchor_local_date + (k - s.anchor_index) * 14;
  end if;
  m := (date_trunc('month', s.anchor_local_date) + make_interval(months => k - s.anchor_index))::date;
  -- An anchor in the last seven days of its month repeats on the last such weekday.
  if date_trunc('month', s.anchor_local_date + 7) <> date_trunc('month', s.anchor_local_date) then
    last_day := (m + interval '1 month' - interval '1 day')::date;
    return last_day - ((extract(dow from last_day)::int - dow + 7) % 7);
  end if;
  n := ceil(extract(day from s.anchor_local_date) / 7.0)::int;
  first_day := m + ((dow - extract(dow from m)::int + 7) % 7);
  return first_day + (n - 1) * 7;
end;
$$;

-- Start of date k at the series' local wall-clock time (fixed across daylight-saving changes).
create or replace function public.series_date_start(s public.event_series, k int)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select (public.series_local_date(s, k) + s.local_start_time) at time zone s.time_zone;
$$;

-- 6. Creating dates (design D2) ----------------------------------------------------------------------------

-- Creates missing dates until four are upcoming (cancelled ones count), within 6 months and the end date.
-- p_quiet: no "new date" notice (used for the extra dates created together with a new series).
-- p_limit: create at most this many.
create or replace function public.ensure_series_dates(
  p_series_id uuid, p_now timestamptz default now(), p_quiet boolean default false, p_limit int default null
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.event_series;
  owner_id uuid;
  upcoming int;
  start_at timestamptz;
  created int := 0;
begin
  select * into s from public.event_series where id = p_series_id for update;
  if not found or s.ended_at is not null then
    return 0;
  end if;
  select g.owner_id into owner_id from public.groups g where g.id = s.group_id;

  perform public.set_series_rpc(true);
  perform set_config('checkin.series_quiet', case when p_quiet then 'on' else '' end, true);
  loop
    exit when p_limit is not null and created >= p_limit;
    select count(*) into upcoming from public.events e
    where e.series_id = s.id and public.event_ended_at(e) > p_now;
    exit when upcoming >= public.series_upcoming_dates();

    start_at := public.series_date_start(s, s.next_index);
    exit when start_at > p_now + interval '6 months';
    exit when s.ends_on is not null and public.series_local_date(s, s.next_index) > s.ends_on;

    -- Dates missed while the job was down are skipped, never created in the past.
    if start_at > greatest(p_now, now()) then
      insert into public.events (
        host_id, series_id, occurrence_index, group_id, title, description, starts_at, ends_at, time_zone,
        location_text, place_name, latitude, longitude, cover_path, theme, guest_list_visible,
        allow_plus_ones, max_plus_ones, capacity, wall_enabled
      ) values (
        owner_id, s.id, s.next_index, s.group_id, s.title, s.description, start_at, start_at + s.duration, s.time_zone,
        s.location_text, s.place_name, s.latitude, s.longitude, s.cover_path, s.theme, s.guest_list_visible,
        s.allow_plus_ones, s.max_plus_ones, s.capacity, s.wall_enabled
      );
      created := created + 1;
    end if;
    s.next_index := s.next_index + 1;
    update public.event_series set next_index = s.next_index where id = s.id;
  end loop;
  perform public.set_series_rpc(false);
  perform set_config('checkin.series_quiet', '', true);
  return created;
end;
$$;

-- Hourly job: every active series that has fewer than four upcoming dates.
create or replace function public.run_series_dates(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
  total int := 0;
begin
  for sid in
    select s.id from public.event_series s
    where s.ended_at is null
      and (select count(*) from public.events e where e.series_id = s.id and public.event_ended_at(e) > p_now)
          < public.series_upcoming_dates()
    order by s.id
  loop
    total := total + public.ensure_series_dates(sid, p_now);
  end loop;
  return total;
end;
$$;

revoke execute on function public.ensure_series_dates(uuid, timestamptz, boolean, int) from public, anon, authenticated;
revoke execute on function public.run_series_dates(timestamptz) from public, anon, authenticated;
grant execute on function public.run_series_dates(timestamptz) to service_role;

select cron.schedule('series-dates', '7 * * * *', $$select public.run_series_dates()$$);

-- 7. Series RPCs ------------------------------------------------------------------------------------------

create or replace function public.valid_cover_for(p_uid uuid, p_cover text, p_event_id uuid default null)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_cover is null or (
    p_cover not like '%..%'
    and (starts_with(p_cover, p_uid::text || '/')
         or (p_event_id is not null and starts_with(p_cover, 'e/' || p_event_id::text || '/'))));
$$;

-- p_event: the first date's details as the event form sends them (title, starts_at, ends_at, time_zone,
-- location_text, place_name, latitude, longitude, description, cover_path, theme, guest_list_visible,
-- allow_plus_ones, max_plus_ones, capacity, wall_enabled).
create or replace function public.create_series(
  p_group_id uuid, p_event jsonb, p_frequency text, p_ends_on date default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  g public.groups := public.lock_group_for(p_group_id, 'admin');
  starts timestamptz := (p_event ->> 'starts_at')::timestamptz;
  ends timestamptz := (p_event ->> 'ends_at')::timestamptz;
  tz text := coalesce(nullif(p_event ->> 'time_zone', ''), 'Europe/Stockholm');
  local_start timestamp;
  sid uuid;
  first_id uuid;
begin
  if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then
    raise exception 'invalid_frequency' using errcode = '22023';
  end if;
  if p_event ? 'poll_options' or p_event ? 'poll_closes_at' then
    raise exception 'repeat_with_poll' using errcode = 'P0001';
  end if;
  if starts is null then
    raise exception 'start_required' using errcode = 'P0001';
  end if;
  if starts <= now() then
    raise exception 'start_in_past' using errcode = 'P0001';
  end if;
  if ends is not null and ends <= starts then
    raise exception 'end_before_start' using errcode = 'P0001';
  end if;
  if not public.valid_cover_for(uid, p_event ->> 'cover_path') then
    raise exception 'invalid_cover' using errcode = 'P0001';
  end if;
  if not public.hit_rate_limit('series_create:' || uid, 20, 86400) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.event_series where group_id = p_group_id and ended_at is null) >= public.max_active_series() then
    raise exception 'series_limit' using errcode = 'P0001';
  end if;
  local_start := starts at time zone tz;
  if p_ends_on is not null and p_ends_on < local_start::date then
    raise exception 'invalid_end_date' using errcode = 'P0001';
  end if;

  insert into public.event_series (
    group_id, frequency, anchor_local_date, local_start_time, duration, time_zone, ends_on,
    title, description, location_text, place_name, latitude, longitude, cover_path, theme,
    guest_list_visible, allow_plus_ones, max_plus_ones, capacity, wall_enabled, created_by
  ) values (
    p_group_id, p_frequency, local_start::date, local_start::time, ends - starts, tz, p_ends_on,
    btrim(p_event ->> 'title'), nullif(p_event ->> 'description', ''), btrim(p_event ->> 'location_text'),
    p_event ->> 'place_name', (p_event ->> 'latitude')::double precision, (p_event ->> 'longitude')::double precision,
    p_event ->> 'cover_path', coalesce(p_event ->> 'theme', 'sunset'),
    coalesce((p_event ->> 'guest_list_visible')::boolean, true),
    coalesce((p_event ->> 'allow_plus_ones')::boolean, false),
    coalesce((p_event ->> 'max_plus_ones')::smallint, 1),
    (p_event ->> 'capacity')::int,
    coalesce((p_event ->> 'wall_enabled')::boolean,
             (select p.wall_default_enabled from public.profiles p where p.id = uid), true),
    uid
  ) returning id into sid;

  -- One "new date" notice for the first date only; the other dates are created quietly.
  perform public.ensure_series_dates(sid, now(), false, 1);
  perform public.ensure_series_dates(sid, now(), true, null);

  select id into first_id from public.events where series_id = sid and occurrence_index = 0;
  return jsonb_build_object(
    'series_id', sid,
    'event_id', first_id,
    'token', (select token from public.event_invites where event_id = first_id and revoked_at is null)
  );
end;
$$;

-- Locks the series behind a date and checks group-admin rights. Date-only co-hosts get not_group_admin.
create or replace function public.lock_series_for_event(p_event_id uuid)
returns public.event_series
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  ev public.events;
  s public.event_series;
begin
  select * into ev from public.events where id = p_event_id;
  if not found or ev.series_id is null or not public.is_event_manager(p_event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into s from public.event_series where id = ev.series_id for update;
  if not public.is_group_admin(s.group_id, uid) then
    raise exception 'not_group_admin' using errcode = 'P0001';
  end if;
  return s;
end;
$$;

create or replace function public.lock_series(p_series_id uuid)
returns public.event_series
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  s public.event_series;
begin
  select * into s from public.event_series where id = p_series_id for update;
  if not found or not public.is_group_member(s.group_id, uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not public.is_group_admin(s.group_id, uid) then
    raise exception 'not_group_admin' using errcode = 'P0001';
  end if;
  return s;
end;
$$;

revoke execute on function public.lock_series_for_event(uuid) from public, anon, authenticated;
revoke execute on function public.lock_series(uuid) from public, anon, authenticated;
revoke execute on function public.valid_cover_for(uuid, text, uuid) from public, anon, authenticated;

-- "This and following" (design D5): updates the series template and every not-ended, not-cancelled date
-- from the chosen one on, through ordinary events updates so change notifications work as for one edit.
-- p_patch uses the event form's field names; starts_at/ends_at only change the time of day and duration.
create or replace function public.update_series_from(p_event_id uuid, p_patch jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_uid();
  s public.event_series := public.lock_series_for_event(p_event_id);
  ev public.events;
  d public.events;
  new_time time := s.local_start_time;
  new_duration interval := s.duration;
  new_start timestamptz;
  n int := 0;
begin
  select * into ev from public.events where id = p_event_id;
  if public.event_ended_at(ev) < now() or ev.cancelled_at is not null then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  if p_patch ? 'starts_at' then
    if ((p_patch ->> 'starts_at')::timestamptz at time zone s.time_zone)::date <> (ev.starts_at at time zone s.time_zone)::date then
      raise exception 'day_change_this_date_only' using errcode = 'P0001';
    end if;
    new_time := ((p_patch ->> 'starts_at')::timestamptz at time zone s.time_zone)::time;
    new_duration := (p_patch ->> 'ends_at')::timestamptz - (p_patch ->> 'starts_at')::timestamptz;
  elsif p_patch ? 'ends_at' then
    new_duration := (p_patch ->> 'ends_at')::timestamptz - ev.starts_at;
  end if;
  if new_duration is not null and new_duration <= interval '0' then
    raise exception 'end_before_start' using errcode = 'P0001';
  end if;
  if p_patch ? 'cover_path' and (p_patch ->> 'cover_path') is distinct from s.cover_path
     and not public.valid_cover_for(uid, p_patch ->> 'cover_path', p_event_id) then
    raise exception 'invalid_cover' using errcode = 'P0001';
  end if;

  update public.event_series set
    title = case when p_patch ? 'title' then btrim(p_patch ->> 'title') else title end,
    description = case when p_patch ? 'description' then nullif(p_patch ->> 'description', '') else description end,
    location_text = case when p_patch ? 'location_text' then btrim(p_patch ->> 'location_text') else location_text end,
    place_name = case when p_patch ? 'place_name' then p_patch ->> 'place_name' else place_name end,
    latitude = case when p_patch ? 'latitude' then (p_patch ->> 'latitude')::double precision else latitude end,
    longitude = case when p_patch ? 'longitude' then (p_patch ->> 'longitude')::double precision else longitude end,
    cover_path = case when p_patch ? 'cover_path' then p_patch ->> 'cover_path' else cover_path end,
    theme = case when p_patch ? 'theme' then p_patch ->> 'theme' else theme end,
    guest_list_visible = case when p_patch ? 'guest_list_visible' then (p_patch ->> 'guest_list_visible')::boolean else guest_list_visible end,
    allow_plus_ones = case when p_patch ? 'allow_plus_ones' then (p_patch ->> 'allow_plus_ones')::boolean else allow_plus_ones end,
    max_plus_ones = case when p_patch ? 'max_plus_ones' then (p_patch ->> 'max_plus_ones')::smallint else max_plus_ones end,
    capacity = case when p_patch ? 'capacity' then (p_patch ->> 'capacity')::int else capacity end,
    wall_enabled = case when p_patch ? 'wall_enabled' then (p_patch ->> 'wall_enabled')::boolean else wall_enabled end,
    local_start_time = new_time,
    duration = new_duration,
    updated_at = now()
  where id = s.id
  returning * into s;

  perform public.set_series_rpc(true);
  for d in
    select * from public.events e
    where e.series_id = s.id and e.starts_at >= ev.starts_at and e.cancelled_at is null
      and public.event_ended_at(e) >= now()
    order by e.starts_at
  loop
    new_start := ((d.starts_at at time zone s.time_zone)::date + s.local_start_time) at time zone s.time_zone;
    update public.events set
      title = s.title, description = s.description, location_text = s.location_text, place_name = s.place_name,
      latitude = s.latitude, longitude = s.longitude, cover_path = s.cover_path, theme = s.theme,
      guest_list_visible = s.guest_list_visible, allow_plus_ones = s.allow_plus_ones,
      max_plus_ones = s.max_plus_ones, capacity = s.capacity, wall_enabled = s.wall_enabled,
      starts_at = new_start, ends_at = new_start + s.duration
    where id = d.id;
    n := n + 1;
  end loop;
  perform public.set_series_rpc(false);
  return n;
end;
$$;

-- New rule or end date (design D4): applies to dates created from now on; existing dates keep their day.
create or replace function public.update_series_rule(p_series_id uuid, p_frequency text, p_ends_on date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.event_series := public.lock_series(p_series_id);
  last_ev public.events;
begin
  if p_frequency is null or p_frequency not in ('weekly', 'biweekly', 'monthly') then
    raise exception 'invalid_frequency' using errcode = '22023';
  end if;
  if s.ended_at is not null then
    raise exception 'series_ended' using errcode = 'P0001';
  end if;
  if p_frequency <> s.frequency then
    select * into last_ev from public.events where series_id = s.id order by occurrence_index desc limit 1;
    if found then
      update public.event_series
      set anchor_local_date = (last_ev.starts_at at time zone s.time_zone)::date,
          anchor_index = last_ev.occurrence_index,
          next_index = last_ev.occurrence_index + 1
      where id = s.id;
    end if;
  end if;
  update public.event_series set frequency = p_frequency, ends_on = p_ends_on, updated_at = now() where id = s.id;
  perform public.ensure_series_dates(s.id);
end;
$$;

-- Ends a series: no more dates. Optionally cancels the upcoming ones (their guests are notified).
create or replace function public.end_series_now(p_series_id uuid, p_cancel_upcoming boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.event_series set ended_at = coalesce(ended_at, now()), updated_at = now() where id = p_series_id;
  if p_cancel_upcoming then
    update public.events set cancelled_at = now()
    where series_id = p_series_id and cancelled_at is null and starts_at > now();
  end if;
end;
$$;

revoke execute on function public.end_series_now(uuid, boolean) from public, anon, authenticated;

create or replace function public.end_series(p_series_id uuid, p_cancel_upcoming boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.lock_series(p_series_id);
  perform public.end_series_now(p_series_id, coalesce(p_cancel_upcoming, false));
end;
$$;

-- Series of a group, for its members (group screen).
create or replace function public.list_group_series(p_group_id uuid)
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
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'title', s.title,
      'frequency', s.frequency,
      'anchor_local_date', s.anchor_local_date,
      'ends_on', s.ends_on,
      'next', (
        select jsonb_build_object('event_id', e.id, 'starts_at', e.starts_at, 'cancelled', e.cancelled_at is not null)
        from public.events e
        where e.series_id = s.id and public.event_ended_at(e) >= now()
        order by e.starts_at limit 1
      )
    ) order by s.created_at), '[]'::jsonb)
    from public.event_series s
    where s.group_id = p_group_id and s.ended_at is null
  );
end;
$$;

-- 8. Groups: deleting a group ends its series; handover moves series dates (redefines the placeholders) ----

create or replace function public.end_group_series(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  sid uuid;
begin
  for sid in select id from public.event_series where group_id = p_group_id and ended_at is null loop
    perform public.end_series_now(sid, true);
  end loop;
  -- Deleting the group then nulls group_id/series_id on its dates (structural changes events_guard allows).
  perform public.set_series_rpc(true);
end;
$$;

create or replace function public.move_group_series_owner(p_group_id uuid, p_new_owner uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.event_co_hosts c
  using public.events e join public.event_series s on s.id = e.series_id
  where c.event_id = e.id and s.group_id = p_group_id and c.user_id = p_new_owner;
  perform public.set_series_rpc(true);
  update public.events e set host_id = p_new_owner
  from public.event_series s
  where s.id = e.series_id and s.group_id = p_group_id and e.host_id <> p_new_owner;
  perform public.set_series_rpc(false);
end;
$$;

-- Account deletion: also flag structural changes, since deleting a sole-member group nulls its dates' links.
create or replace function public.profiles_pass_on_groups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.pass_on_owned_groups(old.id);
  perform public.set_series_rpc(true);
  return old;
end;
$$;

-- One-off events stop inviting a group when their owner stops being its owner or admin (design D8).
create or replace function public.group_members_rights_end()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and not (old.is_admin and not new.is_admin) then
    return null;
  end if;
  -- Cascades from a deleted group or account: their events are handled by those deletions.
  if not exists (select 1 from public.groups g where g.id = old.group_id)
     or not exists (select 1 from public.profiles p where p.id = old.user_id) then
    return null;
  end if;
  if public.is_group_admin(old.group_id, old.user_id) then
    return null;
  end if;
  perform public.set_series_rpc(true);
  update public.events e set group_id = null
  where e.host_id = old.user_id and e.group_id = old.group_id and e.series_id is null
    and e.cancelled_at is null and public.event_ended_at(e) >= now();
  perform public.set_series_rpc(false);
  return null;
end;
$$;

revoke execute on function public.group_members_rights_end() from public, anon, authenticated;

create trigger group_members_rights_end
after delete or update of is_admin on public.group_members
for each row execute function public.group_members_rights_end();

-- 9. Members as guests (design D8) ----------------------------------------------------------------------------

-- Access through an own RSVP, or through membership of the group an upcoming, active event invites.
create or replace function public.can_see_event_as_guest(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.rsvps r where r.event_id = p_event_id and r.user_id = p_user_id)
      or exists (
        select 1 from public.events e
        join public.group_members m on m.group_id = e.group_id and m.user_id = p_user_id
        where e.id = p_event_id and e.cancelled_at is null and e.starts_at is not null
          and public.event_ended_at(e) >= now());
$$;

revoke execute on function public.can_see_event_as_guest(uuid, uuid) from public, anon, authenticated;

create or replace function public.list_my_invites()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'title', e.title,
      'starts_at', e.starts_at,
      'ends_at', e.ends_at,
      'time_zone', e.time_zone,
      'cover_path', e.cover_path,
      'theme', e.theme,
      'state', case
        when e.cancelled_at is not null then 'cancelled'
        when public.event_ended_at(e) < now() then 'past'
        else 'active' end,
      'host', jsonb_build_object('display_name', h.display_name),
      'my_rsvp', case when r.id is not null then
        jsonb_build_object('status', r.status, 'display_name', r.display_name, 'plus_ones', r.plus_ones) end,
      'group', case when e.group_id is not null then
        jsonb_build_object('id', e.group_id, 'name', (select g.name from public.groups g where g.id = e.group_id)) end,
      'series', case when e.series_id is not null then (
        select jsonb_build_object('id', s.id, 'frequency', s.frequency, 'anchor_local_date', s.anchor_local_date)
        from public.event_series s where s.id = e.series_id) end
    ) order by e.starts_at), '[]'::jsonb)
    from public.events e
    join public.profiles h on h.id = e.host_id
    left join public.rsvps r on r.event_id = e.id and r.user_id = uid
    where (e.id in (select x.event_id from public.rsvps x where x.user_id = uid)
           or (e.group_id in (select m.group_id from public.group_members m where m.user_id = uid)
               and e.cancelled_at is null and e.starts_at is not null and public.event_ended_at(e) >= now()))
      and not public.is_event_manager(e.id)
  );
end;
$$;

create or replace function public.get_my_invite(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ev public.events;
  me public.rsvps;
  host public.profiles;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.can_see_event_as_guest(p_event_id, uid) then
    return jsonb_build_object('state', 'not_found');
  end if;
  select * into me from public.rsvps where event_id = p_event_id and user_id = uid;
  select * into ev from public.events where id = p_event_id;

  if ev.cancelled_at is not null then
    -- This user had already seen these details; location and guests are not repeated.
    select * into host from public.profiles where id = ev.host_id;
    return jsonb_build_object(
      'state', 'cancelled',
      'event', jsonb_build_object(
        'title', ev.title,
        'starts_at', ev.starts_at,
        'ends_at', ev.ends_at,
        'time_zone', ev.time_zone,
        'cover_path', ev.cover_path,
        'theme', ev.theme
      ),
      'host', jsonb_build_object('display_name', host.display_name, 'avatar_path', host.avatar_path),
      'my_rsvp', jsonb_build_object('status', me.status, 'display_name', me.display_name)
    );
  end if;

  return public.invite_payload(ev, me, false);
end;
$$;

-- A group member's first answer creates an account RSVP with their profile name (capacity rules apply).
create or replace function public.set_my_rsvp(
  p_event_id uuid,
  p_status public.rsvp_status,
  p_plus_ones int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ev public.events;
  saved public.rsvps;
  name text;
  has_rsvp boolean;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  has_rsvp := exists (select 1 from public.rsvps where event_id = p_event_id and user_id = uid);
  if not has_rsvp and not public.can_see_event_as_guest(p_event_id, uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not has_rsvp then
    select display_name into name from public.profiles where id = uid;
    if name is null then
      raise exception 'display_name_required' using errcode = 'P0001';
    end if;
  end if;
  ev := public.lock_open_event(p_event_id);
  saved := public.save_rsvp_locked(ev, uid, null, name, p_status, p_plus_ones, false, has_rsvp);
  return public.rsvp_result(saved.id);
end;
$$;

revoke execute on function public.list_my_invites() from public, anon;
revoke execute on function public.get_my_invite(uuid) from public, anon;
revoke execute on function public.set_my_rsvp(uuid, public.rsvp_status, int) from public, anon;
grant execute on function public.list_my_invites() to authenticated;
grant execute on function public.get_my_invite(uuid) to authenticated;
grant execute on function public.set_my_rsvp(uuid, public.rsvp_status, int) to authenticated;

-- Invite payloads gain the series (rule, next date) and, for series dates, the group shown as host.
alter function public.invite_payload(public.events, public.rsvps, boolean, text) rename to invite_payload_core;

create or replace function public.invite_payload(
  ev public.events,
  me public.rsvps,
  p_guest_device boolean default false,
  p_voter_hash text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base jsonb := public.invite_payload_core(ev, me, p_guest_device, p_voter_hash);
  s public.event_series;
  nxt public.events;
begin
  if ev.series_id is null then
    return base;
  end if;
  select * into s from public.event_series where id = ev.series_id;
  select * into nxt from public.events e
  where e.series_id = ev.series_id and e.starts_at > ev.starts_at and e.cancelled_at is null
  order by e.starts_at limit 1;
  return base || jsonb_build_object(
    'group', jsonb_build_object('name', (select g.name from public.groups g where g.id = ev.group_id)),
    'series', jsonb_build_object(
      'frequency', s.frequency,
      'anchor_local_date', s.anchor_local_date,
      'next', case when nxt.id is not null then jsonb_build_object(
        'event_id', nxt.id,
        'starts_at', nxt.starts_at,
        'token', (select i.token from public.event_invites i where i.event_id = nxt.id and i.revoked_at is null)
      ) end
    )
  );
end;
$$;

revoke execute on function public.invite_payload_core(public.events, public.rsvps, boolean, text) from public, anon, authenticated;
revoke execute on function public.invite_payload(public.events, public.rsvps, boolean, text) from public, anon, authenticated;

-- Manager view of a group event: who in the group has not answered, and which RSVPs are members.
create or replace function public.group_event_summary(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = p_event_id;
  if not found or not public.is_event_manager(p_event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if ev.group_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'group_id', ev.group_id,
    'group_name', (select g.name from public.groups g where g.id = ev.group_id),
    'member_count', (select count(*) from public.group_members m where m.group_id = ev.group_id),
    'not_answered', (
      select count(*) from public.group_members m
      where m.group_id = ev.group_id
        and not exists (select 1 from public.rsvps r where r.event_id = ev.id and r.user_id = m.user_id)
        and not public.is_event_manager_for(ev.id, m.user_id)),
    'member_user_ids', (
      select coalesce(jsonb_agg(m.user_id), '[]'::jsonb) from public.group_members m where m.group_id = ev.group_id)
  );
end;
$$;

-- 10. Notifications for group events (design D9) --------------------------------------------------------------

insert into public.notification_kinds (kind, urgent, channels, stale_after_start) values
  ('group_date_open', false, array['push'], true),
  ('group_answer_reminder', false, array['push'], true);

alter table public.notifications drop constraint notifications_audience_check;
alter table public.notifications add constraint notifications_audience_check
  check (audience in ('event_attendees', 'event_managers', 'rsvp', 'user', 'group_unanswered'));
alter table public.notifications drop constraint notifications_target;
alter table public.notifications add constraint notifications_target check (
  (audience = 'rsvp') = (target_rsvp_id is not null)
  and (audience = 'user') = (target_user_id is not null)
  and (audience not in ('event_attendees', 'event_managers', 'group_unanswered') or event_id is not null)
);

-- New date notice when a group starts being invited (not for the quiet extra dates of a new series), and a
-- reminder 24 hours before for members who still have not answered (none when that moment has passed).
create or replace function public.events_group_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  group_changed boolean := tg_op = 'INSERT' or new.group_id is distinct from old.group_id;
begin
  if tg_op = 'UPDATE' and not group_changed and new.starts_at is not distinct from old.starts_at then
    return null;
  end if;
  delete from public.notifications
  where event_id = new.id and kind = 'group_answer_reminder' and state = 'pending';
  if new.group_id is null or new.cancelled_at is not null or new.starts_at is null then
    return null;
  end if;
  if group_changed and coalesce(current_setting('checkin.series_quiet', true), '') <> 'on' then
    perform public.enqueue_notification(
      p_kind => 'group_date_open', p_event_id => new.id, p_audience => 'group_unanswered',
      p_payload => jsonb_build_object('group_id', new.group_id),
      p_dedupe_key => 'group_date_open:' || new.id || ':' || new.group_id);
  end if;
  if new.starts_at - interval '24 hours' > now() then
    perform public.enqueue_notification(
      p_kind => 'group_answer_reminder', p_event_id => new.id, p_audience => 'group_unanswered',
      p_payload => jsonb_build_object('group_id', new.group_id),
      p_not_before => new.starts_at - interval '24 hours');
  end if;
  return null;
end;
$$;

revoke execute on function public.events_group_notify() from public, anon, authenticated;

create trigger events_group_notify
after insert or update of group_id, starts_at on public.events
for each row execute function public.events_group_notify();

create or replace function public.notification_recipients(n public.notifications)
returns table (channel text, user_id uuid, push_token_id uuid, rsvp_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    -- Going/Maybe guests: app users get push on every device, web guests email if subscribed.
    select 'push'::text as channel, t.user_id, t.id as push_token_id, null::uuid as rsvp_id
    from public.rsvps r
    join public.push_tokens t on t.user_id = r.user_id
    where n.audience = 'event_attendees' and r.event_id = n.event_id and r.status in ('going', 'maybe')
    union all
    select 'email', null, null, r.id
    from public.rsvps r
    join public.rsvp_email_subscriptions s on s.rsvp_id = r.id
    where n.audience = 'event_attendees' and r.event_id = n.event_id and r.status in ('going', 'maybe')
      and r.user_id is null
    union all
    -- Managers (owner, co-hosts and, on series dates, group admins). Push only.
    select 'push', t.user_id, t.id, null
    from public.push_tokens t
    where n.audience = 'event_managers' and public.is_event_manager_for(n.event_id, t.user_id)
    union all
    -- A single RSVP (e.g. opt-in confirmation, waitlist promotion).
    select 'push', t.user_id, t.id, null
    from public.rsvps r
    join public.push_tokens t on t.user_id = r.user_id
    where n.audience = 'rsvp' and r.id = n.target_rsvp_id
    union all
    select 'email', null, null, r.id
    from public.rsvps r
    join public.rsvp_email_subscriptions s on s.rsvp_id = r.id
    where n.audience = 'rsvp' and r.id = n.target_rsvp_id and r.user_id is null
    union all
    -- A single user.
    select 'push', t.user_id, t.id, null
    from public.push_tokens t
    where n.audience = 'user' and t.user_id = n.target_user_id
    union all
    -- Members of the invited group who have not answered and don't manage the event (add-groups-…).
    select 'push', t.user_id, t.id, null
    from public.events e
    join public.group_members m on m.group_id = e.group_id
    join public.push_tokens t on t.user_id = m.user_id
    where n.audience = 'group_unanswered' and e.id = n.event_id
      and not exists (select 1 from public.rsvps r where r.event_id = e.id and r.user_id = m.user_id)
      and not public.is_event_manager_for(e.id, m.user_id)
  )
  select c.channel, c.user_id, c.push_token_id, c.rsvp_id
  from candidates c
  join public.notification_kinds k on k.kind = n.kind
  where c.channel = any (k.channels)
    and (n.exclude_user_id is null or c.user_id is distinct from n.exclude_user_id);
$$;

revoke execute on function public.notification_recipients(public.notifications) from public, anon, authenticated;

create or replace function public.notification_stale_reason(n public.notifications, p_now timestamptz)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  k public.notification_kinds;
  ev public.events;
  gid uuid := public.try_uuid(n.payload ->> 'group_id');
begin
  select * into k from public.notification_kinds where kind = n.kind;
  if n.event_id is not null then
    select * into ev from public.events where id = n.event_id;
    if not found then
      return 'event_deleted';
    end if;
    if ev.cancelled_at is not null and n.kind <> 'event_cancelled' then
      return 'event_cancelled';
    end if;
    if k.stale_after_start and ev.starts_at <= p_now then
      return 'event_started';
    end if;
  end if;
  if n.kind = 'announcement' and not exists (
    select 1 from public.event_announcements a where a.id = n.subject_id and a.deleted_at is null
  ) then
    return 'announcement_deleted';
  end if;
  if n.kind = 'rsvp_digest' and not exists (
    select 1 from public.rsvps r
    where r.id in (select (jsonb_array_elements_text(coalesce(n.payload -> 'rsvp_ids', '[]'::jsonb)))::uuid)
  ) then
    return 'no_replies_left';
  end if;
  if n.kind = 'waitlist_promoted' and not exists (
    select 1 from public.rsvps r where r.id = n.target_rsvp_id and r.status = 'going'
  ) then
    return 'no_longer_going';
  end if;
  -- Groups (add-groups-and-recurring-events).
  if n.kind in ('group_invited', 'group_joined', 'group_new_owner')
     and not exists (select 1 from public.groups g where g.id = gid) then
    return 'group_deleted';
  end if;
  if n.kind = 'group_invited' and not exists (
    select 1 from public.group_invitations i
    where i.group_id = gid and i.user_id = n.target_user_id and i.declined_at is null and i.expires_at > p_now
  ) then
    return 'invitation_closed';
  end if;
  if n.kind = 'group_new_owner' and not exists (
    select 1 from public.groups g where g.id = gid and g.owner_id = n.target_user_id
  ) then
    return 'no_longer_owner';
  end if;
  if n.kind in ('group_date_open', 'group_answer_reminder') and ev.group_id is distinct from gid then
    return 'group_removed';
  end if;
  return null;
end;
$$;

revoke execute on function public.notification_stale_reason(public.notifications, timestamptz) from public, anon, authenticated;

-- Delivery context: every earlier field kept; group kinds add the group, the acting member's name and the
-- names of people who joined, and open the group (or, for group events, the in-app invite).
create or replace function public.claim_deliveries(p_limit int default 100, p_now timestamptz default now())
returns setof jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.notification_deliveries;
  n public.notifications;
  ev public.events;
  sub public.rsvp_email_subscriptions;
  tok public.push_tokens;
  reason text;
  bucket text;
  max_hits int;
  window_s int;
  invite_token text;
  host_name text;
  is_manager boolean;
  gid uuid;
begin
  update public.notification_deliveries
  set status = 'failed', locked_until = null, last_error = 'lock_expired'
  where channel = 'push' and status = 'sending' and locked_until < p_now;

  for d in
    select * from public.notification_deliveries
    where (status = 'pending' and next_attempt_at <= p_now)
       or (channel = 'email' and status = 'sending' and locked_until < p_now)
    order by next_attempt_at
    limit p_limit
    for update skip locked
  loop
    select * into n from public.notifications where id = d.notification_id;

    reason := public.notification_stale_reason(n, p_now);
    if reason is not null then
      update public.notification_deliveries set status = 'skipped', locked_until = null, last_error = reason where id = d.id;
      continue;
    end if;

    if d.channel = 'email' then
      select * into sub from public.rsvp_email_subscriptions where rsvp_id = d.rsvp_id;
      if not found then
        update public.notification_deliveries set status = 'skipped', locked_until = null, last_error = 'unsubscribed' where id = d.id;
        continue;
      end if;
    else
      select * into tok from public.push_tokens where id = d.push_token_id;
      sub := null;
    end if;

    -- Per-recipient limits for non-urgent sends, counted once per delivery (not per retry).
    if not d.urgent and d.attempts = 0 then
      if d.channel = 'push' then
        bucket := 'push:' || d.user_id; max_hits := 20; window_s := 3600;
      else
        bucket := 'email:' || d.rsvp_id; max_hits := 10; window_s := 86400;
      end if;
      if not public.hit_rate_limit(bucket, max_hits, window_s, p_now) then
        update public.notification_deliveries
        set next_attempt_at = public.apply_quiet_hours(
              to_timestamp((floor(extract(epoch from p_now) / window_s) + 1) * window_s), false)
        where id = d.id;
        continue;
      end if;
    end if;

    update public.notification_deliveries
    set status = 'sending', attempts = attempts + 1, locked_until = p_now + interval '2 minutes'
    where id = d.id
    returning * into d;

    ev := null;
    invite_token := null;
    host_name := null;
    select * into ev from public.events where id = n.event_id;
    select i.token into invite_token from public.event_invites i where i.event_id = n.event_id and i.revoked_at is null;
    select p.display_name into host_name from public.profiles p where p.id = ev.host_id;
    is_manager := d.channel = 'push' and n.event_id is not null and public.is_event_manager_for(n.event_id, d.user_id);
    gid := public.try_uuid(n.payload ->> 'group_id');

    return next jsonb_build_object(
      'delivery_id', d.id,
      'notification_id', n.id,
      'channel', d.channel,
      'kind', n.kind,
      'attempts', d.attempts,
      'locale', coalesce(case when d.channel = 'email' then sub.locale else tok.locale end, 'en'),
      'to', case when d.channel = 'email' then sub.email else tok.token end,
      'unsubscribe_token', sub.unsubscribe_token,
      'invite_token', invite_token,
      'url_path', case
        when n.kind in ('group_invited', 'group_joined', 'group_new_owner') then
          case when n.kind = 'group_invited' then '/groups' else '/groups/' || gid end
        when n.event_id is null then null
        when is_manager then '/events/' || n.event_id
        when n.kind in ('group_date_open', 'group_answer_reminder') then '/invites/' || n.event_id
        when invite_token is not null then '/i/' || invite_token
      end,
      'event', case when ev.id is not null then jsonb_build_object(
        'id', ev.id,
        'title', ev.title,
        'starts_at', ev.starts_at,
        'ends_at', ev.ends_at,
        'time_zone', ev.time_zone,
        'location_text', ev.location_text,
        'place_name', ev.place_name
      ) end,
      'host_name', host_name,
      'payload', n.payload,
      'group', case when gid is not null then (
        select jsonb_build_object('id', g.id, 'name', g.name) from public.groups g where g.id = gid
      ) end,
      'actor_name', (select p.display_name from public.profiles p where p.id = public.try_uuid(n.payload ->> 'actor_id')),
      'joined_names', case when n.kind = 'group_joined' then (
        select coalesce(jsonb_agg(p.display_name order by p.display_name), '[]'::jsonb)
        from public.profiles p
        where p.id in (select public.try_uuid(x) from jsonb_array_elements_text(coalesce(n.payload -> 'user_ids', '[]'::jsonb)) x)
      ) end,
      'announcement', case when n.kind = 'announcement' then (
        select jsonb_build_object('body', a.body, 'created_at', a.created_at)
        from public.event_announcements a where a.id = n.subject_id
      ) end,
      'replies', case when n.kind = 'rsvp_digest' then (
        select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'status', r.status) order by r.updated_at), '[]'::jsonb)
        from public.rsvps r
        where r.id in (select (jsonb_array_elements_text(coalesce(n.payload -> 'rsvp_ids', '[]'::jsonb)))::uuid)
      ) end
    );
  end loop;
end;
$$;

revoke execute on function public.claim_deliveries(int, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_deliveries(int, timestamptz) to service_role;

-- 11. Grants ---------------------------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.create_series(uuid, jsonb, text, date)',
    'public.update_series_from(uuid, jsonb)',
    'public.update_series_rule(uuid, text, date)',
    'public.end_series(uuid, boolean)',
    'public.list_group_series(uuid)',
    'public.group_event_summary(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;

revoke execute on function public.series_local_date(public.event_series, int) from public, anon;
revoke execute on function public.series_date_start(public.event_series, int) from public, anon;

-- 12. delete_group: ends the group's series first, then resets the maintenance flag.
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
  perform public.set_series_rpc(false);
end;
$$;

revoke execute on function public.delete_group(uuid) from public, anon;
grant execute on function public.delete_group(uuid) to authenticated;

-- 13. Retention: every earlier line kept (groups version); ended series without dates removed.
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

  -- Ended series once their last date has been deleted by the event retention above.
  delete from public.event_series s
  where s.ended_at is not null and not exists (select 1 from public.events e where e.series_id = s.id);

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
