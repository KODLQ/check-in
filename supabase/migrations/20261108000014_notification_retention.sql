-- Retention for notification data (design §13). run_retention gains an injectable clock.
drop function public.run_retention();

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
end;
$$;

revoke execute on function public.run_retention(timestamptz) from public, anon, authenticated;

create index notification_deliveries_provider_idx
on public.notification_deliveries (provider_message_id)
where provider_message_id is not null;
