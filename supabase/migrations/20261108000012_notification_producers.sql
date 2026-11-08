-- Producers (design §5): reminders, event change/cancel notifications, host RSVP digest.

-- One reminder per start time: ~24h before start, or 08:00 Stockholm on the event day for late-created
-- events (if still before start), otherwise none. Pending reminders for older start times are removed.
create or replace function public.schedule_event_reminder(p_event public.events, p_now timestamptz default now())
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  send_at timestamptz;
  morning timestamptz;
begin
  -- Deleted rather than cancelled so moving the time back to an earlier value can schedule again.
  delete from public.notifications
  where event_id = p_event.id and kind = 'event_reminder' and state = 'pending';

  if p_event.cancelled_at is not null or p_event.starts_at <= p_now then
    return null;
  end if;

  if p_event.starts_at - p_now >= interval '24 hours' then
    send_at := p_event.starts_at - interval '24 hours';
  else
    morning := ((p_event.starts_at at time zone 'Europe/Stockholm')::date + time '08:00') at time zone 'Europe/Stockholm';
    if morning > p_now and morning < p_event.starts_at then
      send_at := morning;
    else
      return null;
    end if;
  end if;

  return public.enqueue_notification(
    p_kind => 'event_reminder',
    p_event_id => p_event.id,
    p_audience => 'event_attendees',
    p_not_before => send_at,
    p_dedupe_key => 'reminder:' || p_event.id || ':' || extract(epoch from p_event.starts_at)::bigint
  );
end;
$$;

revoke execute on function public.schedule_event_reminder(public.events, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_event_reminder(public.events, timestamptz) to service_role;

create or replace function public.events_schedule_reminder()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.schedule_event_reminder(new);
  return null;
end;
$$;

create trigger events_schedule_reminder
after insert on public.events
for each row execute function public.events_schedule_reminder();

-- Event edits and cancellation.
create or replace function public.events_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed jsonb := '[]'::jsonb;
begin
  if old.cancelled_at is null and new.cancelled_at is not null then
    perform public.cancel_event_notifications(new.id);
    perform public.enqueue_notification(
      p_kind => 'event_cancelled',
      p_event_id => new.id,
      p_audience => 'event_attendees',
      p_dedupe_key => 'event_cancelled:' || new.id
    );
    perform public.kick_notifications_worker();
    return null;
  end if;

  if new.cancelled_at is not null then
    return null;
  end if;

  if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
    changed := changed || '["time"]'::jsonb;
  end if;
  if new.location_text is distinct from old.location_text
     or new.place_name is distinct from old.place_name
     or new.latitude is distinct from old.latitude
     or new.longitude is distinct from old.longitude then
    changed := changed || '["location"]'::jsonb;
  end if;

  if jsonb_array_length(changed) > 0 then
    -- Debounced: several edits within 5 minutes become one notification with the latest details.
    perform public.enqueue_notification(
      p_kind => 'event_changed',
      p_event_id => new.id,
      p_audience => 'event_attendees',
      p_payload => jsonb_build_object('changed', changed),
      p_not_before => now() + interval '5 minutes',
      p_coalesce_key => 'event_changed:' || new.id,
      p_coalesce_mode => 'debounce'
    );
  end if;

  if new.starts_at is distinct from old.starts_at then
    perform public.schedule_event_reminder(new);
  end if;
  return null;
end;
$$;

create trigger events_notify
after update on public.events
for each row execute function public.events_notify();

-- Host reply digest: at most one push per event per 15 minutes; a burst within the first minute
-- collapses into the first push. Withdrawals (deletes) and managers' own RSVPs don't count.
create or replace function public.rsvps_notify_digest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_sent timestamptz;
begin
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

create trigger rsvps_notify_digest
after insert or update of status on public.rsvps
for each row execute function public.rsvps_notify_digest();

revoke execute on function public.events_schedule_reminder() from public, anon, authenticated;
revoke execute on function public.events_notify() from public, anon, authenticated;
revoke execute on function public.rsvps_notify_digest() from public, anon, authenticated;
