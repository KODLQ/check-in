-- Extensions
create extension if not exists postgis with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- Shared trigger to maintain updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Profiles: one row per auth user. display_name is null until onboarding.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(btrim(display_name)) between 1 and 50),
  avatar_path text,
  locale text check (locale in ('en', 'sv')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;

create policy "profiles: owner can read"
on public.profiles for select
to authenticated
using (id = (select auth.uid()));

create policy "profiles: owner can update"
on public.profiles for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Create a profile automatically when a user signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(btrim(left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''), 50)), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();
