-- Notification delivery system, part 1: registry, outbox, enqueue API, quiet hours.
-- See openspec/changes/add-guest-updates/design.md §1-§4, §7.
--
-- HOW TO ADD A NOTIFICATION KIND (other changes):
--   1. In your own migration: insert into public.notification_kinds (kind, urgent, channels, stale_after_start)
--      values ('my_kind', false, array['push','email'], true);
--   2. Add the kind to NOTIFICATION_KINDS in packages/shared/src/notifications/kinds.ts, its strings under
--      notifications.<kind> in packages/shared/src/i18n/{en,sv}.json and a template in templates.ts.
--      supabase/tests/08_notifications_core.test.sql asserts the DB registry equals the shared list.
--   3. Enqueue from your definer function / trigger with public.enqueue_notification(...).
--      Never call push/email providers directly.

create table public.notification_kinds (
  kind text primary key check (kind ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- Urgent kinds bypass quiet hours and per-recipient rate limits.
  urgent boolean not null default false,
  channels text[] not null check (channels <@ array['push', 'email'] and cardinality(channels) > 0),
  -- Drop (instead of send) when the event has started by send time.
  stale_after_start boolean not null default false
);

insert into public.notification_kinds (kind, urgent, channels, stale_after_start) values
  ('rsvp_email_confirmation', true, array['email'], false),
  ('event_changed', false, array['push', 'email'], false),
  ('event_cancelled', true, array['push', 'email'], false),
  ('event_reminder', false, array['push', 'email'], true),
  ('announcement', false, array['push', 'email'], true),
  ('rsvp_digest', false, array['push'], false);

alter table public.notification_kinds enable row level security;

create policy "notification_kinds: readable by signed-in users"
on public.notification_kinds for select
to authenticated
using (true);

-- One row per logical message. Recipients are resolved at fan-out (send) time.
-- payload holds only what can't be read at send time. NEVER email addresses.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  kind text not null references public.notification_kinds (kind),
  event_id uuid references public.events (id) on delete cascade,
  audience text not null check (audience in ('event_attendees', 'event_managers', 'rsvp', 'user')),
  target_rsvp_id uuid references public.rsvps (id) on delete cascade,
  target_user_id uuid references public.profiles (id) on delete cascade,
  subject_id uuid,
  exclude_user_id uuid,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  not_before timestamptz not null default now(),
  dedupe_key text unique,
  coalesce_key text,
  state text not null default 'pending' check (state in ('pending', 'fanned_out', 'cancelled', 'skipped')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint notifications_target check (
    (audience = 'rsvp') = (target_rsvp_id is not null)
    and (audience = 'user') = (target_user_id is not null)
    and (audience not in ('event_attendees', 'event_managers') or event_id is not null)
  )
);

create unique index notifications_coalesce_pending_idx
on public.notifications (coalesce_key)
where state = 'pending';

create index notifications_due_idx on public.notifications (not_before) where state = 'pending';
create index notifications_event_idx on public.notifications (event_id, kind, state);
create index notifications_subject_idx on public.notifications (subject_id) where subject_id is not null;

alter table public.notifications enable row level security;
-- No policies: only security-definer functions and the service role touch this table.

-- One row per recipient x channel. Cascades remove pending sends for withdrawn RSVPs,
-- deleted accounts and removed devices.
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications (id) on delete cascade,
  channel text not null check (channel in ('push', 'email')),
  user_id uuid references public.profiles (id) on delete cascade,
  push_token_id uuid, -- FK added with push_tokens (next migration)
  rsvp_id uuid references public.rsvps (id) on delete cascade,
  urgent boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  provider_message_id text,
  receipt_checked_at timestamptz,
  last_error text check (char_length(last_error) <= 200),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint deliveries_recipient check (
    (channel = 'push' and push_token_id is not null and user_id is not null and rsvp_id is null)
    or (channel = 'email' and rsvp_id is not null and push_token_id is null and user_id is null)
  ),
  constraint deliveries_unique_push unique (notification_id, push_token_id),
  constraint deliveries_unique_email unique (notification_id, rsvp_id)
);

create index notification_deliveries_due_idx
on public.notification_deliveries (next_attempt_at)
where status in ('pending', 'sending');

create index notification_deliveries_receipts_idx
on public.notification_deliveries (sent_at)
where channel = 'push' and status = 'sent' and receipt_checked_at is null;

alter table public.notification_deliveries enable row level security;
-- No policies: worker (service role) only.

revoke all on public.notifications, public.notification_deliveries from anon, authenticated;
revoke insert, update, delete on public.notification_kinds from anon, authenticated;

-- Merge two payload objects: arrays are unioned (order kept, no duplicates), other keys take the new value.
create or replace function public.merge_notification_payload(p_old jsonb, p_new jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(k.key,
    case
      when jsonb_typeof(p_old -> k.key) = 'array' and jsonb_typeof(p_new -> k.key) = 'array' then (
        select coalesce(jsonb_agg(u.v order by u.ord), '[]'::jsonb)
        from (
          select distinct on (x.v) x.v, x.ord
          from (
            select a.v, a.ord from jsonb_array_elements(p_old -> k.key) with ordinality as a(v, ord)
            union all
            select b.v, 1000000 + b.ord from jsonb_array_elements(p_new -> k.key) with ordinality as b(v, ord)
          ) x
          order by x.v, x.ord
        ) u
      )
      else coalesce(p_new -> k.key, p_old -> k.key)
    end), '{}'::jsonb)
  from (
    select jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) as key
    union
    select jsonb_object_keys(coalesce(p_new, '{}'::jsonb))
  ) k;
$$;

-- The one entry point for producers (design §4).
-- dedupe_key: a second call with the same key is a no-op returning the existing id.
-- coalesce_key: merges into a still-pending row with the same key; 'debounce' also moves not_before.
create or replace function public.enqueue_notification(
  p_kind text,
  p_event_id uuid,
  p_audience text,
  p_target_rsvp_id uuid default null,
  p_target_user_id uuid default null,
  p_subject_id uuid default null,
  p_exclude_user_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_not_before timestamptz default now(),
  p_dedupe_key text default null,
  p_coalesce_key text default null,
  p_coalesce_mode text default 'keep'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.notifications;
  new_id uuid;
begin
  if p_coalesce_mode not in ('keep', 'debounce') then
    raise exception 'invalid_coalesce_mode' using errcode = '22023';
  end if;

  for attempt in 1..3 loop
    if p_dedupe_key is not null then
      select * into existing from public.notifications where dedupe_key = p_dedupe_key;
      if found then
        return existing.id;
      end if;
    end if;

    if p_coalesce_key is not null then
      select * into existing from public.notifications
      where coalesce_key = p_coalesce_key and state = 'pending'
      for update;
      if found then
        update public.notifications
        set payload = public.merge_notification_payload(payload, coalesce(p_payload, '{}'::jsonb)),
            not_before = case when p_coalesce_mode = 'debounce' then p_not_before else not_before end
        where id = existing.id;
        return existing.id;
      end if;
    end if;

    insert into public.notifications (
      kind, event_id, audience, target_rsvp_id, target_user_id, subject_id, exclude_user_id,
      payload, not_before, dedupe_key, coalesce_key
    ) values (
      p_kind, p_event_id, p_audience, p_target_rsvp_id, p_target_user_id, p_subject_id, p_exclude_user_id,
      coalesce(p_payload, '{}'::jsonb), coalesce(p_not_before, now()), p_dedupe_key, p_coalesce_key
    )
    on conflict do nothing
    returning id into new_id;

    if new_id is not null then
      return new_id;
    end if;
    -- Lost a race with a concurrent insert of the same dedupe/coalesce key: re-read it.
  end loop;
  raise exception 'enqueue_conflict' using errcode = '40001';
end;
$$;

revoke execute on function public.enqueue_notification(text, uuid, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, text, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_notification(text, uuid, text, uuid, uuid, uuid, uuid, jsonb, timestamptz, text, text, text)
  to service_role;

-- Cancels everything still waiting for an event (e.g. on cancellation), except one kind.
create or replace function public.cancel_event_notifications(p_event_id uuid, p_except_kind text default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  update public.notifications
  set state = 'cancelled', processed_at = now()
  where event_id = p_event_id and state = 'pending'
    and (p_except_kind is null or kind <> p_except_kind);
  get diagnostics n = row_count;

  update public.notification_deliveries d
  set status = 'skipped', locked_until = null, last_error = 'cancelled'
  from public.notifications nt
  where nt.id = d.notification_id
    and nt.event_id = p_event_id
    and (p_except_kind is null or nt.kind <> p_except_kind)
    and d.status = 'pending';
  return n;
end;
$$;

revoke execute on function public.cancel_event_notifications(uuid, text) from public, anon, authenticated;
grant execute on function public.cancel_event_notifications(uuid, text) to service_role;

-- Quiet hours (design §7): non-urgent sends between 22:00 and 08:00 Europe/Stockholm move to 08:00.
create or replace function public.apply_quiet_hours(p_ts timestamptz, p_urgent boolean)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  local_ts timestamp := p_ts at time zone 'Europe/Stockholm';
  local_t time := local_ts::time;
begin
  if p_urgent or (local_t >= time '08:00' and local_t < time '22:00') then
    return p_ts;
  end if;
  if local_t < time '08:00' then
    return (local_ts::date + time '08:00') at time zone 'Europe/Stockholm';
  end if;
  return ((local_ts::date + 1) + time '08:00') at time zone 'Europe/Stockholm';
end;
$$;

-- Manager rights for an event. add-co-hosts redefines ONLY this function (to include co-hosts);
-- announcements and the event_managers audience pick that up automatically.
create or replace function public.is_event_manager(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_event_host(p_event_id);
$$;

revoke execute on function public.is_event_manager(uuid) from public, anon;
grant execute on function public.is_event_manager(uuid) to authenticated, service_role;

-- Evaluates is_event_manager(event) as another user, so recipient resolution and trigger checks reuse
-- the single definition above (which is based on auth.uid()). Restores the caller's claims afterwards.
create or replace function public.is_event_manager_for(p_event_id uuid, p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  old_claims text := current_setting('request.jwt.claims', true);
  old_sub text := current_setting('request.jwt.claim.sub', true);
  result boolean;
begin
  if p_user_id is null or p_event_id is null then
    return false;
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    result := public.is_event_manager(p_event_id);
  exception when others then
    perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
  return coalesce(result, false);
end;
$$;

revoke execute on function public.is_event_manager_for(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_event_manager_for(uuid, uuid) to service_role;

-- hit_rate_limit gains an injectable clock (p_now) so worker rate limits are testable.
drop function public.hit_rate_limit(text, int, int);

create or replace function public.hit_rate_limit(
  p_bucket text, p_max int, p_window_seconds int, p_now timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws timestamptz := to_timestamp(floor(extract(epoch from p_now) / p_window_seconds) * p_window_seconds);
  c int;
begin
  insert into public.rsvp_rate_limits (bucket, window_start, count)
  values (p_bucket, ws, 1)
  on conflict (bucket, window_start) do update set count = public.rsvp_rate_limits.count + 1
  returning count into c;
  return c <= p_max;
end;
$$;

revoke execute on function public.hit_rate_limit(text, int, int, timestamptz) from public, anon, authenticated;
grant execute on function public.hit_rate_limit(text, int, int, timestamptz) to service_role;
