-- Database side of the notifications worker (design §6). The Edge Function is a thin sender:
-- fan_out_due_notifications -> claim_deliveries -> (render + send) -> complete_delivery -> receipts.
-- Every time-dependent function takes p_now so pgTAP can control the clock.

-- Recipients of a notification, resolved NOW (spec: recipients decided at send time).
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
    -- Managers (host; co-hosts once add-co-hosts redefines is_event_manager). Push only.
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
  )
  select c.channel, c.user_id, c.push_token_id, c.rsvp_id
  from candidates c
  join public.notification_kinds k on k.kind = n.kind
  where c.channel = any (k.channels)
    and (n.exclude_user_id is null or c.user_id is distinct from n.exclude_user_id);
$$;

revoke execute on function public.notification_recipients(public.notifications) from public, anon, authenticated;

-- Why a notification (or one of its deliveries) must not be sent any more, or null if it still should.
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
  return null;
end;
$$;

revoke execute on function public.notification_stale_reason(public.notifications, timestamptz) from public, anon, authenticated;

-- Urgent = kind flag, or a change to an event starting within 12 hours (spec: quiet hours).
create or replace function public.notification_is_urgent(n public.notifications, p_now timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select k.urgent from public.notification_kinds k where k.kind = n.kind), false)
      or (n.kind = 'event_changed' and exists (
            select 1 from public.events e where e.id = n.event_id and e.starts_at - p_now <= interval '12 hours'));
$$;

revoke execute on function public.notification_is_urgent(public.notifications, timestamptz) from public, anon, authenticated;

create or replace function public.fan_out_due_notifications(p_limit int default 100, p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n public.notifications;
  reason text;
  urgent boolean;
  send_at timestamptz;
  processed int := 0;
begin
  for n in
    select * from public.notifications
    where state = 'pending' and not_before <= p_now
    order by not_before
    limit p_limit
    for update skip locked
  loop
    processed := processed + 1;
    reason := public.notification_stale_reason(n, p_now);
    if reason is not null then
      update public.notifications
      set state = case when reason in ('event_cancelled', 'announcement_deleted') then 'cancelled' else 'skipped' end,
          processed_at = p_now
      where id = n.id;
      continue;
    end if;

    urgent := public.notification_is_urgent(n, p_now);
    send_at := public.apply_quiet_hours(p_now, urgent);
    if send_at > p_now then
      -- Quiet hours: stay pending (later RSVP changes still apply) until 08:00.
      update public.notifications set not_before = send_at where id = n.id;
      continue;
    end if;

    insert into public.notification_deliveries (notification_id, channel, user_id, push_token_id, rsvp_id, urgent, next_attempt_at)
    -- Due immediately (least() keeps simulated clocks in tests from pushing sends into the future).
    select n.id, r.channel, r.user_id, r.push_token_id, r.rsvp_id, urgent, least(p_now, now())
    from public.notification_recipients(n) r
    on conflict do nothing;

    update public.notifications set state = 'fanned_out', processed_at = p_now where id = n.id;
  end loop;
  return processed;
end;
$$;

revoke execute on function public.fan_out_due_notifications(int, timestamptz) from public, anon, authenticated;
grant execute on function public.fan_out_due_notifications(int, timestamptz) to service_role;

-- Claims due deliveries for sending and returns a ready-to-render context per delivery.
-- Safe with concurrent workers (skip locked). Push deliveries whose lock expired are failed, not retried:
-- Expo has no idempotency key, so we prefer losing a push on a crash to sending it twice.
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

    select * into ev from public.events where id = n.event_id;
    select i.token into invite_token from public.event_invites i where i.event_id = n.event_id and i.revoked_at is null;
    select p.display_name into host_name from public.profiles p where p.id = ev.host_id;
    is_manager := d.channel = 'push' and n.event_id is not null and public.is_event_manager_for(n.event_id, d.user_id);

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
        when n.event_id is null then null
        when is_manager then '/events/' || n.event_id
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

-- Backoff after attempt n (1-based): 1m, 5m, 30m, 2h, 6h, 12h (~21h in total), then failed.
create or replace function public.delivery_backoff(p_attempts int)
returns interval
language sql
immutable
set search_path = ''
as $$
  select (array[interval '1 minute', interval '5 minutes', interval '30 minutes',
                interval '2 hours', interval '6 hours', interval '12 hours'])[p_attempts];
$$;

-- p_outcome: 'sent' | 'temporary' (retry with backoff) | 'permanent' (give up).
-- Error code 'DeviceNotRegistered' removes the push token (its deliveries cascade).
create or replace function public.complete_delivery(
  p_id uuid,
  p_outcome text,
  p_provider_id text default null,
  p_error text default null,
  p_now timestamptz default now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.notification_deliveries;
  wait interval;
begin
  select * into d from public.notification_deliveries where id = p_id for update;
  if not found or d.status <> 'sending' then
    return coalesce(d.status, 'not_found');
  end if;

  if p_outcome = 'sent' then
    update public.notification_deliveries
    set status = 'sent', sent_at = p_now, provider_message_id = left(p_provider_id, 200),
        locked_until = null, last_error = null
    where id = p_id;
    return 'sent';
  end if;

  if p_error = 'DeviceNotRegistered' and d.push_token_id is not null then
    delete from public.push_tokens where id = d.push_token_id;
    return 'token_removed';
  end if;

  wait := public.delivery_backoff(d.attempts);
  if p_outcome = 'temporary' and wait is not null then
    update public.notification_deliveries
    set status = 'pending', next_attempt_at = p_now + wait, locked_until = null, last_error = left(p_error, 200)
    where id = p_id;
    return 'retry';
  end if;

  update public.notification_deliveries
  set status = 'failed', locked_until = null, last_error = left(coalesce(p_error, p_outcome), 200)
  where id = p_id;
  return 'failed';
end;
$$;

revoke execute on function public.complete_delivery(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.complete_delivery(uuid, text, text, text, timestamptz) to service_role;

-- Expo push receipts are available ~15 minutes after sending.
create or replace function public.due_push_receipts(p_limit int default 300, p_now timestamptz default now())
returns table (delivery_id uuid, ticket_id text)
language sql
stable
security definer
set search_path = ''
as $$
  select d.id, d.provider_message_id
  from public.notification_deliveries d
  where d.channel = 'push' and d.status = 'sent' and d.receipt_checked_at is null
    and d.provider_message_id is not null and d.sent_at <= p_now - interval '15 minutes'
  order by d.sent_at
  limit p_limit;
$$;

revoke execute on function public.due_push_receipts(int, timestamptz) from public, anon, authenticated;
grant execute on function public.due_push_receipts(int, timestamptz) to service_role;

create or replace function public.record_push_receipt(
  p_delivery_id uuid, p_status text, p_error text default null, p_now timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_id uuid;
begin
  update public.notification_deliveries
  set receipt_checked_at = p_now,
      last_error = case when p_status = 'error' then left(coalesce(p_error, 'receipt_error'), 200) else last_error end
  where id = p_delivery_id
  returning push_token_id into token_id;

  if p_status = 'error' and p_error = 'DeviceNotRegistered' and token_id is not null then
    delete from public.push_tokens where id = token_id;
  end if;
end;
$$;

revoke execute on function public.record_push_receipt(uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_push_receipt(uuid, text, text, timestamptz) to service_role;

-- Hard bounce / spam complaint from the email provider (email-events function): forget the address.
create or replace function public.email_bounced(p_provider_message_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  delete from public.rsvp_email_subscriptions s
  using public.notification_deliveries d
  where d.channel = 'email' and d.provider_message_id = p_provider_message_id and s.rsvp_id = d.rsvp_id;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.email_bounced(text) from public, anon, authenticated;
grant execute on function public.email_bounced(text) to service_role;
