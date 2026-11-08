create table public.events (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 100),
  description text check (char_length(description) <= 2000),
  starts_at timestamptz not null,
  ends_at timestamptz,
  time_zone text not null default 'Europe/Stockholm',
  location_text text not null check (char_length(btrim(location_text)) between 1 and 200),
  place_name text check (char_length(place_name) <= 200),
  latitude double precision check (latitude between -90 and 90),
  longitude double precision check (longitude between -180 and 180),
  location_point extensions.geography(Point, 4326) generated always as (
    case
      when latitude is not null and longitude is not null
      then extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
    end
  ) stored,
  cover_path text,
  theme text not null default 'sunset',
  guest_list_visible boolean not null default true,
  cancelled_at timestamptz,
  time_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_end_after_start check (ends_at is null or ends_at > starts_at),
  constraint events_lat_lng_together check ((latitude is null) = (longitude is null))
);

create index events_host_starts_idx on public.events (host_id, starts_at);
create index events_location_point_idx on public.events using gist (location_point);

comment on column public.events.location_text is
  'Free-text location. Never exposed in link previews.';

-- When an event is considered over (spec: end time, or 12h after start).
create or replace function public.event_ended_at(e public.events)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select coalesce(e.ends_at, e.starts_at + interval '12 hours');
$$;

-- Business rules enforced server-side, regardless of client.
create or replace function public.events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
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
  if public.event_ended_at(old) < now() then
    raise exception 'event_ended' using errcode = 'P0001';
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

create trigger events_guard
before insert or update on public.events
for each row execute function public.events_guard();

alter table public.events enable row level security;

-- Host-only access. There is intentionally NO policy for anon: guests read
-- events exclusively through public.get_invite(token).
create policy "events: host can read"
on public.events for select
to authenticated
using (host_id = (select auth.uid()));

create policy "events: host can create"
on public.events for insert
to authenticated
with check (host_id = (select auth.uid()));

create policy "events: host can update"
on public.events for update
to authenticated
using (host_id = (select auth.uid()))
with check (host_id = (select auth.uid()));

create policy "events: host can delete"
on public.events for delete
to authenticated
using (host_id = (select auth.uid()));

-- Helper used by policies on child tables.
create or replace function public.is_event_host(p_event_id uuid)
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

revoke execute on function public.is_event_host(uuid) from public, anon;
