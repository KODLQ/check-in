-- Guest capacity (change: add-guest-capacity), migration B: plus-ones, capacity, waitlist and promotion.
-- See openspec/changes/add-guest-capacity/design.md (§3 locking, §4 functions, §11 rebase notes).
--
-- Concurrency model (design §3):
--   * Every function that ADMITS a guest (decides Going vs waitlisted) or promotes takes the event row
--     lock first (`for no key update`), always in the order events -> rsvps. Writers on one event are
--     serialized, so the "Going heads <= capacity" check and the write are atomic.
--   * Promotion is done by ONE mechanism: AFTER triggers on rsvps (a Going row deleted, or its Going heads
--     reduced) and on events (capacity changed). Every path that frees a spot therefore promotes, including
--     paths that don't go through an RPC (account-deletion cascade, claim merges, manual SQL). The trigger
--     takes the same event lock (re-entrant when the caller already holds it).
--   * Account deletion locks the user's events in id order before the cascade (profiles BEFORE DELETE),
--     so it can't deadlock with RPCs; an hourly sweep in run_retention is a safety net only.

-- 1. Columns and constraints ---------------------------------------------------------------------------

alter table public.events
  add column allow_plus_ones boolean not null default false,
  add column max_plus_ones smallint not null default 1,
  add column capacity int,
  add constraint events_max_plus_ones_range check (max_plus_ones between 1 and 5),
  -- 500 responses x (1 + 5 plus-ones).
  add constraint events_capacity_range check (capacity is null or capacity between 1 and 3000);

alter table public.rsvps
  add column plus_ones smallint not null default 0,
  add column waitlisted_at timestamptz,
  add column promoted_at timestamptz,
  add constraint rsvps_plus_ones_range check (plus_ones between 0 and 5),
  add constraint rsvps_plus_ones_only_going check (status in ('going', 'waitlisted') or plus_ones = 0),
  add constraint rsvps_waitlisted_at_iff_waitlisted check ((status = 'waitlisted') = (waitlisted_at is not null));

create index rsvps_waitlist_idx on public.rsvps (event_id, waitlisted_at, id) where status = 'waitlisted';

-- 2. Helpers -------------------------------------------------------------------------------------------

-- Heads of an event's Going answers: each guest plus their plus-ones.
create or replace function public.event_going_heads(p_event_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(1 + r.plus_ones), 0)::int
  from public.rsvps r
  where r.event_id = p_event_id and r.status = 'going';
$$;

-- Free spots, or null when the event has no capacity. Never negative (capacity may be below Going heads).
-- (Helpers take ids, not row types, so PostgREST doesn't expose them as computed columns.)
create or replace function public.event_spots_left(p_event_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when e.capacity is null then null
              else greatest(e.capacity - public.event_going_heads(e.id), 0) end
  from public.events e where e.id = p_event_id;
$$;

-- 1-based waitlist position, ordered by (waitlisted_at, id); null when not waitlisted.
create or replace function public.waitlist_position(p_rsvp_id uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select case when r.status = 'waitlisted' then (
    select count(*)::int from public.rsvps w
    where w.event_id = r.event_id and w.status = 'waitlisted'
      and (w.waitlisted_at, w.id) <= (r.waitlisted_at, r.id)
  ) end
  from public.rsvps r where r.id = p_rsvp_id;
$$;

-- The per-event mutex. Returns null (no row) when the event doesn't exist (e.g. deleted in this transaction).
create or replace function public.lock_event(p_event_id uuid)
returns public.events
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
begin
  select * into ev from public.events where id = p_event_id for no key update;
  return ev;
end;
$$;

-- Locks an event that must still accept answers (re-checked under the lock: it may have just been cancelled).
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
  return ev;
end;
$$;

-- 3. Promotion -----------------------------------------------------------------------------------------

-- Promotes waitlisted guests in (waitlisted_at, id) order; a party that doesn't fit is skipped (keeps its
-- place) and the walk continues. No-op on cancelled or ended events. Returns the promoted RSVP ids.
-- Invariant after every write under the lock: no waitlisted guest fits in the remaining spots.
create or replace function public.promote_from_waitlist(p_event_id uuid)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  w public.rsvps;
  remaining int;
begin
  ev := public.lock_event(p_event_id);
  if ev.id is null or ev.cancelled_at is not null or public.event_ended_at(ev) < now() then
    return;
  end if;
  remaining := case when ev.capacity is null then null else ev.capacity - public.event_going_heads(ev.id) end;
  if remaining is not null and remaining <= 0 then
    return;
  end if;

  for w in
    select * from public.rsvps
    where event_id = ev.id and status = 'waitlisted'
    order by waitlisted_at, id
  loop
    exit when remaining is not null and remaining <= 0;
    if remaining is null or 1 + w.plus_ones <= remaining then
      update public.rsvps
      set status = 'going', waitlisted_at = null, promoted_at = clock_timestamp()
      where id = w.id;
      remaining := remaining - (1 + w.plus_ones);
      return next w.id;
    end if;
  end loop;
end;
$$;

create or replace function public.rsvps_promote_on_free()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.promote_from_waitlist(old.event_id);
  return null;
end;
$$;

-- A Going row disappears (withdraw, removal, claim merge, account deletion cascade, manual SQL).
create trigger rsvps_promote_on_delete
after delete on public.rsvps
for each row when (old.status = 'going')
execute function public.rsvps_promote_on_free();

-- A Going row leaves Going or brings fewer plus-ones.
create trigger rsvps_promote_on_update
after update of status, plus_ones on public.rsvps
for each row when (old.status = 'going' and (new.status <> 'going' or new.plus_ones < old.plus_ones))
execute function public.rsvps_promote_on_free();

create or replace function public.events_promote_on_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.promote_from_waitlist(new.id);
  return null;
end;
$$;

-- Raising or clearing capacity frees spots. Lowering it promotes nobody and removes nobody.
-- Plus-one settings don't free spots and never touch existing answers (spec: private-events Edit event).
create trigger events_promote_on_capacity
after update of capacity on public.events
for each row when (new.capacity is distinct from old.capacity)
execute function public.events_promote_on_capacity();

-- Account deletion: take the locks of every event the user answered, in id order, before the cascade
-- deletes their rows (whose triggers then promote under locks already held). Deterministic order means two
-- deletions, or a deletion and an RPC, can't deadlock.
create or replace function public.profiles_lock_rsvp_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.events e
  where e.id in (select r.event_id from public.rsvps r where r.user_id = old.id)
  order by e.id
  for no key update;
  return old;
end;
$$;

create trigger profiles_lock_rsvp_events
before delete on public.profiles
for each row execute function public.profiles_lock_rsvp_events();

-- 4. Admission (single write path for every answer) ---------------------------------------------------

-- Saves one guest's answer on an event the caller has already locked with lock_open_event.
-- p_user_id set: the account's row; otherwise the browser's row (p_guest_hash), even if claimed since.
-- p_plus_ones null = keep the current plus-ones (Going/waitlisted) or 0. Maybe/Can't go carry none.
-- p_rename: overwrite the display name of an existing row (web guests) or keep it (app users).
-- p_existing_only: only change an existing answer (set_my_rsvp).
create or replace function public.save_rsvp_locked(
  ev public.events,
  p_user_id uuid,
  p_guest_hash text,
  p_display_name text,
  p_status public.rsvp_status,
  p_plus_ones int,
  p_rename boolean,
  p_existing_only boolean default false
)
returns public.rsvps
language plpgsql
security definer
set search_path = ''
as $$
declare
  cur public.rsvps;
  r public.rsvps;
  st public.rsvp_status := p_status;
  plus int;
  own_heads int := 0;
  others int;
  w_at timestamptz;
  p_at timestamptz;
begin
  if p_status is null or p_status = 'waitlisted' then
    raise exception 'invalid_status' using errcode = 'P0001';
  end if;

  if p_user_id is not null then
    select * into cur from public.rsvps where event_id = ev.id and user_id = p_user_id for update;
  else
    select * into cur from public.rsvps where event_id = ev.id and guest_token_hash = p_guest_hash for update;
  end if;
  if cur.id is null then
    if p_existing_only then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if (select count(*) from public.rsvps where event_id = ev.id) >= public.max_rsvps_per_event() then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  end if;

  -- Plus-ones.
  if st <> 'going' then
    plus := 0;
  elsif p_plus_ones is null then
    plus := case when cur.status in ('going', 'waitlisted') then cur.plus_ones else 0 end;
  else
    plus := p_plus_ones;
    if plus < 0 or plus > 5 then
      raise exception 'too_many_plus_ones' using errcode = 'P0001', detail = ev.max_plus_ones::text;
    end if;
    -- Re-sending an unchanged count is allowed even if the host has since lowered the max or turned
    -- plus-ones off (spec: those guests keep their plus-ones until they change their answer).
    if plus > 0 and not coalesce(cur.status in ('going', 'waitlisted') and plus = cur.plus_ones, false) then
      if not ev.allow_plus_ones then
        raise exception 'plus_ones_not_allowed' using errcode = 'P0001';
      end if;
      if plus > ev.max_plus_ones then
        raise exception 'too_many_plus_ones' using errcode = 'P0001', detail = ev.max_plus_ones::text;
      end if;
    end if;
  end if;

  -- Going vs waitlisted.
  if st = 'going' then
    if cur.status = 'going' then
      own_heads := 1 + cur.plus_ones;
    end if;
    others := public.event_going_heads(ev.id) - own_heads;
    if ev.capacity is null or others + 1 + plus <= ev.capacity then
      w_at := null;                               -- fits
    elsif cur.status = 'going' and 1 + plus <= own_heads then
      w_at := null;                               -- same or fewer heads: never demoted
    elsif cur.status = 'going' then
      raise exception 'capacity_exceeded' using errcode = 'P0001',
        detail = greatest(ev.capacity - others - own_heads, 0)::text;
    else
      st := 'waitlisted';
      -- clock_timestamp(), not now(): taken under the lock, so queue order = admission order.
      w_at := case when cur.status = 'waitlisted' then cur.waitlisted_at else clock_timestamp() end;
    end if;
  end if;

  -- "You got a spot!" stays until the guest's own answer actually changes.
  p_at := case when cur.id is not null and cur.status = st and cur.plus_ones = plus then cur.promoted_at end;

  if cur.id is null then
    insert into public.rsvps (event_id, user_id, guest_token_hash, display_name, status, plus_ones, waitlisted_at)
    values (ev.id, p_user_id, case when p_user_id is null then p_guest_hash end, left(btrim(p_display_name), 50),
            st, plus, w_at)
    returning * into r;
  else
    update public.rsvps
    set status = st,
        plus_ones = plus,
        waitlisted_at = w_at,
        promoted_at = p_at,
        display_name = case when p_rename then left(btrim(p_display_name), 50) else display_name end
    where id = cur.id
    returning * into r;
  end if;
  return r;
end;
$$;

-- Common response of the answer RPCs (the row as it is now, after any promotion it triggered).
create or replace function public.rsvp_result(p_rsvp_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', r.status,
    'display_name', r.display_name,
    'plus_ones', r.plus_ones,
    'waitlist_position', public.waitlist_position(r.id),
    'spots_left', public.event_spots_left(r.event_id)
  )
  from public.rsvps r where r.id = p_rsvp_id;
$$;

-- 5. Public RPCs ---------------------------------------------------------------------------------------

-- Web guest (service role). Replaces the 8-argument version; p_plus_ones is appended with a default so
-- every existing named or positional call keeps working and keeps the current plus-ones.
drop function public.upsert_rsvp(text, text, text, public.rsvp_status, text, text, text, text);

create or replace function public.upsert_rsvp(
  p_token text,
  p_guest_token text,
  p_display_name text,
  p_status public.rsvp_status,
  p_email text default null,
  p_email_hash text default null,
  p_email_action text default 'keep',
  p_locale text default 'en',
  p_plus_ones int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  guest_hash text;
  name text := btrim(coalesce(p_display_name, ''));
  rid uuid;
  saved public.rsvps;
  addr text := lower(btrim(coalesce(p_email, '')));
  sub public.rsvp_email_subscriptions;
  email_state text;
  loc text := case when p_locale in ('en', 'sv') then p_locale else 'en' end;
begin
  if char_length(name) = 0 then
    raise exception 'name_required' using errcode = 'P0001';
  end if;
  if p_guest_token is null or char_length(p_guest_token) < 22 then
    raise exception 'invalid_guest_token' using errcode = 'P0001';
  end if;
  if coalesce(p_email_action, 'keep') not in ('keep', 'set', 'remove') then
    raise exception 'invalid_email_action' using errcode = '22023';
  end if;
  if p_email_action = 'set'
     and (char_length(addr) not between 3 and 254 or addr !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'invalid_email' using errcode = 'P0001';
  end if;

  ev := public.open_event_for_token(p_token);
  ev := public.lock_open_event(ev.id);
  guest_hash := public.hash_guest_token(p_guest_token);

  saved := public.save_rsvp_locked(ev, null, guest_hash, name, p_status, p_plus_ones, true);
  rid := saved.id;

  select * into sub from public.rsvp_email_subscriptions where rsvp_id = rid;

  if p_email_action = 'remove' then
    delete from public.rsvp_email_subscriptions where rsvp_id = rid;
    sub := null;
  elsif p_email_action = 'set' and (sub.rsvp_id is null or sub.email <> addr) then
    -- Max 5 opt-ins per address per 24h, keyed by a salted hash computed by the web server.
    if not public.hit_rate_limit(
      'optin:' || coalesce(p_email_hash, encode(extensions.digest(addr, 'sha256'), 'hex')), 5, 86400
    ) then
      email_state := 'rate_limited';
    else
      insert into public.rsvp_email_subscriptions (rsvp_id, event_id, email, locale, consent_at, consent_version)
      values (rid, ev.id, addr, loc, clock_timestamp(), public.email_consent_version())
      on conflict (rsvp_id) do update
        set email = excluded.email,
            locale = excluded.locale,
            consent_at = excluded.consent_at,
            consent_version = excluded.consent_version,
            unsubscribe_token = public.random_url_token()
      returning * into sub;

      perform public.enqueue_notification(
        p_kind => 'rsvp_email_confirmation',
        p_event_id => ev.id,
        p_audience => 'rsvp',
        p_target_rsvp_id => rid,
        p_dedupe_key => 'email_confirm:' || rid || ':' || extract(epoch from sub.consent_at)::text
      );
      perform public.kick_notifications_worker();
    end if;
  end if;

  return public.rsvp_result(saved.id) || jsonb_build_object(
    'email_updates', jsonb_build_object(
      'state', coalesce(email_state, case when sub.rsvp_id is not null then 'on' else 'off' end),
      'masked', case when sub.rsvp_id is not null then public.mask_email(sub.email) end
    )
  );
end;
$$;

revoke execute on function public.upsert_rsvp(text, text, text, public.rsvp_status, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function public.upsert_rsvp(text, text, text, public.rsvp_status, text, text, text, text, int)
  to service_role;

-- In-app RSVP via an invite link. A first RSVP uses the profile name; changing an existing answer keeps
-- the RSVP's display name (e.g. a claimed "Sara B").
drop function public.rsvp_as_user(text, public.rsvp_status);

create or replace function public.rsvp_as_user(
  p_token text,
  p_status public.rsvp_status,
  p_plus_ones int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ev public.events;
  uid uuid := (select auth.uid());
  name text;
  saved public.rsvps;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select display_name into name from public.profiles where id = uid;
  if name is null then
    raise exception 'name_required' using errcode = 'P0001';
  end if;

  ev := public.open_event_for_token(p_token);
  ev := public.lock_open_event(ev.id);
  saved := public.save_rsvp_locked(ev, uid, null, name, p_status, p_plus_ones, false);
  return public.rsvp_result(saved.id);
end;
$$;

revoke execute on function public.rsvp_as_user(text, public.rsvp_status, int) from public, anon;
grant execute on function public.rsvp_as_user(text, public.rsvp_status, int) to authenticated;

-- My invites: change the caller's existing answer (works after the invite link was revoked).
drop function public.set_my_rsvp(uuid, public.rsvp_status);

create or replace function public.set_my_rsvp(
  p_event_id uuid,
  p_status public.rsvp_status,
  p_plus_ones int default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  ev public.events;
  saved public.rsvps;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.rsvps where event_id = p_event_id and user_id = uid) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  ev := public.lock_open_event(p_event_id);
  saved := public.save_rsvp_locked(ev, uid, null, null, p_status, p_plus_ones, false, true);
  return public.rsvp_result(saved.id);
end;
$$;

revoke execute on function public.set_my_rsvp(uuid, public.rsvp_status, int) from public, anon;
grant execute on function public.set_my_rsvp(uuid, public.rsvp_status, int) to authenticated;

-- Web guest withdraws (service role). Lock first, then delete; the delete trigger promotes.
create or replace function public.withdraw_rsvp(p_token text, p_guest_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  eid uuid;
  deleted int;
begin
  select i.event_id into eid from public.event_invites i where i.token = p_token and i.revoked_at is null;
  if eid is null then
    return false;
  end if;
  perform public.lock_event(eid);
  delete from public.rsvps r
  where r.event_id = eid and r.guest_token_hash = public.hash_guest_token(p_guest_token);
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

revoke execute on function public.withdraw_rsvp(text, text) from public, anon, authenticated;
grant execute on function public.withdraw_rsvp(text, text) to service_role;

-- Manager removes a guest, or a signed-in user withdraws their own answer (app). Replaces the direct
-- DELETE (policy dropped below). Returns false when there's nothing the caller may remove.
create or replace function public.remove_rsvp(p_rsvp_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  r public.rsvps;
  deleted int;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into r from public.rsvps where id = p_rsvp_id;
  if r.id is null or not (public.is_event_manager(r.event_id) or r.user_id is not distinct from uid) then
    return false;
  end if;
  perform public.lock_event(r.event_id);
  delete from public.rsvps where id = p_rsvp_id;
  get diagnostics deleted = row_count;
  return deleted > 0;
end;
$$;

revoke execute on function public.remove_rsvp(uuid) from public, anon;
grant execute on function public.remove_rsvp(uuid) to authenticated;

-- Manager promotes a waitlisted guest out of order. Past capacity only with p_over_capacity = true
-- (otherwise 'over_capacity' so the app can ask for confirmation and retry).
create or replace function public.promote_waitlisted(p_rsvp_id uuid, p_over_capacity boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.rsvps;
  ev public.events;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  select * into r from public.rsvps where id = p_rsvp_id;
  if r.id is null or not public.is_event_manager(r.event_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  ev := public.lock_open_event(r.event_id);
  select * into r from public.rsvps where id = p_rsvp_id;
  if r.id is null or r.status <> 'waitlisted' then
    raise exception 'not_waitlisted' using errcode = 'P0001';
  end if;
  if ev.capacity is not null
     and public.event_going_heads(ev.id) + 1 + r.plus_ones > ev.capacity
     and not coalesce(p_over_capacity, false) then
    raise exception 'over_capacity' using errcode = 'P0001',
      detail = greatest(ev.capacity - public.event_going_heads(ev.id), 0)::text;
  end if;
  update public.rsvps
  set status = 'going', waitlisted_at = null, promoted_at = clock_timestamp()
  where id = r.id
  returning * into r;
  return public.rsvp_result(r.id);
end;
$$;

revoke execute on function public.promote_waitlisted(uuid, boolean) from public, anon;
grant execute on function public.promote_waitlisted(uuid, boolean) to authenticated;

-- Direct deletes are gone: they'd lock rsvps before events. Managers use remove_rsvp, guests withdraw_rsvp
-- (web) or remove_rsvp (app). The delete triggers still promote if anything else deletes a row.
drop policy "rsvps: manager or self can delete" on public.rsvps;

-- 6. Claiming web RSVPs (add-my-invites), now capacity-aware ------------------------------------------
-- Changes: locks the affected events in id order first; a merge copies the kept answer's plus-ones and
-- waitlist place; a waitlisted browser row never replaces an account that is already Going. Spots freed by
-- deleting the browser row are filled by the delete trigger.
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

  -- Lock order events -> rsvps, events in id order.
  perform 1 from public.events e
  where e.id in (select r.event_id from public.rsvps r where r.guest_token_hash = t.guest_token_hash and r.user_id is null)
  order by e.id
  for no key update;

  perform set_config('checkin.claiming', 'on', true);

  for g in
    select * from public.rsvps
    where guest_token_hash = t.guest_token_hash and user_id is null
    order by created_at
    for update
  loop
    select * into a from public.rsvps where event_id = g.event_id and user_id = uid for update;
    if found then
      -- Merge: keep the account's row, holding the most recently updated answer (waitlisted = Going).
      if g.updated_at > a.updated_at and not (g.status = 'waitlisted' and a.status = 'going') then
        update public.rsvps
        set status = g.status, plus_ones = g.plus_ones, waitlisted_at = g.waitlisted_at, promoted_at = g.promoted_at
        where id = a.id;
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

-- 7. Guest-facing payloads -----------------------------------------------------------------------------

-- Invite payload (get_invite, get_my_invite): unchanged from add-co-hosts plus plus-one settings, capacity,
-- head-based counts, plus_ones of visible guests (never waitlisted ones) and the caller's waitlist state.
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
  going_heads int := public.event_going_heads(ev.id);
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

revoke execute on function public.invite_payload(public.events, public.rsvps, boolean) from public, anon, authenticated;

-- My invites list: adds plus_ones to the caller's answer. Otherwise unchanged from add-my-invites.
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
      'my_rsvp', jsonb_build_object('status', r.status, 'display_name', r.display_name, 'plus_ones', r.plus_ones)
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

-- 8. Notifications -------------------------------------------------------------------------------------

insert into public.notification_kinds (kind, urgent, channels, stale_after_start) values
  ('waitlist_promoted', false, array['push', 'email'], true);

-- One notification per promotion (automatic or by a manager) to that guest: push for app users, email
-- for opted-in web guests (audience 'rsvp'). A guest admitted by their own answer gets none
-- (save_rsvp_locked never sets promoted_at).
create or replace function public.rsvps_notify_promoted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A claim merge copies an older promotion onto the account's row: that is not a new promotion.
  if current_setting('checkin.claiming', true) = 'on' then
    return null;
  end if;
  perform public.enqueue_notification(
    p_kind => 'waitlist_promoted',
    p_event_id => new.event_id,
    p_audience => 'rsvp',
    p_target_rsvp_id => new.id,
    p_dedupe_key => 'waitlist_promoted:' || new.id || ':' || extract(epoch from new.promoted_at)::text
  );
  return null;
end;
$$;

revoke execute on function public.rsvps_notify_promoted() from public, anon, authenticated;

create trigger rsvps_notify_promoted
after update of status on public.rsvps
for each row when (old.status = 'waitlisted' and new.status = 'going' and new.promoted_at is not null)
execute function public.rsvps_notify_promoted();

-- Host reply digest: unchanged from add-my-invites, except that promotions from the waitlist (the system
-- or a manager moved the guest, the guest didn't reply) don't count. Joining the waitlist does.
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

-- Stale reasons: unchanged from add-guest-updates plus "promoted guest is no longer Going".
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
  if n.kind = 'waitlist_promoted' and not exists (
    select 1 from public.rsvps r where r.id = n.target_rsvp_id and r.status = 'going'
  ) then
    return 'no_longer_going';
  end if;
  return null;
end;
$$;

revoke execute on function public.notification_stale_reason(public.notifications, timestamptz) from public, anon, authenticated;

-- 9. Retention + safety sweep: every earlier line is kept (add-co-hosts version); then any active event
-- whose waitlist has a guest who fits is promoted (catches anything that bypassed the triggers).
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

-- 10. Internal helpers are not callable by clients ----------------------------------------------------

revoke execute on function public.event_going_heads(uuid) from public, anon, authenticated;
revoke execute on function public.event_spots_left(uuid) from public, anon, authenticated;
revoke execute on function public.waitlist_position(uuid) from public, anon, authenticated;
revoke execute on function public.lock_event(uuid) from public, anon, authenticated;
revoke execute on function public.lock_open_event(uuid) from public, anon, authenticated;
revoke execute on function public.promote_from_waitlist(uuid) from public, anon, authenticated;
revoke execute on function public.rsvps_promote_on_free() from public, anon, authenticated;
revoke execute on function public.events_promote_on_capacity() from public, anon, authenticated;
revoke execute on function public.profiles_lock_rsvp_events() from public, anon, authenticated;
revoke execute on function public.save_rsvp_locked(public.events, uuid, text, text, public.rsvp_status, int, boolean, boolean)
  from public, anon, authenticated;
revoke execute on function public.rsvp_result(uuid) from public, anon, authenticated;
