create table public.rsvp_rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, window_start)
);

-- No policies: reachable only from security-definer functions / service role.
alter table public.rsvp_rate_limits enable row level security;

-- Records a hit and returns true while the bucket is within its limit.
-- p_bucket should already be a hash (e.g. sha256(ip + salt) + ':' + token).
create or replace function public.hit_rate_limit(p_bucket text, p_max int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into public.rsvp_rate_limits (bucket, window_start, count)
  values (p_bucket, ws, 1)
  on conflict (bucket, window_start) do update set count = public.rsvp_rate_limits.count + 1
  returning count into c;
  return c <= p_max;
end;
$$;

revoke execute on function public.hit_rate_limit(text, int, int) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int) to service_role;

-- Data retention (see design.md): rate-limit buckets 24h, events 12 months after they end.
create or replace function public.run_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rsvp_rate_limits where window_start < now() - interval '24 hours';
  delete from public.events e where public.event_ended_at(e) < now() - interval '12 months';
end;
$$;

revoke execute on function public.run_retention() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('retention-hourly', '17 * * * *', $$select public.run_retention()$$);
