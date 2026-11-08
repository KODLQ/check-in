-- Expo push tokens, one row per device (design §2, §3, §8).
create table public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique check (token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$'),
  platform text not null check (platform in ('ios', 'android')),
  -- Device language at last app start; used for push copy.
  locale text not null default 'en' check (locale in ('en', 'sv')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

alter table public.notification_deliveries
  add constraint notification_deliveries_push_token_fk
  foreign key (push_token_id) references public.push_tokens (id) on delete cascade;

alter table public.push_tokens enable row level security;

create policy "push_tokens: owner can read"
on public.push_tokens for select
to authenticated
using (user_id = (select auth.uid()));

create policy "push_tokens: owner can delete"
on public.push_tokens for delete
to authenticated
using (user_id = (select auth.uid()));

-- No insert/update policies: writes go through register_push_token, which can move a token
-- from a previous account on the same device to the caller (RLS update could not).
revoke insert, update on public.push_tokens from anon, authenticated;

create or replace function public.register_push_token(p_token text, p_platform text, p_locale text default 'en')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  loc text := case when p_locale in ('en', 'sv') then p_locale else 'en' end;
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  -- Account switch on this device: drop the previous owner's row (its pending deliveries cascade away).
  delete from public.push_tokens where token = p_token and user_id <> uid;

  insert into public.push_tokens (user_id, token, platform, locale)
  values (uid, p_token, p_platform, loc)
  on conflict (token) do update
    set platform = excluded.platform, locale = excluded.locale, last_seen_at = now();
end;
$$;

revoke execute on function public.register_push_token(text, text, text) from public, anon;
grant execute on function public.register_push_token(text, text, text) to authenticated;

create or replace function public.unregister_push_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
begin
  delete from public.push_tokens where token = p_token and user_id = (select auth.uid());
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;
