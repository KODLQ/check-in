-- Host announcements (spec: event-announcements; design §2, §3, §5) and get_invite additions (§11).

create table public.event_announcements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  -- Erased on delete; the row stays 24h so the 5-per-24h limit counts deleted posts.
  body text check (body is null or char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint event_announcements_body_until_deleted check ((deleted_at is null) = (body is not null))
);

create index event_announcements_event_idx on public.event_announcements (event_id, created_at desc);

alter table public.event_announcements enable row level security;

-- Managers read; nobody writes directly (post_announcement / delete_announcement only).
create policy "event_announcements: managers can read"
on public.event_announcements for select
to authenticated
using (deleted_at is null and public.is_event_manager(event_id));

revoke insert, update, delete on public.event_announcements from anon, authenticated;

create or replace function public.max_announcements_per_day()
returns int language sql immutable set search_path = '' as $$ select 5 $$;

create or replace function public.post_announcement(p_event_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ev public.events;
  body text := btrim(coalesce(p_body, ''));
  recent int;
  next_at timestamptz;
  a public.event_announcements;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_event_manager(p_event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  -- Lock the event so concurrent posts can't both slip under the limit.
  select * into ev from public.events where id = p_event_id for update;
  if ev.cancelled_at is not null or public.event_ended_at(ev) < now() then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  if char_length(body) not between 1 and 500 then
    raise exception 'invalid_body' using errcode = 'P0001';
  end if;

  select count(*), min(created_at) + interval '24 hours' into recent, next_at
  from (
    select created_at from public.event_announcements
    where event_id = p_event_id and created_at > now() - interval '24 hours'
    order by created_at desc
    limit public.max_announcements_per_day()
  ) last_posts;
  if recent >= public.max_announcements_per_day() then
    raise exception 'announcement_limit'
      using errcode = 'P0001', detail = to_char(next_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;

  insert into public.event_announcements (event_id, author_id, body, created_at)
  values (p_event_id, uid, body, clock_timestamp())
  returning * into a;

  perform public.enqueue_notification(
    p_kind => 'announcement',
    p_event_id => p_event_id,
    p_audience => 'event_attendees',
    p_subject_id => a.id,
    p_exclude_user_id => uid,
    p_dedupe_key => 'announcement:' || a.id
  );

  return jsonb_build_object('id', a.id, 'body', a.body, 'created_at', a.created_at);
end;
$$;

revoke execute on function public.post_announcement(uuid, text) from public, anon;
grant execute on function public.post_announcement(uuid, text) to authenticated;

create or replace function public.delete_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.event_announcements;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into a from public.event_announcements where id = p_id;
  if not found or not public.is_event_manager(a.event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  update public.event_announcements
  set deleted_at = now(), body = null
  where id = p_id and deleted_at is null;

  -- Not yet delivered => never delivered. Already-sent notifications are not recalled.
  update public.notifications
  set state = 'cancelled', processed_at = now()
  where subject_id = p_id and kind = 'announcement' and state = 'pending';

  update public.notification_deliveries d
  set status = 'skipped', locked_until = null, last_error = 'announcement_deleted'
  from public.notifications n
  where n.id = d.notification_id and n.subject_id = p_id and n.kind = 'announcement'
    and d.status = 'pending';
end;
$$;

revoke execute on function public.delete_announcement(uuid) from public, anon;
grant execute on function public.delete_announcement(uuid) to authenticated;

-- get_invite: adds my_rsvp.email_updates (guest's own device only) and announcements.
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
  sub public.rsvp_email_subscriptions;
  is_guest_device boolean := false;
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
    is_guest_device := me.id is not null;
    if is_guest_device then
      select * into sub from public.rsvp_email_subscriptions s where s.rsvp_id = me.id;
    end if;
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
      || case when is_guest_device then jsonb_build_object('email_updates', jsonb_build_object(
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

revoke execute on function public.get_invite(text, text) from public;
grant execute on function public.get_invite(text, text) to anon, authenticated, service_role;
