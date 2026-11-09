-- Event wall, part 2: eligibility, feed, uploads, posts, deletion, moderation, identity/name sync,
-- retention and the wall_digest notification (change: add-event-wall, design §3-§8 and "Rebase").
--
-- Every wall_* RPC is security definer, granted to service_role only, and called by the web app's
-- /api/wall/* route handlers after Zod validation and per-IP rate limiting. The caller passes either the
-- invite token (web guests, and app users who opened an invite link) or an event id plus a VERIFIED user id
-- (the route resolves it from the bearer token with auth.getUser; it never trusts a client-supplied id).
-- Guest tokens are hashed here. Unknown and revoked links raise/return the same not_found.

-- 1. Limits (design §7; tunable without a spec change, mirrored in packages/shared/src/wall.ts) ----------

create or replace function public.wall_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'body_max', 500,
    'photos_per_post', 4,
    'photos_per_guest', 10,
    'posts_per_10min', 10,
    'reservations_per_hour', 20,
    'posts_per_event', 1000,
    'photos_per_event', 500,
    'max_bytes', 10485760,
    'page_size', 30,
    'open_days_after_end', 14
  );
$$;

-- 2. Moderation helper and actor resolution ---------------------------------------------------------------

-- Single moderation check (design §3): owner or co-host. Explicit user id because auth.uid() is null under
-- the service role. Delegates to is_event_manager (via is_event_manager_for) so co-host rules stay in one place.
create or replace function public.can_moderate_event(p_event_id uuid, p_user_id uuid)
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select coalesce(public.is_event_manager_for(p_event_id, p_user_id), false);
$$;

-- Who is acting on a wall. Managers act as host. Guests act through their RSVP on the event, so a claimed
-- RSVP's account AND browser hash both count as "the same poster". Without an RSVP the caller's own
-- identity is used (e.g. a guest who withdrew can still delete their posts).
create type public.wall_actor as (
  user_id uuid,
  guest_hash text,
  is_host boolean,
  status public.rsvp_status,
  display_name text
);

create or replace function public.wall_actor_for(p_event_id uuid, p_user_id uuid, p_guest_hash text)
returns public.wall_actor
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  a public.wall_actor;
  r public.rsvps;
begin
  a.is_host := false;
  if p_user_id is not null and public.can_moderate_event(p_event_id, p_user_id) then
    a.user_id := p_user_id;
    a.is_host := true;
    a.display_name := coalesce(
      (select nullif(btrim(p.display_name), '') from public.profiles p where p.id = p_user_id), 'Host');
    return a;
  end if;
  if p_user_id is not null then
    select * into r from public.rsvps where event_id = p_event_id and user_id = p_user_id;
  elsif p_guest_hash is not null then
    select * into r from public.rsvps where event_id = p_event_id and guest_token_hash = p_guest_hash;
  end if;
  if r.id is not null then
    a.user_id := r.user_id;
    a.guest_hash := r.guest_token_hash;
    a.status := r.status;
    a.display_name := r.display_name;
  else
    a.user_id := p_user_id;
    a.guest_hash := p_guest_hash;
  end if;
  return a;
end;
$$;

create or replace function public.wall_is_blocked(p_event_id uuid, a public.wall_actor)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.wall_blocks b
    where b.event_id = p_event_id
      and ((a.user_id is not null and b.user_id = a.user_id) or (a.guest_hash is not null and b.guest_hash = a.guest_hash))
  );
$$;

-- 'ok' or why the actor can't post: cancelled | disabled | closed | not_attending | blocked.
-- Date-pending events have starts_at and event_ended_at() null: the explicit `is null` branch keeps the
-- window open (a bare `now() < null` would be null and silently block posting).
create or replace function public.wall_post_reason(ev public.events, a public.wall_actor, p_now timestamptz default now())
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ended timestamptz := public.event_ended_at(ev);
begin
  if ev.cancelled_at is not null then
    return 'cancelled';
  end if;
  if not ev.wall_enabled then
    return 'disabled';
  end if;
  if not (ended is null or p_now < ended + make_interval(days => (public.wall_limits() ->> 'open_days_after_end')::int)) then
    return 'closed';
  end if;
  if a.is_host then
    return 'ok';
  end if;
  -- Waitlisted guests (add-guest-capacity) and date-poll voters (no RSVP until the pick) are not attending.
  if a.status is null or a.status not in ('going', 'maybe') then
    return 'not_attending';
  end if;
  if public.wall_is_blocked(ev.id, a) then
    return 'blocked';
  end if;
  return 'ok';
end;
$$;

create or replace function public.wall_can_post(
  p_event_id uuid, p_user_id uuid, p_guest_hash text, p_now timestamptz default now()
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = p_event_id;
  if ev.id is null then
    return 'not_found';
  end if;
  return public.wall_post_reason(ev, public.wall_actor_for(p_event_id, p_user_id, p_guest_hash), p_now);
end;
$$;

-- Resolves the event a wall call is about. Token: active (non-revoked) invite link, cancelled events
-- included (read-only wall). Event id: only for a verified user who manages the event or has an RSVP on it
-- (the same audience as get_my_invite). Raises not_found otherwise.
create or replace function public.wall_event(p_token text, p_event_id uuid, p_user_id uuid)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  if p_token is not null then
    if p_token ~ '^[A-Za-z0-9]{12}$' then
      select e.* into ev
      from public.event_invites i
      join public.events e on e.id = i.event_id
      where i.token = p_token and i.revoked_at is null;
    end if;
  elsif p_event_id is not null and p_user_id is not null then
    select e.* into ev from public.events e
    where e.id = p_event_id
      and (e.host_id = p_user_id
        or exists (select 1 from public.event_co_hosts c where c.event_id = e.id and c.user_id = p_user_id)
        or exists (select 1 from public.rsvps r where r.event_id = e.id and r.user_id = p_user_id));
  end if;
  if ev.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return ev;
end;
$$;

create or replace function public.wall_guest_hash(p_guest_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_guest_token is null then null else public.hash_guest_token(p_guest_token) end;
$$;

-- Quota counters for an actor (photos on the wall + live uploads), both identities considered.
create or replace function public.wall_actor_photo_count(p_event_id uuid, a public.wall_actor, p_now timestamptz default now())
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::int from public.wall_photos p
     where p.event_id = p_event_id
       and ((a.user_id is not null and p.author_user_id = a.user_id) or (a.guest_hash is not null and p.author_guest_hash = a.guest_hash)))
    +
    (select count(*)::int from public.wall_uploads u
     where u.event_id = p_event_id and u.status in ('pending', 'processing', 'ready') and u.expires_at > p_now
       and ((a.user_id is not null and u.author_user_id = a.user_id) or (a.guest_hash is not null and u.author_guest_hash = a.guest_hash)));
$$;

-- 3. Feed (design §4) ------------------------------------------------------------------------------------
-- Never returns user ids or guest hashes. Photo paths are returned for the web server to sign; the route
-- replaces them with signed URLs before anything reaches a client.
create or replace function public.wall_feed(
  p_token text default null,
  p_event_id uuid default null,
  p_user_id uuid default null,
  p_guest_token text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit int default 30
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
  a public.wall_actor;
  lim int := least(greatest(coalesce(p_limit, 30), 1), 50);
  posts jsonb;
  has_more boolean;
  blocks jsonb := null;
begin
  begin
    ev := public.wall_event(p_token, p_event_id, p_user_id);
  exception when sqlstate 'P0002' then
    return jsonb_build_object('state', 'not_found');
  end;
  a := public.wall_actor_for(ev.id, p_user_id, public.wall_guest_hash(p_guest_token));

  -- Wall off: guests see nothing at all; managers keep seeing the posts.
  if not ev.wall_enabled and not a.is_host then
    return jsonb_build_object('state', 'disabled');
  end if;

  with page as (
    select p.* from public.wall_posts p
    where p.event_id = ev.id
      and (p_before_created_at is null or (p.created_at, p.id) < (p_before_created_at, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by p.created_at desc, p.id desc
    limit lim + 1
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id,
      'display_name', p.author_display_name,
      'is_host', p.is_host,
      'body', p.body,
      'created_at', p.created_at,
      'mine', coalesce((a.user_id is not null and p.author_user_id = a.user_id) or (a.guest_hash is not null and p.author_guest_hash = a.guest_hash), false),
      'can_block', a.is_host and not p.is_host,
      'photos', coalesce((
        select jsonb_agg(jsonb_build_object('id', ph.id, 'full_path', ph.full_path, 'thumb_path', ph.thumb_path,
                                            'width', ph.width, 'height', ph.height) order by ph.position)
        from public.wall_photos ph where ph.post_id = p.id), '[]'::jsonb)
    ) order by p.created_at desc, p.id desc) filter (where p.rn <= lim), '[]'::jsonb),
    count(*) > lim
  into posts, has_more
  from (select page.*, row_number() over (order by page.created_at desc, page.id desc) as rn from page) p;

  if a.is_host then
    select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'display_name', b.display_name) order by b.created_at), '[]'::jsonb)
    into blocks
    from public.wall_blocks b where b.event_id = ev.id;
  end if;

  return jsonb_build_object(
    'state', 'ok',
    'wall_enabled', ev.wall_enabled,
    'moderator', a.is_host,
    'can_post', public.wall_post_reason(ev, a),
    -- Photos this poster still may add (null for hosts: no quota).
    'photos_left', case when a.is_host then null
                        else greatest(0, (public.wall_limits() ->> 'photos_per_guest')::int - public.wall_actor_photo_count(ev.id, a)) end,
    'has_own_posts', exists (
      select 1 from public.wall_posts p where p.event_id = ev.id
        and ((a.user_id is not null and p.author_user_id = a.user_id) or (a.guest_hash is not null and p.author_guest_hash = a.guest_hash))),
    'posts', posts,
    'has_more', has_more,
    'blocks', blocks
  );
end;
$$;

-- 4. Uploads (design §5) ---------------------------------------------------------------------------------

create or replace function public.wall_reserve_upload(
  p_token text,
  p_event_id uuid,
  p_user_id uuid,
  p_guest_token text,
  p_content_type text,
  p_size int
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
  a public.wall_actor;
  reason text;
  lim jsonb := public.wall_limits();
  new_id uuid := gen_random_uuid();
  path text;
begin
  ev := public.wall_event(p_token, p_event_id, p_user_id);
  -- Serializes quota checks per event (same mutex as RSVP admission).
  ev := public.lock_event(ev.id);
  a := public.wall_actor_for(ev.id, p_user_id, public.wall_guest_hash(p_guest_token));
  reason := public.wall_post_reason(ev, a);
  if reason <> 'ok' then
    raise exception '%', reason using errcode = 'P0001';
  end if;
  if p_content_type is null or p_content_type not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif') then
    raise exception 'unsupported_type' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > (lim ->> 'max_bytes')::int then
    raise exception 'too_large' using errcode = 'P0001';
  end if;
  if not public.hit_rate_limit('wall_upload:' || ev.id || ':' || coalesce(a.user_id::text, a.guest_hash),
                               (lim ->> 'reservations_per_hour')::int, 3600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if not a.is_host and public.wall_actor_photo_count(ev.id, a) >= (lim ->> 'photos_per_guest')::int then
    raise exception 'photo_quota' using errcode = 'P0001';
  end if;
  if (select count(*) from public.wall_photos p where p.event_id = ev.id)
     + (select count(*) from public.wall_uploads u where u.event_id = ev.id and u.status in ('pending', 'processing', 'ready') and u.expires_at > now())
     >= (lim ->> 'photos_per_event')::int then
    raise exception 'wall_full' using errcode = 'P0001';
  end if;

  path := ev.id || '/' || new_id;
  insert into public.wall_uploads (id, event_id, author_user_id, author_guest_hash, is_host, content_type, size, incoming_path)
  values (new_id, ev.id, a.user_id, a.guest_hash, a.is_host, p_content_type, p_size, path);
  return jsonb_build_object('upload_id', new_id, 'incoming_path', path);
end;
$$;

-- Complete step, part 1: the actor claims its own pending, unexpired upload for processing (pending ->
-- processing, so a second "complete" can't process it twice). Returns what the route needs.
create or replace function public.wall_claim_upload(
  p_upload_id uuid,
  p_token text,
  p_event_id uuid,
  p_user_id uuid,
  p_guest_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
  a public.wall_actor;
  u public.wall_uploads;
begin
  ev := public.wall_event(p_token, p_event_id, p_user_id);
  a := public.wall_actor_for(ev.id, p_user_id, public.wall_guest_hash(p_guest_token));
  update public.wall_uploads w
  set status = 'processing'
  where w.id = p_upload_id and w.event_id = ev.id and w.status = 'pending' and w.expires_at > now()
    and ((a.user_id is not null and w.author_user_id = a.user_id) or (a.guest_hash is not null and w.author_guest_hash = a.guest_hash))
  returning * into u;
  if u.id is null then
    raise exception 'upload_not_found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('upload_id', u.id, 'event_id', u.event_id, 'incoming_path', u.incoming_path,
                            'content_type', u.content_type, 'size', u.size);
end;
$$;

-- Complete step, part 2 (service role, after processing): ready with the renditions, or rejected. A
-- rejected upload is deleted right away (its quarantine object is queued for deletion by the trigger).
create or replace function public.wall_mark_upload(
  p_upload_id uuid,
  p_status text,
  p_full_path text default null,
  p_thumb_path text default null,
  p_width int default null,
  p_height int default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n int;
begin
  if p_status = 'ready' then
    update public.wall_uploads
    set status = 'ready', full_path = p_full_path, thumb_path = p_thumb_path, width = p_width, height = p_height
    where id = p_upload_id and status = 'processing';
  elsif p_status = 'rejected' then
    delete from public.wall_uploads where id = p_upload_id and status in ('pending', 'processing');
  else
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- 5. Posts -----------------------------------------------------------------------------------------------

create or replace function public.wall_create_post(
  p_token text,
  p_event_id uuid,
  p_user_id uuid,
  p_guest_token text,
  p_body text,
  p_upload_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
  a public.wall_actor;
  reason text;
  lim jsonb := public.wall_limits();
  -- Trims all leading/trailing whitespace (spaces, newlines, tabs), not only spaces.
  v_body text := nullif(regexp_replace(coalesce(p_body, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '');
  ids uuid[] := coalesce(p_upload_ids, '{}');
  n_photos int := coalesce(cardinality(p_upload_ids), 0);
  v_post_id uuid;
  last_sent timestamptz;
begin
  ev := public.wall_event(p_token, p_event_id, p_user_id);
  ev := public.lock_event(ev.id);
  a := public.wall_actor_for(ev.id, p_user_id, public.wall_guest_hash(p_guest_token));
  reason := public.wall_post_reason(ev, a);
  if reason <> 'ok' then
    raise exception '%', reason using errcode = 'P0001';
  end if;

  if v_body is not null and char_length(v_body) > (lim ->> 'body_max')::int then
    raise exception 'body_too_long' using errcode = 'P0001';
  end if;
  if n_photos > (lim ->> 'photos_per_post')::int or n_photos <> (select count(distinct x) from unnest(ids) x) then
    raise exception 'too_many_photos' using errcode = 'P0001';
  end if;
  if v_body is null and n_photos = 0 then
    raise exception 'empty_post' using errcode = 'P0001';
  end if;
  if not public.hit_rate_limit('wall_post:' || ev.id || ':' || coalesce(a.user_id::text, a.guest_hash),
                               (lim ->> 'posts_per_10min')::int, 600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if (select count(*) from public.wall_posts p where p.event_id = ev.id) >= (lim ->> 'posts_per_event')::int then
    raise exception 'wall_full' using errcode = 'P0001';
  end if;

  if n_photos > 0 then
    -- Every upload must be ready, unexpired, on this event and the actor's own.
    if (select count(*) from public.wall_uploads u
        where u.id = any(ids) and u.event_id = ev.id and u.status = 'ready' and u.expires_at > now()
          and ((a.user_id is not null and u.author_user_id = a.user_id) or (a.guest_hash is not null and u.author_guest_hash = a.guest_hash))
       ) <> n_photos then
      raise exception 'invalid_upload' using errcode = 'P0001';
    end if;
    if (select count(*) from public.wall_photos p where p.event_id = ev.id) + n_photos > (lim ->> 'photos_per_event')::int then
      raise exception 'wall_full' using errcode = 'P0001';
    end if;
    if not a.is_host and (select count(*) from public.wall_photos p where p.event_id = ev.id
        and ((a.user_id is not null and p.author_user_id = a.user_id) or (a.guest_hash is not null and p.author_guest_hash = a.guest_hash)))
        + n_photos > (lim ->> 'photos_per_guest')::int then
      raise exception 'photo_quota' using errcode = 'P0001';
    end if;
  end if;

  insert into public.wall_posts (event_id, author_user_id, author_guest_hash, author_display_name, is_host, body, photo_count)
  values (ev.id, a.user_id, a.guest_hash, a.display_name, a.is_host, v_body, n_photos)
  returning id into v_post_id;

  if n_photos > 0 then
    insert into public.wall_photos (post_id, event_id, author_user_id, author_guest_hash, is_host, full_path, thumb_path, width, height, position)
    select v_post_id, ev.id, a.user_id, a.guest_hash, a.is_host, u.full_path, u.thumb_path, u.width, u.height, (x.ord - 1)::int
    from unnest(ids) with ordinality as x(id, ord)
    join public.wall_uploads u on u.id = x.id;
    -- Photo rows exist now, so the delete trigger only queues the quarantine objects.
    delete from public.wall_uploads where id = any(ids);
  end if;

  -- Batched push to the host and co-hosts (notifications "Host wall digest"): at most one per event per
  -- 15 minutes, counting posts. Posts by managers don't count.
  if not a.is_host then
    select max(processed_at) into last_sent
    from public.notifications
    where event_id = ev.id and kind = 'wall_digest' and state = 'fanned_out';
    perform public.enqueue_notification(
      p_kind => 'wall_digest',
      p_event_id => ev.id,
      p_audience => 'event_managers',
      p_payload => jsonb_build_object('post_ids', jsonb_build_array(v_post_id)),
      p_not_before => greatest(now() + interval '1 minute', last_sent + interval '15 minutes'),
      p_coalesce_key => 'wall_digest:' || ev.id,
      p_coalesce_mode => 'keep'
    );
  end if;

  return jsonb_build_object('id', v_post_id);
end;
$$;

-- Queue rows for a set of storage paths (the ones a delete just enqueued), for synchronous removal.
create or replace function public.wall_queue_for(p_paths text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'bucket', q.bucket, 'path', q.path)), '[]'::jsonb)
  from public.storage_deletion_queue q
  where q.path = any(p_paths);
$$;

-- Deletes one post (own post, or any post as manager), or with p_all_by_author every post by that post's
-- author (managers only). Works after withdrawal, cancellation and the end of the posting window.
-- Returns the storage queue rows to remove now.
create or replace function public.wall_delete_post(
  p_post_id uuid,
  p_token text,
  p_event_id uuid,
  p_user_id uuid,
  p_guest_token text,
  p_all_by_author boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
  a public.wall_actor;
  p public.wall_posts;
  paths text[];
  n int;
begin
  ev := public.wall_event(p_token, p_event_id, p_user_id);
  a := public.wall_actor_for(ev.id, p_user_id, public.wall_guest_hash(p_guest_token));
  select * into p from public.wall_posts where id = p_post_id and event_id = ev.id;
  if p.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if not a.is_host
     and not ((a.user_id is not null and p.author_user_id = a.user_id) or (a.guest_hash is not null and p.author_guest_hash = a.guest_hash)) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  if p_all_by_author and not a.is_host then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if p_all_by_author then
    select array_agg(x) into paths from (
      select unnest(array[ph.full_path, ph.thumb_path]) x from public.wall_photos ph
      join public.wall_posts w on w.id = ph.post_id
      where w.event_id = ev.id
        and ((p.author_user_id is not null and w.author_user_id = p.author_user_id)
          or (p.author_guest_hash is not null and w.author_guest_hash = p.author_guest_hash))) s;
    delete from public.wall_posts w
    where w.event_id = ev.id
      and ((p.author_user_id is not null and w.author_user_id = p.author_user_id)
        or (p.author_guest_hash is not null and w.author_guest_hash = p.author_guest_hash));
  else
    select array_agg(x) into paths from (
      select unnest(array[ph.full_path, ph.thumb_path]) x from public.wall_photos ph where ph.post_id = p.id) s;
    delete from public.wall_posts where id = p.id;
  end if;
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n, 'queue', public.wall_queue_for(coalesce(paths, '{}')));
end;
$$;

-- "Delete all my posts" (and the withdraw option). Also drops the actor's staged uploads.
create or replace function public.wall_delete_mine(
  p_token text,
  p_event_id uuid,
  p_user_id uuid,
  p_guest_token text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
  a public.wall_actor;
  paths text[];
  n int;
begin
  ev := public.wall_event(p_token, p_event_id, p_user_id);
  a := public.wall_actor_for(ev.id, p_user_id, public.wall_guest_hash(p_guest_token));

  select array_agg(x) into paths from (
    select unnest(array[ph.full_path, ph.thumb_path]) x from public.wall_photos ph
    where ph.event_id = ev.id
      and ((a.user_id is not null and ph.author_user_id = a.user_id) or (a.guest_hash is not null and ph.author_guest_hash = a.guest_hash))
    union all
    select unnest(array[u.incoming_path, u.full_path, u.thumb_path]) from public.wall_uploads u
    where u.event_id = ev.id
      and ((a.user_id is not null and u.author_user_id = a.user_id) or (a.guest_hash is not null and u.author_guest_hash = a.guest_hash))
  ) s where x is not null;

  delete from public.wall_posts w
  where w.event_id = ev.id
    and ((a.user_id is not null and w.author_user_id = a.user_id) or (a.guest_hash is not null and w.author_guest_hash = a.guest_hash));
  get diagnostics n = row_count;
  delete from public.wall_uploads u
  where u.event_id = ev.id
    and ((a.user_id is not null and u.author_user_id = a.user_id) or (a.guest_hash is not null and u.author_guest_hash = a.guest_hash));

  return jsonb_build_object('deleted', n, 'queue', public.wall_queue_for(coalesce(paths, '{}')));
end;
$$;

-- 6. Moderation ------------------------------------------------------------------------------------------

create or replace function public.wall_block_author(p_post_id uuid, p_event_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
  p public.wall_posts;
  block_id uuid;
begin
  ev := public.wall_event(null, p_event_id, p_user_id);
  if not public.can_moderate_event(ev.id, p_user_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select * into p from public.wall_posts where id = p_post_id and event_id = ev.id;
  if p.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if p.is_host then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  select b.id into block_id from public.wall_blocks b
  where b.event_id = ev.id
    and ((p.author_user_id is not null and b.user_id = p.author_user_id)
      or (p.author_guest_hash is not null and b.guest_hash = p.author_guest_hash));
  if block_id is null then
    insert into public.wall_blocks (event_id, user_id, guest_hash, display_name)
    values (ev.id, p.author_user_id, p.author_guest_hash, p.author_display_name)
    returning id into block_id;
  end if;
  return jsonb_build_object('id', block_id);
end;
$$;

create or replace function public.wall_unblock(p_block_id uuid, p_event_id uuid, p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
  n int;
begin
  ev := public.wall_event(null, p_event_id, p_user_id);
  if not public.can_moderate_event(ev.id, p_user_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  delete from public.wall_blocks where id = p_block_id and event_id = ev.id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Managers turn the wall on/off at any time (events_guard lets a wall_enabled-only update through after
-- the end or cancellation).
create or replace function public.wall_set_enabled(p_event_id uuid, p_user_id uuid, p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  ev := public.wall_event(null, p_event_id, p_user_id);
  if not public.can_moderate_event(ev.id, p_user_id) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;
  update public.events set wall_enabled = coalesce(p_enabled, true) where id = ev.id;
  return coalesce(p_enabled, true);
end;
$$;

-- 7. Identity and display-name sync ----------------------------------------------------------------------
-- Runs regardless of the checkin.claiming / checkin.poll_rpc transaction flags on purpose: it only mirrors
-- identity and names (it enqueues nothing). During a claim it is what links the browser's posts to the
-- account, so account deletion removes them too (user-accounts "Wall content removed with account").

create or replace function public.rsvps_sync_wall()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Claim (user_id set on a browser row) or merge (browser hash copied onto the account row).
  if new.user_id is not null and new.guest_token_hash is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id or new.guest_token_hash is distinct from old.guest_token_hash) then
    update public.wall_posts set author_user_id = new.user_id
    where event_id = new.event_id and author_guest_hash = new.guest_token_hash and author_user_id is null;
    update public.wall_photos set author_user_id = new.user_id
    where event_id = new.event_id and author_guest_hash = new.guest_token_hash and author_user_id is null;
    update public.wall_uploads set author_user_id = new.user_id
    where event_id = new.event_id and author_guest_hash = new.guest_token_hash and author_user_id is null;
    update public.wall_blocks set user_id = new.user_id
    where event_id = new.event_id and guest_hash = new.guest_token_hash and user_id is null
      and not exists (select 1 from public.wall_blocks b2 where b2.event_id = new.event_id and b2.user_id = new.user_id);
  end if;

  -- The wall always shows the name on the guest list.
  if tg_op = 'INSERT' or new.display_name is distinct from old.display_name
     or new.user_id is distinct from old.user_id or new.guest_token_hash is distinct from old.guest_token_hash then
    update public.wall_posts w set author_display_name = new.display_name
    where w.event_id = new.event_id and not w.is_host
      and ((new.user_id is not null and w.author_user_id = new.user_id)
        or (new.guest_token_hash is not null and w.author_guest_hash = new.guest_token_hash))
      and w.author_display_name is distinct from new.display_name;
  end if;
  return null;
end;
$$;

revoke execute on function public.rsvps_sync_wall() from public, anon, authenticated;

create trigger rsvps_sync_wall
after insert or update of display_name, user_id, guest_token_hash on public.rsvps
for each row execute function public.rsvps_sync_wall();

-- Host and co-host posts carry the profile name.
create or replace function public.profiles_sync_wall()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if nullif(btrim(new.display_name), '') is not null then
    update public.wall_posts set author_display_name = new.display_name
    where author_user_id = new.id and is_host and author_display_name is distinct from new.display_name;
  end if;
  return null;
end;
$$;

revoke execute on function public.profiles_sync_wall() from public, anon, authenticated;

create trigger profiles_sync_wall
after update of display_name on public.profiles
for each row execute function public.profiles_sync_wall();

-- 8. Storage cleanup queue (drained by /api/cron/storage-cleanup and synchronously by user deletes) -------

-- Claims due rows: bumps attempts and backs off (1, 2, 4 … minutes, max 6 h) so a failing path is retried.
create or replace function public.storage_queue_claim(p_limit int default 100, p_now timestamptz default now())
returns table (id bigint, bucket text, path text, attempts int)
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_deletion_queue q
  set attempts = q.attempts + 1,
      next_attempt_at = p_now + least(interval '6 hours', interval '1 minute' * power(2, q.attempts))
  where q.id in (
    select q2.id from public.storage_deletion_queue q2
    where q2.next_attempt_at <= p_now
    order by q2.id
    limit greatest(p_limit, 1)
    for update skip locked
  )
  returning q.id, q.bucket, q.path, q.attempts;
$$;

create or replace function public.storage_queue_done(p_ids bigint[])
returns int
language sql
volatile
security definer
set search_path = ''
as $$
  with d as (delete from public.storage_deletion_queue where id = any(p_ids) returning 1)
  select count(*)::int from d;
$$;

create or replace function public.storage_queue_failed(p_ids bigint[], p_error text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.storage_deletion_queue set last_error = left(p_error, 500) where id = any(p_ids);
$$;

-- Objects nobody references any more (crash between upload and processing, or between processing and the
-- row update): queued once they are older than 22 hours, so with the 10-minute cron they are gone within 24 h.
create or replace function public.wall_enqueue_orphans(p_now timestamptz default now())
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  n int;
begin
  insert into public.storage_deletion_queue (bucket, path)
  select o.bucket_id, o.name
  from storage.objects o
  where o.bucket_id in ('wall-incoming', 'wall')
    and o.created_at < p_now - interval '22 hours'
    and not exists (select 1 from public.wall_uploads u
                    where u.incoming_path = o.name or u.full_path = o.name or u.thumb_path = o.name)
    and not exists (select 1 from public.wall_photos p where p.full_path = o.name or p.thumb_path = o.name)
  on conflict (bucket, path) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 9. Retention: every line of the add-date-polls version is kept, plus staged wall uploads ----------------
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

revoke execute on function public.run_retention(timestamptz) from public, anon, authenticated;

-- 10. Notification kind (per supabase/functions/notifications-worker/README.md) --------------------------

insert into public.notification_kinds (kind, urgent, channels, stale_after_start) values
  ('wall_digest', false, array['push'], false);

-- 11. Grants: service role only ---------------------------------------------------------------------------

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.wall_limits()',
    'public.can_moderate_event(uuid, uuid)',
    'public.wall_actor_for(uuid, uuid, text)',
    'public.wall_is_blocked(uuid, public.wall_actor)',
    'public.wall_post_reason(public.events, public.wall_actor, timestamptz)',
    'public.wall_can_post(uuid, uuid, text, timestamptz)',
    'public.wall_event(text, uuid, uuid)',
    'public.wall_guest_hash(text)',
    'public.wall_actor_photo_count(uuid, public.wall_actor, timestamptz)',
    'public.wall_feed(text, uuid, uuid, text, timestamptz, uuid, int)',
    'public.wall_reserve_upload(text, uuid, uuid, text, text, int)',
    'public.wall_claim_upload(uuid, text, uuid, uuid, text)',
    'public.wall_mark_upload(uuid, text, text, text, int, int)',
    'public.wall_create_post(text, uuid, uuid, text, text, uuid[])',
    'public.wall_queue_for(text[])',
    'public.wall_delete_post(uuid, text, uuid, uuid, text, boolean)',
    'public.wall_delete_mine(text, uuid, uuid, text)',
    'public.wall_block_author(uuid, uuid, uuid)',
    'public.wall_unblock(uuid, uuid, uuid)',
    'public.wall_set_enabled(uuid, uuid, boolean)',
    'public.storage_queue_claim(int, timestamptz)',
    'public.storage_queue_done(bigint[])',
    'public.storage_queue_failed(bigint[], text)',
    'public.wall_enqueue_orphans(timestamptz)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
