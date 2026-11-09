-- Date polls (change: add-date-polls). See openspec/changes/add-date-polls/design.md.
--
-- "Date pending" = events.starts_at is null (design §1). Poll writes only through the security-definer
-- RPCs below; they set the transaction-local flag `checkin.poll_rpc` so events_guard lets them change the
-- time columns of a pending event. Host-side actions are open to every event manager (owner + co-hosts,
-- add-co-hosts); cancelling stays owner-only (events_guard). Picking converts votes into RSVPs through the
-- capacity-aware admission path of add-guest-capacity (lock_open_event + save_rsvp_locked).

-- 1. Events: nullable start, poll columns -------------------------------------------------------------

alter table public.events
  alter column starts_at drop not null,
  add column poll_closes_at timestamptz,
  add column date_picked_at timestamptz,
  add constraint events_end_requires_start check (ends_at is null or starts_at is not null),
  add constraint events_picked_has_start check (date_picked_at is null or starts_at is not null);

comment on column public.events.starts_at is
  'Null while the date is pending (a date poll). event_ended_at() is then null, so a pending event is never past.';
comment on column public.events.poll_closes_at is 'Optional voting deadline of a date poll. Ignored after the pick.';
comment on column public.events.date_picked_at is 'When a poll option was picked (marks the event as "was a poll").';

-- 2. Tables ---------------------------------------------------------------------------------------------

create type public.vote_choice as enum ('yes', 'if_needed', 'no');

create table public.date_poll_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz,
  -- Anonymous tallies kept after the pick (the individual votes are deleted then).
  final_yes int,
  final_if_needed int,
  final_no int,
  created_at timestamptz not null default now(),
  constraint date_poll_options_end_after_start check (ends_at is null or ends_at > starts_at),
  -- Deferred so set_poll_options can swap two options' times in one call.
  constraint date_poll_options_unique_start unique (event_id, starts_at) deferrable initially deferred
);

create table public.date_poll_voters (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  -- SHA-256 (hex) of the browser's guest token, same as rsvps. The raw token is never stored.
  guest_token_hash text check (guest_token_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 50),
  -- clock_timestamp(): taken under the event lock, so created_at order = the order people first voted
  -- (used to admit Yes voters on pick when capacity is short).
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default now(),
  constraint date_poll_voters_one_identity check ((user_id is null) <> (guest_token_hash is null)),
  constraint date_poll_voters_unique_user unique (event_id, user_id),
  constraint date_poll_voters_unique_guest unique (event_id, guest_token_hash)
);

create index date_poll_voters_event_idx on public.date_poll_voters (event_id, created_at, id);

create table public.date_poll_votes (
  voter_id uuid not null references public.date_poll_voters (id) on delete cascade,
  option_id uuid not null references public.date_poll_options (id) on delete cascade,
  choice public.vote_choice not null,
  primary key (voter_id, option_id)
);

create index date_poll_votes_option_idx on public.date_poll_votes (option_id, choice);

-- 3. RLS ------------------------------------------------------------------------------------------------
-- No anon policies and no insert/update policies: writes go only through the RPCs below. Managers (owner and
-- co-hosts) read everything of their events; a signed-in voter reads and deletes their own voter row.

alter table public.date_poll_options enable row level security;
alter table public.date_poll_voters enable row level security;
alter table public.date_poll_votes enable row level security;

create policy "date_poll_options: managers can read"
on public.date_poll_options for select
to authenticated
using (public.is_event_manager(event_id));

create policy "date_poll_voters: manager or self can read"
on public.date_poll_voters for select
to authenticated
using (public.is_event_manager(event_id) or user_id = (select auth.uid()));

-- Manager removes a voter (spam); a signed-in voter withdraws. Votes cascade.
create policy "date_poll_voters: manager or self can delete"
on public.date_poll_voters for delete
to authenticated
using (public.is_event_manager(event_id) or user_id = (select auth.uid()));

-- Avoids re-evaluating the voters policy (and its helpers) per vote row.
create or replace function public.can_read_voter(p_voter_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.date_poll_voters v
    where v.id = p_voter_id
      and (public.is_event_manager(v.event_id) or v.user_id = (select auth.uid()))
  );
$$;

revoke execute on function public.can_read_voter(uuid) from public, anon;
grant execute on function public.can_read_voter(uuid) to authenticated;

create policy "date_poll_votes: readable with their voter"
on public.date_poll_votes for select
to authenticated
using (public.can_read_voter(voter_id));

-- Live results for managers. Every ballot write also touches its voter row (updated_at), so subscribing to
-- voters (filtered by event_id) catches vote changes too; votes themselves are not published.
alter publication supabase_realtime add table public.date_poll_voters;
alter publication supabase_realtime add table public.date_poll_options;

create trigger date_poll_voters_updated_at
before update on public.date_poll_voters
for each row execute function public.set_updated_at();

-- 4. events_guard ---------------------------------------------------------------------------------------
-- Unchanged from add-co-hosts, plus (design §4):
--   * a pending event (null start), its deadline and its pick can only be written by the poll RPCs;
--   * a dated event can never become pending again;
--   * picking a date is not a "time change" (no time_changed_at).
create or replace function public.events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  poll_rpc boolean := coalesce(current_setting('checkin.poll_rpc', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if (new.starts_at is null or new.poll_closes_at is not null or new.date_picked_at is not null) and not poll_rpc then
      raise exception 'start_required' using errcode = 'P0001';
    end if;
    if new.starts_at <= now() then
      raise exception 'start_in_past' using errcode = 'P0001';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.host_id is distinct from old.host_id then
    raise exception 'host_immutable' using errcode = 'P0001';
  end if;
  -- Cancel / un-cancel is owner-only (co-hosts can edit everything else). Service role and
  -- maintenance jobs (no auth.uid()) are not restricted.
  if new.cancelled_at is distinct from old.cancelled_at and uid is not null and uid <> old.host_id then
    raise exception 'owner_only' using errcode = 'P0001';
  end if;
  -- Null for a pending event: never ended.
  if public.event_ended_at(old) < now() then
    raise exception 'event_ended' using errcode = 'P0001';
  end if;
  -- A cover must be in the editor's own folder or the event's folder, so nobody can point the
  -- event at an arbitrary object.
  if new.cover_path is distinct from old.cover_path and new.cover_path is not null and uid is not null then
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

-- 5. Closed-for-RSVP checks -----------------------------------------------------------------------------
-- event_ended_at() needs no change: coalesce(null, null + 12h) is null, so `< now()` is never true.

create or replace function public.open_event_for_token(p_token text)
returns public.events
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  select e.* into ev
  from public.event_invites i
  join public.events e on e.id = i.event_id
  where i.token = p_token and i.revoked_at is null;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if ev.cancelled_at is not null or public.event_ended_at(ev) < now() then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  if ev.starts_at is null then
    raise exception 'date_pending' using errcode = 'P0001';
  end if;
  return ev;
end;
$$;

revoke execute on function public.open_event_for_token(text) from public, anon, authenticated;

-- add-guest-capacity's lock for admitting answers, plus: no RSVPs while the date is pending.
create or replace function public.lock_open_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  ev := public.lock_event(p_event_id);
  if ev.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if ev.cancelled_at is not null or public.event_ended_at(ev) < now() then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  if ev.starts_at is null then
    raise exception 'date_pending' using errcode = 'P0001';
  end if;
  return ev;
end;
$$;

revoke execute on function public.lock_open_event(uuid) from public, anon, authenticated;

-- 6. Poll helpers ---------------------------------------------------------------------------------------

create or replace function public.max_poll_options()
returns int language sql immutable set search_path = '' as $$ select 4 $$;

create or replace function public.min_poll_options()
returns int language sql immutable set search_path = '' as $$ select 2 $$;

-- Validates a full option set and a deadline. p_options: [{id?, starts_at, ends_at?}]. Options listed in
-- p_keep (unchanged existing options) may already have passed; every other start must be in the future.
-- The deadline must be in the future and no later than the earliest future option; an unchanged deadline
-- that has already passed is accepted as is (the poll simply stays closed).
create or replace function public.validate_poll_options(
  p_options jsonb,
  p_closes_at timestamptz,
  p_keep uuid[] default '{}',
  p_old_closes_at timestamptz default null
)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  o jsonb;
  s timestamptz;
  e timestamptz;
  earliest_open timestamptz;
  n int;
begin
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'poll_option_count' using errcode = 'P0001';
  end if;
  n := jsonb_array_length(p_options);
  if n < public.min_poll_options() or n > public.max_poll_options() then
    raise exception 'poll_option_count' using errcode = 'P0001';
  end if;
  for o in select * from jsonb_array_elements(p_options) loop
    s := (o ->> 'starts_at')::timestamptz;
    e := nullif(o ->> 'ends_at', '')::timestamptz;
    if s is null then
      raise exception 'start_required' using errcode = 'P0001';
    end if;
    if s <= now() and not coalesce(nullif(o ->> 'id', '')::uuid = any (p_keep), false) then
      raise exception 'option_in_past' using errcode = 'P0001';
    end if;
    if e is not null and e <= s then
      raise exception 'end_before_start' using errcode = 'P0001';
    end if;
    if s > now() and (earliest_open is null or s < earliest_open) then
      earliest_open := s;
    end if;
  end loop;
  if (select count(distinct (x ->> 'starts_at')::timestamptz) from jsonb_array_elements(p_options) x) < n then
    raise exception 'option_duplicate' using errcode = 'P0001';
  end if;
  if p_closes_at is not null
     and not coalesce(p_closes_at = p_old_closes_at and p_closes_at <= now(), false)
     and (p_closes_at <= now() or earliest_open is null or p_closes_at > earliest_open) then
    raise exception 'deadline_invalid' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.validate_poll_options(jsonb, timestamptz, uuid[], timestamptz) from public, anon, authenticated;

-- 7. Host RPCs ------------------------------------------------------------------------------------------

-- Creates a date-pending event owned by the caller with 2-4 options. p_event carries the same fields as a
-- direct insert (title, location_text, ..., capacity); starts_at/ends_at are ignored. The invite token is
-- created by the events_create_invite trigger as for any event.
create or replace function public.create_poll_event(p_event jsonb, p_options jsonb, p_closes_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  e public.events;
  new_id uuid;
  tok text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  perform public.validate_poll_options(p_options, p_closes_at);

  e := jsonb_populate_record(null::public.events, coalesce(p_event, '{}'::jsonb));
  perform set_config('checkin.poll_rpc', 'on', true);
  insert into public.events (
    host_id, title, description, starts_at, ends_at, time_zone, location_text, place_name, latitude, longitude,
    cover_path, theme, guest_list_visible, allow_plus_ones, max_plus_ones, capacity, poll_closes_at
  ) values (
    uid, e.title, e.description, null, null, coalesce(e.time_zone, 'Europe/Stockholm'), e.location_text,
    e.place_name, e.latitude, e.longitude, e.cover_path, coalesce(e.theme, 'sunset'),
    coalesce(e.guest_list_visible, true), coalesce(e.allow_plus_ones, false), coalesce(e.max_plus_ones, 1),
    e.capacity, p_closes_at
  )
  returning id into new_id;
  perform set_config('checkin.poll_rpc', '', true);

  insert into public.date_poll_options (event_id, starts_at, ends_at)
  select new_id, (x ->> 'starts_at')::timestamptz, nullif(x ->> 'ends_at', '')::timestamptz
  from jsonb_array_elements(p_options) x;

  select token into tok from public.event_invites where event_id = new_id and revoked_at is null;
  return jsonb_build_object('event_id', new_id, 'token', tok);
end;
$$;

revoke execute on function public.create_poll_event(jsonb, jsonb, timestamptz) from public, anon;
grant execute on function public.create_poll_event(jsonb, jsonb, timestamptz) to authenticated;

-- Replaces the option set of an unpicked poll and sets (or clears) the deadline. Options sent with an
-- existing id and unchanged times keep their votes; changed or missing ones lose them. Voters left without
-- any answer are removed. Returns the number of deleted votes.
create or replace function public.set_poll_options(p_event_id uuid, p_options jsonb, p_closes_at timestamptz default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  keep uuid[];
  changed uuid[];
  deleted_votes int := 0;
  o jsonb;
  oid uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not public.is_event_manager(p_event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  ev := public.lock_event(p_event_id);
  if ev.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if ev.cancelled_at is not null then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  if ev.starts_at is not null then
    raise exception 'already_picked' using errcode = 'P0001';
  end if;

  -- Unchanged existing options (same id, same start and end).
  select coalesce(array_agg(d.id), '{}') into keep
  from public.date_poll_options d
  join jsonb_array_elements(coalesce(p_options, '[]'::jsonb)) x on nullif(x ->> 'id', '')::uuid = d.id
  where d.event_id = ev.id
    and d.starts_at = (x ->> 'starts_at')::timestamptz
    and d.ends_at is not distinct from nullif(x ->> 'ends_at', '')::timestamptz;

  perform public.validate_poll_options(p_options, p_closes_at, keep, ev.poll_closes_at);

  -- Existing options that are re-timed keep their id but lose their votes.
  select coalesce(array_agg(d.id), '{}') into changed
  from public.date_poll_options d
  join jsonb_array_elements(p_options) x on nullif(x ->> 'id', '')::uuid = d.id
  where d.event_id = ev.id and not (d.id = any (keep));

  select count(*) into deleted_votes
  from public.date_poll_votes v
  join public.date_poll_options d on d.id = v.option_id
  where d.event_id = ev.id and not (d.id = any (keep));

  delete from public.date_poll_votes v using public.date_poll_options d
  where d.id = v.option_id and d.id = any (changed);
  delete from public.date_poll_options d
  where d.event_id = ev.id and not (d.id = any (keep)) and not (d.id = any (changed));

  for o in select * from jsonb_array_elements(p_options) loop
    oid := nullif(o ->> 'id', '')::uuid;
    if oid = any (changed) then
      update public.date_poll_options
      set starts_at = (o ->> 'starts_at')::timestamptz, ends_at = nullif(o ->> 'ends_at', '')::timestamptz
      where id = oid;
    elsif oid is null or not (oid = any (keep)) then
      insert into public.date_poll_options (event_id, starts_at, ends_at)
      values (ev.id, (o ->> 'starts_at')::timestamptz, nullif(o ->> 'ends_at', '')::timestamptz);
    end if;
  end loop;

  -- Voters with no answer left.
  delete from public.date_poll_voters v
  where v.event_id = ev.id and not exists (select 1 from public.date_poll_votes x where x.voter_id = v.id);

  if p_closes_at is distinct from ev.poll_closes_at then
    perform set_config('checkin.poll_rpc', 'on', true);
    update public.events set poll_closes_at = p_closes_at where id = ev.id;
    perform set_config('checkin.poll_rpc', '', true);
  end if;
  return deleted_votes;
end;
$$;

revoke execute on function public.set_poll_options(uuid, jsonb, timestamptz) from public, anon;
grant execute on function public.set_poll_options(uuid, jsonb, timestamptz) to authenticated;

-- Picks the winning option (design §5): sets the date, converts Yes -> Going and If needed -> Maybe through
-- the capacity-aware admission path (voters in the order they first voted, so who doesn't fit is waitlisted
-- in that order; converted answers carry no plus-ones), keeps anonymous final tallies and deletes the votes.
create or replace function public.pick_poll_option(p_option_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  opt public.date_poll_options;
  ev public.events;
  v record;
  saved public.rsvps;
  n_going int := 0;
  n_waitlisted int := 0;
  n_maybe int := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into opt from public.date_poll_options where id = p_option_id;
  if opt.id is null or not public.is_event_manager(opt.event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- The event lock serializes this with concurrent picks, votes and RSVPs (events -> rsvps/voters order).
  ev := public.lock_event(opt.event_id);
  if ev.cancelled_at is not null then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  if ev.starts_at is not null then
    raise exception 'already_picked' using errcode = 'P0001';
  end if;
  select * into opt from public.date_poll_options where id = p_option_id;
  if opt.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if opt.starts_at <= now() then
    raise exception 'option_passed' using errcode = 'P0001';
  end if;

  -- The flag lets events_guard accept the time change and keeps the converted RSVPs out of the host's
  -- reply digest (rsvps_notify_digest); events_notify schedules the reminder.
  perform set_config('checkin.poll_rpc', 'on', true);
  update public.events
  set starts_at = opt.starts_at, ends_at = opt.ends_at, date_picked_at = now()
  where id = ev.id;
  ev := public.lock_open_event(ev.id);

  update public.date_poll_options d
  set final_yes = (select count(*) from public.date_poll_votes x where x.option_id = d.id and x.choice = 'yes'),
      final_if_needed = (select count(*) from public.date_poll_votes x where x.option_id = d.id and x.choice = 'if_needed'),
      final_no = (select count(*) from public.date_poll_votes x where x.option_id = d.id and x.choice = 'no')
  where d.event_id = ev.id;

  for v in
    select pv.id, pv.user_id, pv.guest_token_hash, pv.display_name, x.choice
    from public.date_poll_voters pv
    join public.date_poll_votes x on x.voter_id = pv.id and x.option_id = opt.id
    where pv.event_id = ev.id and x.choice in ('yes', 'if_needed')
    order by pv.created_at, pv.id
  loop
    saved := public.save_rsvp_locked(
      ev, v.user_id, v.guest_token_hash, v.display_name,
      case when v.choice = 'yes' then 'going' else 'maybe' end::public.rsvp_status,
      0, false
    );
    if saved.status = 'going' then
      n_going := n_going + 1;
    elsif saved.status = 'waitlisted' then
      n_waitlisted := n_waitlisted + 1;
    else
      n_maybe := n_maybe + 1;
    end if;
  end loop;

  -- "Date picked" push to every signed-in voter, whatever they answered (web voters gave no email).
  for v in select pv.user_id from public.date_poll_voters pv where pv.event_id = ev.id and pv.user_id is not null loop
    perform public.enqueue_notification(
      p_kind => 'date_picked',
      p_event_id => ev.id,
      p_audience => 'user',
      p_target_user_id => v.user_id,
      p_dedupe_key => 'date_picked:' || ev.id || ':' || v.user_id
    );
  end loop;

  delete from public.date_poll_voters where event_id = ev.id;
  perform set_config('checkin.poll_rpc', '', true);

  return jsonb_build_object(
    'starts_at', opt.starts_at,
    'ends_at', opt.ends_at,
    'going', n_going,
    'waitlisted', n_waitlisted,
    'maybe', n_maybe
  );
end;
$$;

revoke execute on function public.pick_poll_option(uuid) from public, anon;
grant execute on function public.pick_poll_option(uuid) to authenticated;

-- 8. Voting ---------------------------------------------------------------------------------------------

-- Replaces one voter's ballot on an event the caller has locked. p_votes: [{option_id, choice}] (omitted
-- options = unanswered). Raises poll_closed / option_passed / option_not_found / no_votes / rate_limited.
create or replace function public.save_ballot_locked(
  ev public.events,
  p_user_id uuid,
  p_guest_hash text,
  p_display_name text,
  p_votes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  voter public.date_poll_voters;
  b jsonb;
  opt public.date_poll_options;
  n int;
begin
  if ev.cancelled_at is not null then
    raise exception 'event_closed' using errcode = 'P0001';
  end if;
  if ev.starts_at is not null or (ev.poll_closes_at is not null and ev.poll_closes_at <= now()) then
    raise exception 'poll_closed' using errcode = 'P0001';
  end if;
  if p_votes is null or jsonb_typeof(p_votes) <> 'array' or jsonb_array_length(p_votes) = 0 then
    raise exception 'no_votes' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_votes) > public.max_poll_options() then
    raise exception 'option_not_found' using errcode = 'P0001';
  end if;
  for b in select * from jsonb_array_elements(p_votes) loop
    if b ->> 'choice' is null or not ((b ->> 'choice') = any (enum_range(null::public.vote_choice)::text[])) then
      raise exception 'invalid_choice' using errcode = 'P0001';
    end if;
    select * into opt from public.date_poll_options
    where id = public.try_uuid(b ->> 'option_id') and event_id = ev.id;
    if opt.id is null then
      raise exception 'option_not_found' using errcode = 'P0001';
    end if;
    if opt.starts_at <= now() then
      raise exception 'option_passed' using errcode = 'P0001';
    end if;
  end loop;
  select count(distinct x ->> 'option_id') into n from jsonb_array_elements(p_votes) x;
  if n <> jsonb_array_length(p_votes) then
    raise exception 'option_not_found' using errcode = 'P0001';
  end if;

  if p_user_id is not null then
    select * into voter from public.date_poll_voters where event_id = ev.id and user_id = p_user_id for update;
  else
    select * into voter from public.date_poll_voters where event_id = ev.id and guest_token_hash = p_guest_hash for update;
  end if;

  if voter.id is null then
    -- Same cap as RSVPs; existing voters can always change their ballot.
    if (select count(*) from public.date_poll_voters where event_id = ev.id) >= public.max_rsvps_per_event() then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    insert into public.date_poll_voters (event_id, user_id, guest_token_hash, display_name)
    values (ev.id, p_user_id, case when p_user_id is null then p_guest_hash end, left(btrim(p_display_name), 50))
    returning * into voter;
  else
    -- Touching the row also tells Realtime subscribers that the ballot changed.
    update public.date_poll_voters
    set display_name = left(btrim(p_display_name), 50), updated_at = now()
    where id = voter.id
    returning * into voter;
  end if;

  delete from public.date_poll_votes where voter_id = voter.id;
  insert into public.date_poll_votes (voter_id, option_id, choice)
  select voter.id, (x ->> 'option_id')::uuid, (x ->> 'choice')::public.vote_choice
  from jsonb_array_elements(p_votes) x;

  return public.my_votes_json(voter.id);
end;
$$;

-- The caller's own ballot as shown back to them.
create or replace function public.my_votes_json(p_voter_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when v.id is not null then jsonb_build_object(
    'display_name', v.display_name,
    'votes', coalesce((select jsonb_object_agg(x.option_id, x.choice) from public.date_poll_votes x where x.voter_id = v.id),
                      '{}'::jsonb)
  ) end
  from public.date_poll_voters v where v.id = p_voter_id;
$$;

revoke execute on function public.save_ballot_locked(public.events, uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.my_votes_json(uuid) from public, anon, authenticated;

-- Resolves the event of an active invite link and locks it.
create or replace function public.lock_event_for_token(p_token text)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
  ev public.events;
begin
  select i.event_id into eid from public.event_invites i where i.token = p_token and i.revoked_at is null;
  if eid is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  ev := public.lock_event(eid);
  if ev.id is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  return ev;
end;
$$;

revoke execute on function public.lock_event_for_token(text) from public, anon, authenticated;

-- Web guest (service role, behind the per-IP rate limit of /api/votes).
create or replace function public.submit_votes(p_token text, p_guest_token text, p_display_name text, p_votes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  name text := btrim(coalesce(p_display_name, ''));
begin
  if char_length(name) = 0 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if p_guest_token is null or char_length(p_guest_token) < 22 then
    raise exception 'invalid_guest_token' using errcode = 'P0001';
  end if;
  return public.save_ballot_locked(public.lock_event_for_token(p_token), null,
                                   public.hash_guest_token(p_guest_token), name, p_votes);
end;
$$;

revoke execute on function public.submit_votes(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_votes(text, text, text, jsonb) to service_role;

create or replace function public.withdraw_votes(p_token text, p_guest_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  deleted int;
begin
  ev := public.lock_event_for_token(p_token);
  delete from public.date_poll_voters
  where event_id = ev.id and guest_token_hash = public.hash_guest_token(p_guest_token);
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

revoke execute on function public.withdraw_votes(text, text) from public, anon, authenticated;
grant execute on function public.withdraw_votes(text, text) to service_role;

-- Signed-in user (app): votes as themselves with their profile name.
create or replace function public.vote_as_user(p_token text, p_votes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  name text;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select display_name into name from public.profiles where id = uid;
  if btrim(coalesce(name, '')) = '' then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  return public.save_ballot_locked(public.lock_event_for_token(p_token), uid, null, name, p_votes);
end;
$$;

revoke execute on function public.vote_as_user(text, jsonb) from public, anon;
grant execute on function public.vote_as_user(text, jsonb) to authenticated;

create or replace function public.withdraw_votes_as_user(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ev public.events;
  deleted int;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  ev := public.lock_event_for_token(p_token);
  delete from public.date_poll_voters where event_id = ev.id and user_id = uid;
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

revoke execute on function public.withdraw_votes_as_user(text) from public, anon;
grant execute on function public.withdraw_votes_as_user(text) to authenticated;

-- 9. Guest-facing payload -------------------------------------------------------------------------------

-- Poll state of a pending event (design §6). Names only when the guest list is visible, and never for No.
-- (Takes an id, not a row, so PostgREST doesn't expose it as a computed column of events.)
create or replace function public.poll_payload(p_event_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (
    select * from public.events where id = p_event_id
  ),
  opts as (
    select d.*, d.starts_at <= now() as passed
    from public.date_poll_options d where d.event_id = p_event_id
  ),
  state as (
    select coalesce(bool_and(passed), true) as expired from opts
  )
  select jsonb_build_object(
    'closes_at', ev.poll_closes_at,
    'expired', s.expired,
    'voting_open', not s.expired and (ev.poll_closes_at is null or ev.poll_closes_at > now()),
    'voter_count', (select count(*) from public.date_poll_voters v where v.event_id = p_event_id),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'starts_at', o.starts_at,
        'ends_at', o.ends_at,
        'passed', o.passed,
        'tallies', jsonb_build_object(
          'yes', (select count(*) from public.date_poll_votes x where x.option_id = o.id and x.choice = 'yes'),
          'if_needed', (select count(*) from public.date_poll_votes x where x.option_id = o.id and x.choice = 'if_needed'),
          'no', (select count(*) from public.date_poll_votes x where x.option_id = o.id and x.choice = 'no')
        ),
        'voters', case when ev.guest_list_visible then (
          select coalesce(jsonb_agg(jsonb_build_object('display_name', v.display_name, 'choice', x.choice)
                                    order by x.choice, v.created_at, v.id), '[]'::jsonb)
          from public.date_poll_votes x
          join public.date_poll_voters v on v.id = x.voter_id
          where x.option_id = o.id and x.choice in ('yes', 'if_needed')
        ) end
      ) order by o.starts_at)
      from opts o
    ), '[]'::jsonb)
  )
  from state s cross join ev;
$$;

revoke execute on function public.poll_payload(uuid) from public, anon, authenticated;

-- Invite payload (get_invite, get_my_invite): unchanged from add-guest-capacity for dated events. A pending
-- event returns state 'date_pending' with the poll and the caller's ballot instead of counts, guests and
-- my_rsvp (it can't have RSVPs). p_voter_hash: the browser's hashed guest token (web guests).
drop function public.invite_payload(public.events, public.rsvps, boolean);

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
  host public.profiles;
  sub public.rsvp_email_subscriptions;
  going_heads int;
  voter_id uuid;
begin
  select * into host from public.profiles where id = ev.host_id;

  if ev.starts_at is null then
    if (select auth.uid()) is not null then
      select v.id into voter_id from public.date_poll_voters v where v.event_id = ev.id and v.user_id = (select auth.uid());
    elsif p_voter_hash is not null then
      select v.id into voter_id from public.date_poll_voters v where v.event_id = ev.id and v.guest_token_hash = p_voter_hash;
    end if;
    return jsonb_build_object(
      'state', 'date_pending',
      'event', jsonb_build_object(
        'title', ev.title,
        'description', ev.description,
        'starts_at', null,
        'ends_at', null,
        'time_zone', ev.time_zone,
        'location_text', ev.location_text,
        'place_name', ev.place_name,
        'latitude', ev.latitude,
        'longitude', ev.longitude,
        'cover_path', ev.cover_path,
        'theme', ev.theme,
        'time_changed_at', null,
        'guest_list_visible', ev.guest_list_visible,
        'allow_plus_ones', ev.allow_plus_ones,
        'max_plus_ones', ev.max_plus_ones,
        'capacity', ev.capacity
      ),
      'host', jsonb_build_object('display_name', host.display_name, 'avatar_path', host.avatar_path),
      'co_hosts', (
        select coalesce(jsonb_agg(jsonb_build_object('display_name', p.display_name)
                                  order by c.added_at, c.user_id), '[]'::jsonb)
        from public.event_co_hosts c
        join public.profiles p on p.id = c.user_id
        where c.event_id = ev.id and btrim(coalesce(p.display_name, '')) <> ''
      ),
      'poll', public.poll_payload(ev.id),
      'my_votes', public.my_votes_json(voter_id),
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
  end if;

  going_heads := public.event_going_heads(ev.id);
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
      'guest_list_visible', ev.guest_list_visible,
      'allow_plus_ones', ev.allow_plus_ones,
      'max_plus_ones', ev.max_plus_ones,
      'capacity', ev.capacity
    ),
    'host', jsonb_build_object('display_name', host.display_name, 'avatar_path', host.avatar_path),
    'co_hosts', (
      select coalesce(jsonb_agg(jsonb_build_object('display_name', p.display_name)
                                order by c.added_at, c.user_id), '[]'::jsonb)
      from public.event_co_hosts c
      join public.profiles p on p.id = c.user_id
      where c.event_id = ev.id and btrim(coalesce(p.display_name, '')) <> ''
    ),
    'counts', (
      select jsonb_build_object(
        'going', going_heads,
        'maybe', count(*) filter (where r.status = 'maybe'),
        'waitlist', coalesce(sum(1 + r.plus_ones) filter (where r.status = 'waitlisted'), 0),
        'spots_left', case when ev.capacity is null then null else greatest(ev.capacity - going_heads, 0) end,
        'full', ev.capacity is not null and going_heads >= ev.capacity
      )
      from public.rsvps r where r.event_id = ev.id
    ),
    -- Guests see names only for going/maybe, and only if the host allows it.
    'guests', case when ev.guest_list_visible then (
      select coalesce(jsonb_agg(jsonb_build_object('display_name', r.display_name, 'status', r.status,
                                                   'plus_ones', r.plus_ones)
                                order by r.status, r.created_at), '[]'::jsonb)
      from public.rsvps r
      where r.event_id = ev.id and r.status in ('going', 'maybe')
    ) end,
    'my_rsvp', case when me.id is not null then
      jsonb_build_object(
        'status', me.status,
        'display_name', me.display_name,
        'plus_ones', me.plus_ones,
        'waitlist_position', public.waitlist_position(me.id),
        'promoted', me.promoted_at is not null and me.status = 'going'
      )
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

revoke execute on function public.invite_payload(public.events, public.rsvps, boolean, text) from public, anon, authenticated;

-- get_invite: unchanged from add-my-invites except that it passes the browser's hash for the poll ballot.
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
  guest_hash text;
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
    guest_hash := public.hash_guest_token(p_guest_token);
    select * into me from public.rsvps r
    where r.event_id = ev.id and r.guest_token_hash = guest_hash;
    is_guest_device := me.id is not null;
  end if;

  return public.invite_payload(ev, me, is_guest_device, guest_hash);
end;
$$;

revoke execute on function public.get_invite(text, text) from public;
grant execute on function public.get_invite(text, text) to anon, authenticated, service_role;

-- 10. Notifications -------------------------------------------------------------------------------------

insert into public.notification_kinds (kind, urgent, channels, stale_after_start) values
  ('date_picked', false, array['push'], true);

-- No reminder while the date is pending (it is scheduled when a date is picked). Otherwise unchanged.
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

  if p_event.starts_at is null or p_event.cancelled_at is not null or p_event.starts_at <= p_now then
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

-- Event edits and cancellation: unchanged from add-guest-updates, except that a pending event has nobody
-- to tell about edits, and picking its date is not a change (spec: notifications around a date pick) -
-- it only schedules the reminder for the picked start.
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

  if old.starts_at is null then
    if new.starts_at is not null then
      perform public.schedule_event_reminder(new);
    end if;
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

revoke execute on function public.events_notify() from public, anon, authenticated;

-- Host reply digest: unchanged from add-guest-capacity, except that RSVPs created by a date pick are not
-- replies (the manager made the pick).
create or replace function public.rsvps_notify_digest()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  last_sent timestamptz;
begin
  if current_setting('checkin.claiming', true) = 'on' or current_setting('checkin.poll_rpc', true) = 'on' then
    return null;
  end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'waitlisted' and new.status = 'going' and new.promoted_at is not null then
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

-- 11. Retention: every earlier line is kept (add-guest-capacity version), plus pending events whose latest
-- option started more than 12 months ago (expired and cancelled polls). Picked events use the existing rule.
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

-- 12. Internal helpers are not callable by clients ------------------------------------------------------
revoke execute on function public.max_poll_options() from public, anon, authenticated;
revoke execute on function public.min_poll_options() from public, anon, authenticated;
