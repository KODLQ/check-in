-- My invites (change: add-my-invites). Claiming web RSVPs into an account, the My invites read/write
-- RPCs and the get_invite payload extraction. See openspec/changes/add-my-invites/design.md.

-- 1. A claimed row keeps its guest_token_hash so the same browser can still change or withdraw it.
alter table public.rsvps drop constraint rsvps_one_identity;
alter table public.rsvps
  add constraint rsvps_has_identity check (user_id is not null or guest_token_hash is not null);

-- 2. Single-use claim tickets (hand-off from a browser to the app). Only hashes are stored.
create table public.rsvp_claim_tickets (
  ticket_hash text primary key check (ticket_hash ~ '^[0-9a-f]{64}$'),
  guest_token_hash text not null check (guest_token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  used_at timestamptz
);

-- No policies: reachable only from the security-definer functions below.
alter table public.rsvp_claim_tickets enable row level security;
revoke all on public.rsvp_claim_tickets from anon, authenticated;

-- 3. Retention: tickets are deleted once used or expired (at most ~25h with the hourly job).
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
end;
$$;

revoke execute on function public.run_retention(timestamptz) from public, anon, authenticated;

create or replace function public.hash_claim_ticket(p_ticket text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p_ticket, 'sha256'), 'hex');
$$;

revoke execute on function public.hash_claim_ticket(text) from public, anon, authenticated;

-- 4. Called by the web server (service role) after per-IP rate limiting.
create or replace function public.create_claim_ticket(p_guest_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  ticket text := public.random_url_token();
begin
  if p_guest_token is null or char_length(p_guest_token) < 22 then
    raise exception 'invalid_guest_token' using errcode = 'P0001';
  end if;
  insert into public.rsvp_claim_tickets (ticket_hash, guest_token_hash)
  values (public.hash_claim_ticket(ticket), public.hash_guest_token(p_guest_token));
  return ticket;
end;
$$;

revoke execute on function public.create_claim_ticket(text) from public, anon, authenticated;
grant execute on function public.create_claim_ticket(text) to service_role;

-- 5. Host reply digest: unchanged, except that claiming (which only re-attributes existing answers)
-- never notifies the host.
create or replace function public.rsvps_notify_digest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_sent timestamptz;
begin
  if current_setting('checkin.claiming', true) = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if new.user_id is not null and public.is_event_manager_for(new.event_id, new.user_id) then
    return null;
  end if;

  select max(processed_at) into last_sent
  from public.notifications
  where event_id = new.event_id and kind = 'rsvp_digest' and state = 'fanned_out';

  perform public.enqueue_notification(
    p_kind => 'rsvp_digest',
    p_event_id => new.event_id,
    p_audience => 'event_managers',
    p_payload => jsonb_build_object('rsvp_ids', jsonb_build_array(new.id)),
    p_not_before => greatest(now() + interval '1 minute', last_sent + interval '15 minutes'),
    p_coalesce_key => 'rsvp_digest:' || new.event_id,
    p_coalesce_mode => 'keep'
  );
  return null;
end;
$$;

revoke execute on function public.rsvps_notify_digest() from public, anon, authenticated;

-- 6. Redeem a claim ticket: links that browser's RSVPs to the caller's account.
-- An invalid ticket RETURNS {"error":"invalid_ticket"} instead of raising, so the per-account
-- rate-limit hit is committed and guessing stays limited (a raise would roll the hit back).
create or replace function public.claim_guest_rsvps(p_ticket text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  t public.rsvp_claim_tickets;
  g public.rsvps;
  a public.rsvps;
  n_claimed int := 0;
  n_merged int := 0;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles where id = uid and btrim(coalesce(display_name, '')) <> '') then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if not public.hit_rate_limit('claim:' || uid, 10, 3600) then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  select * into t from public.rsvp_claim_tickets
  where ticket_hash = public.hash_claim_ticket(coalesce(p_ticket, ''))
    and used_at is null and expires_at > now()
  for update;
  if not found then
    return jsonb_build_object('error', 'invalid_ticket');
  end if;
  update public.rsvp_claim_tickets set used_at = now() where ticket_hash = t.ticket_hash;

  perform set_config('checkin.claiming', 'on', true);

  for g in
    select * from public.rsvps
    where guest_token_hash = t.guest_token_hash and user_id is null
    order by created_at
    for update
  loop
    select * into a from public.rsvps where event_id = g.event_id and user_id = uid for update;
    if found then
      -- Merge: keep the account's row, holding the most recently updated answer.
      if g.updated_at > a.updated_at then
        update public.rsvps set status = g.status where id = a.id;
      end if;
      delete from public.rsvps where id = g.id;
      if a.guest_token_hash is null then
        update public.rsvps set guest_token_hash = g.guest_token_hash where id = a.id;
      end if;
      -- App users get push, never email (spec: notifications), so the address is no longer needed.
      delete from public.rsvp_email_subscriptions where rsvp_id = a.id;
      n_merged := n_merged + 1;
    else
      update public.rsvps set user_id = uid where id = g.id;
      delete from public.rsvp_email_subscriptions where rsvp_id = g.id;
      n_claimed := n_claimed + 1;
    end if;
  end loop;

  perform set_config('checkin.claiming', '', true);

  return jsonb_build_object('claimed', n_claimed, 'merged', n_merged);
end;
$$;

revoke execute on function public.claim_guest_rsvps(text) from public, anon;
grant execute on function public.claim_guest_rsvps(text) to authenticated;

-- 7. rsvp_as_user: a first RSVP uses the profile name; changing an existing answer keeps the
-- RSVP's display name (e.g. a claimed "Sara B").
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
  do update set status = excluded.status
  returning display_name into name;

  return jsonb_build_object('status', p_status, 'display_name', name);
end;
$$;

revoke execute on function public.rsvp_as_user(text, public.rsvp_status) from public, anon;
grant execute on function public.rsvp_as_user(text, public.rsvp_status) to authenticated;

-- 8. Shared invite payload for an active or past event (get_invite and get_my_invite).
-- Internal: not executable by clients.
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

create or replace function public.get_invite(p_token text, p_guest_token text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
  me public.rsvps;
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

  if (select auth.uid()) is not null then
    select * into me from public.rsvps r where r.event_id = ev.id and r.user_id = (select auth.uid());
  elsif p_guest_token is not null then
    select * into me from public.rsvps r
    where r.event_id = ev.id and r.guest_token_hash = public.hash_guest_token(p_guest_token);
    is_guest_device := me.id is not null;
  end if;

  return public.invite_payload(ev, me, is_guest_device);
end;
$$;

revoke execute on function public.get_invite(text, text) from public;
grant execute on function public.get_invite(text, text) to anon, authenticated, service_role;

-- 9. My invites: events the caller answered through their account, excluding events they manage.
-- No invite token or location in the list; get_my_invite returns the details.
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
      'my_rsvp', jsonb_build_object('status', r.status, 'display_name', r.display_name)
    ) order by e.starts_at), '[]'::jsonb)
    from public.rsvps r
    join public.events e on e.id = r.event_id
    join public.profiles h on h.id = e.host_id
    where r.user_id = uid and not public.is_event_manager(e.id)
  );
end;
$$;

revoke execute on function public.list_my_invites() from public, anon;
grant execute on function public.list_my_invites() to authenticated;

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
  select * into me from public.rsvps where event_id = p_event_id and user_id = uid;
  if not found then
    return jsonb_build_object('state', 'not_found');
  end if;
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

revoke execute on function public.get_my_invite(uuid) from public, anon;
grant execute on function public.get_my_invite(uuid) to authenticated;

-- Changes the caller's existing answer. Works after the invite link was revoked: the existing row
-- proves the invitation. Withdrawing uses the RLS delete policy (user_id = auth.uid()).
create or replace function public.set_my_rsvp(p_event_id uuid, p_status public.rsvp_status)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ev public.events;
  me public.rsvps;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into me from public.rsvps where event_id = p_event_id and user_id = uid for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select * into ev from public.events where id = p_event_id;
  if ev.cancelled_at is not null or public.event_ended_at(ev) < now() then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;

  update public.rsvps set status = p_status where id = me.id;
  return jsonb_build_object('status', p_status, 'display_name', me.display_name);
end;
$$;

revoke execute on function public.set_my_rsvp(uuid, public.rsvp_status) from public, anon;
grant execute on function public.set_my_rsvp(uuid, public.rsvp_status) to authenticated;
