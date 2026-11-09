-- Event wall, part 1: tables, RLS, settings columns, storage buckets and cleanup queue
-- (change: add-event-wall, design §1, §2, §6 and "Rebase onto landed changes").
--
-- Guests never touch these tables: every read and write goes through the service-role functions in
-- 20261108000022_event_wall_functions.sql, called by the web app's /api/wall/* route handlers.
-- Author identity mirrors rsvps after add-my-invites: a post made from a browser whose RSVP was claimed
-- carries both the account id and the browser's guest-token hash, so "at least one identity", not "exactly one".

-- 1. Settings --------------------------------------------------------------------------------------------

alter table public.profiles
  add column wall_default_enabled boolean not null default true;
comment on column public.profiles.wall_default_enabled is 'Host setting: new events get this wall_enabled value.';

-- Existing events are backfilled with true by the default.
alter table public.events
  add column wall_enabled boolean not null default true;
comment on column public.events.wall_enabled is
  'Event wall on/off (add-event-wall). Togglable by managers even after the event ended or was cancelled.';

-- New events copy the host's default. Runs for every insert path (app insert, create_poll_event).
create or replace function public.events_wall_default()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.wall_enabled := coalesce((select p.wall_default_enabled from public.profiles p where p.id = new.host_id), true);
  return new;
end;
$$;

revoke execute on function public.events_wall_default() from public, anon, authenticated;

create trigger events_wall_default
before insert on public.events
for each row execute function public.events_wall_default();

-- events_guard: the add-date-polls version, plus an exception that lets an update changing ONLY
-- wall_enabled through after the event has ended or been cancelled (otherwise the host could not close
-- the photo wall afterwards). Everything else is unchanged.
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
  -- Wall toggle (add-event-wall): only wall_enabled changes -> allowed at any time. The generated column
  -- and updated_at are excluded from the comparison.
  if (to_jsonb(new) - 'wall_enabled' - 'updated_at' - 'location_point')
     = (to_jsonb(old) - 'wall_enabled' - 'updated_at' - 'location_point') then
    new.updated_at := now();
    return new;
  end if;
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

-- 2. Tables ----------------------------------------------------------------------------------------------

create table public.wall_posts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  -- Account that posted (app), or that later claimed the browser's RSVP. Cascades with account deletion.
  author_user_id uuid references public.profiles (id) on delete cascade,
  -- SHA-256 (hex) of the browser's guest token, same as rsvps. Never returned to clients.
  author_guest_hash text check (author_guest_hash ~ '^[0-9a-f]{64}$'),
  -- Snapshot kept in sync with the RSVP (guests) or profile (hosts) by triggers in part 2.
  author_display_name text not null check (char_length(btrim(author_display_name)) between 1 and 50),
  -- Posted by the owner or a co-host (shown with a host label, exempt from the photo quota).
  is_host boolean not null default false,
  body text check (body is null or char_length(body) between 1 and 500),
  photo_count int not null default 0 check (photo_count between 0 and 4),
  -- clock_timestamp(): distinct, ordered timestamps even for posts created in one transaction.
  created_at timestamptz not null default clock_timestamp(),
  constraint wall_posts_has_identity check (author_user_id is not null or author_guest_hash is not null),
  constraint wall_posts_not_empty check (body is not null or photo_count > 0)
);

create index wall_posts_event_idx on public.wall_posts (event_id, created_at desc, id desc);
create index wall_posts_event_guest_idx on public.wall_posts (event_id, author_guest_hash);
create index wall_posts_user_idx on public.wall_posts (author_user_id);

create table public.wall_photos (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.wall_posts (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  -- Identity duplicated from the post for cheap quota counts.
  author_user_id uuid references public.profiles (id) on delete cascade,
  author_guest_hash text check (author_guest_hash ~ '^[0-9a-f]{64}$'),
  is_host boolean not null default false,
  -- Paths in the private bucket `wall`: <event_id>/<upload_id>/{full,thumb}.jpg (never public URLs).
  full_path text not null unique,
  thumb_path text not null unique,
  width int not null check (width > 0),
  height int not null check (height > 0),
  position int not null check (position between 0 and 3),
  created_at timestamptz not null default now(),
  constraint wall_photos_has_identity check (author_user_id is not null or author_guest_hash is not null)
);

create index wall_photos_post_idx on public.wall_photos (post_id, position);
create index wall_photos_event_guest_idx on public.wall_photos (event_id, author_guest_hash);
create index wall_photos_event_user_idx on public.wall_photos (event_id, author_user_id);

-- Staging rows for the photo pipeline (design §5). Consumed (deleted) when a post is created; anything
-- left is purged by run_retention.
create table public.wall_uploads (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  author_user_id uuid references public.profiles (id) on delete cascade,
  author_guest_hash text check (author_guest_hash ~ '^[0-9a-f]{64}$'),
  is_host boolean not null default false,
  content_type text not null,
  size int not null check (size between 1 and 10485760),
  -- Object in the private quarantine bucket `wall-incoming`: <event_id>/<upload_id>. Never served.
  incoming_path text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'ready', 'rejected')),
  full_path text,
  thumb_path text,
  width int,
  height int,
  expires_at timestamptz not null default now() + interval '2 hours',
  created_at timestamptz not null default now(),
  constraint wall_uploads_has_identity check (author_user_id is not null or author_guest_hash is not null),
  constraint wall_uploads_ready check (status <> 'ready' or (full_path is not null and thumb_path is not null and width > 0 and height > 0))
);

create index wall_uploads_event_idx on public.wall_uploads (event_id, created_at);
create index wall_uploads_created_idx on public.wall_uploads (created_at);

create table public.wall_blocks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  guest_hash text check (guest_hash ~ '^[0-9a-f]{64}$'),
  display_name text not null,
  created_at timestamptz not null default now(),
  constraint wall_blocks_has_identity check (user_id is not null or guest_hash is not null),
  constraint wall_blocks_unique_user unique (event_id, user_id),
  constraint wall_blocks_unique_guest unique (event_id, guest_hash)
);

-- Storage objects cannot be deleted from SQL. Triggers queue paths here; the web app drains the queue
-- (synchronously for user deletes, every 10 minutes from the storage-cleanup cron for everything else).
create table public.storage_deletion_queue (
  id bigint generated always as identity primary key,
  bucket text not null check (bucket in ('wall', 'wall-incoming')),
  path text not null,
  enqueued_at timestamptz not null default now(),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  constraint storage_deletion_queue_unique unique (bucket, path)
);

create index storage_deletion_queue_due_idx on public.storage_deletion_queue (next_attempt_at);

-- 3. RLS -------------------------------------------------------------------------------------------------
-- Only wall_posts has a policy: SELECT for event managers (host Realtime) and the author's own account.
-- No insert/update/delete policies anywhere and no anon policies.

alter table public.wall_posts enable row level security;
alter table public.wall_photos enable row level security;
alter table public.wall_uploads enable row level security;
alter table public.wall_blocks enable row level security;
alter table public.storage_deletion_queue enable row level security;

revoke all on public.wall_posts, public.wall_photos, public.wall_uploads, public.wall_blocks,
  public.storage_deletion_queue from anon, authenticated;
grant select on public.wall_posts to authenticated;

create policy "wall_posts: managers and own account can read"
on public.wall_posts for select
to authenticated
using (public.is_event_manager(event_id) or author_user_id = (select auth.uid()));

-- Live wall for hosts and co-hosts (design §8). RLS limits INSERT/UPDATE delivery to managers.
alter publication supabase_realtime add table public.wall_posts;

-- 4. Storage queue triggers (design §6) ------------------------------------------------------------------
-- FK cascades fire these too, so event deletion, run_retention and account deletion are covered.

create or replace function public.wall_photos_enqueue_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.storage_deletion_queue (bucket, path)
  values ('wall', old.full_path), ('wall', old.thumb_path)
  on conflict (bucket, path) do nothing;
  return null;
end;
$$;

revoke execute on function public.wall_photos_enqueue_delete() from public, anon, authenticated;

create trigger wall_photos_enqueue_delete
after delete on public.wall_photos
for each row execute function public.wall_photos_enqueue_delete();

-- An upload row's quarantine object is always queued (deleting a missing object is a no-op). Its processed
-- renditions are queued unless a post took them over (wall_create_post inserts the photo rows first).
create or replace function public.wall_uploads_enqueue_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.storage_deletion_queue (bucket, path)
  values ('wall-incoming', old.incoming_path)
  on conflict (bucket, path) do nothing;
  if old.full_path is not null and not exists (select 1 from public.wall_photos p where p.full_path = old.full_path) then
    insert into public.storage_deletion_queue (bucket, path)
    values ('wall', old.full_path), ('wall', old.thumb_path)
    on conflict (bucket, path) do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.wall_uploads_enqueue_delete() from public, anon, authenticated;

create trigger wall_uploads_enqueue_delete
after delete on public.wall_uploads
for each row execute function public.wall_uploads_enqueue_delete();

-- 5. Private buckets (design §2, §5) ---------------------------------------------------------------------
-- No storage.objects policies for either bucket: anon and authenticated can't read, list or write.
-- Only the service role (web server) touches them; clients upload through single-use signed upload URLs
-- scoped to one pre-chosen path, and read through signed URLs valid for at most one hour.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('wall-incoming', 'wall-incoming', false, 10485760,
   array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('wall', 'wall', false, 10485760, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
