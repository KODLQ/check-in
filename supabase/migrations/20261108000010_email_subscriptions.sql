-- Guest email opt-in for event updates (design §2, §3, §11, §12).
-- Kept OUT of public.rsvps on purpose: hosts can select every rsvps column and Realtime publishes it.

create or replace function public.random_url_token()
returns text
language sql
volatile
set search_path = ''
as $$
  -- 128 random bits, base64url without padding (22 chars).
  select rtrim(translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/', '-_'), '=');
$$;

create table public.rsvp_email_subscriptions (
  rsvp_id uuid primary key references public.rsvps (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  email text not null check (
    char_length(email) between 3 and 254
    and email = lower(btrim(email))
    and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
  ),
  -- Invite-page language at opt-in; used for email copy.
  locale text not null default 'en' check (locale in ('en', 'sv')),
  consent_at timestamptz not null,
  consent_version text not null,
  unsubscribe_token text not null unique default public.random_url_token(),
  created_at timestamptz not null default now()
);

create index rsvp_email_subscriptions_event_idx on public.rsvp_email_subscriptions (event_id);

alter table public.rsvp_email_subscriptions enable row level security;
-- No policies and no grants: not even the host or the guest's own account can read it.
revoke all on public.rsvp_email_subscriptions from anon, authenticated;

-- Version of the consent text shown next to the checkbox (accountability, GDPR Art. 7(1)).
create or replace function public.email_consent_version()
returns text language sql immutable set search_path = '' as $$ select 'rsvp-updates-v1' $$;

-- "anna@gmail.com" -> "a•••@gmail.com"
create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(p_email, 1) || '•••@' || split_part(p_email, '@', 2);
$$;

-- Replaces the 4-argument version. New parameters have defaults so the old call keeps working.
drop function public.upsert_rsvp(text, text, text, public.rsvp_status);

create or replace function public.upsert_rsvp(
  p_token text,
  p_guest_token text,
  p_display_name text,
  p_status public.rsvp_status,
  p_email text default null,
  p_email_hash text default null,
  p_email_action text default 'keep',
  p_locale text default 'en'
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
  existing uuid;
  rid uuid;
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
  guest_hash := public.hash_guest_token(p_guest_token);

  select id into existing from public.rsvps
  where event_id = ev.id and guest_token_hash = guest_hash;

  if existing is null
     and (select count(*) from public.rsvps where event_id = ev.id) >= public.max_rsvps_per_event() then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.rsvps (event_id, guest_token_hash, display_name, status)
  values (ev.id, guest_hash, left(name, 50), p_status)
  on conflict (event_id, guest_token_hash)
  do update set display_name = excluded.display_name, status = excluded.status
  returning id into rid;

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

  return jsonb_build_object(
    'status', p_status,
    'display_name', left(name, 50),
    'email_updates', jsonb_build_object(
      'state', coalesce(email_state, case when sub.rsvp_id is not null then 'on' else 'off' end),
      'masked', case when sub.rsvp_id is not null then public.mask_email(sub.email) end
    )
  );
end;
$$;

revoke execute on function public.upsert_rsvp(text, text, text, public.rsvp_status, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.upsert_rsvp(text, text, text, public.rsvp_status, text, text, text, text)
  to service_role;

-- Unsubscribe by token from an email link (service role, called by the web app).
-- Same (empty) result whether or not the token exists, so it reveals nothing.
create or replace function public.unsubscribe_email(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.rsvp_email_subscriptions where unsubscribe_token = p_token;
end;
$$;

revoke execute on function public.unsubscribe_email(text) from public, anon, authenticated;
grant execute on function public.unsubscribe_email(text) to service_role;
