-- Event wall: tables, RLS, storage queue triggers, settings, name sync, buckets
-- (change: add-event-wall, tasks 1.1-1.5).
begin;
create extension if not exists pgtap with schema extensions;
select plan(67);

\ir fixtures/wall.psql

-- Posts made through the real write path (service role).
set local role service_role;
select wall_create_post('CoHostTest01', null, null, :'gina', 'Gina here', '{}');
select wall_create_post('CoHostTest01', null, null, :'milo', 'Milo here', '{}');
select wall_create_post(null, :'E1', :'A', null, 'Host here', '{}');
select wall_create_post(null, :'E1', :'S', null, 'Sara here', '{}');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 1.1 Tables, RLS, privileges
select has_table('public', t, t || ' exists')
from unnest(array['wall_posts', 'wall_photos', 'wall_uploads', 'wall_blocks', 'storage_deletion_queue']) t;
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.wall_posts'::regclass, 'public.wall_photos'::regclass, 'public.wall_uploads'::regclass,
  'public.wall_blocks'::regclass, 'public.storage_deletion_queue'::regclass)), 'RLS is enabled on every wall table');
select is((select count(*)::int from pg_policies where schemaname = 'public'
  and tablename in ('wall_photos', 'wall_uploads', 'wall_blocks', 'storage_deletion_queue')), 0,
  'no policies on photos, uploads, blocks and the deletion queue');
select is((select array_agg(cmd::text) from pg_policies where schemaname = 'public' and tablename = 'wall_posts'),
  array['SELECT'], 'wall_posts has only a SELECT policy');
select is((select confdeltype::text from pg_constraint where conname = 'wall_posts_event_id_fkey'), 'c', 'posts cascade with the event');
select is((select confdeltype::text from pg_constraint where conname = 'wall_posts_author_user_id_fkey'), 'c', 'posts cascade with the account');
select is((select confdeltype::text from pg_constraint where conname = 'wall_photos_post_id_fkey'), 'c', 'photos cascade with the post');
select ok(not exists (select 1 from pg_constraint where conrelid = 'public.wall_posts'::regclass and confrelid = 'public.rsvps'::regclass),
  'posts are not foreign-keyed to rsvps (withdrawing never cascades into posts)');
select throws_ok($$ insert into public.wall_posts (event_id, author_display_name, body)
  values ('c0000000-0000-0000-0000-0000000000e1', 'Nobody', 'x') $$, '23514', null, 'a post needs an author identity');
select throws_ok($$ insert into public.wall_posts (event_id, author_guest_hash, author_display_name)
  values ('c0000000-0000-0000-0000-0000000000e1', repeat('a', 64), 'Empty') $$, '23514', null, 'a post needs text or photos');

-- Seed rows in the policy-less tables so "zero rows" is meaningful.
insert into public.wall_photos (post_id, event_id, author_guest_hash, full_path, thumb_path, width, height, position)
select id, event_id, author_guest_hash, 'x/seed/full.jpg', 'x/seed/thumb.jpg', 10, 10, 0
from public.wall_posts where event_id = :'E1' and author_display_name = 'Gina';
insert into public.wall_blocks (event_id, guest_hash, display_name)
values (:'E1', public.hash_guest_token(:'xena'), 'Xena');
insert into public.wall_uploads (event_id, author_guest_hash, content_type, size, incoming_path)
values (:'E1', public.hash_guest_token(:'gina'), 'image/jpeg', 100, 'seed/incoming');

set local role anon;
:as_anon
select throws_ok(format('select count(*) from public.%I', t), '42501', null, 'anon cannot read ' || t)
from unnest(array['wall_posts', 'wall_photos', 'wall_uploads', 'wall_blocks', 'storage_deletion_queue']) t;
select throws_ok($$ insert into public.wall_posts (event_id, author_guest_hash, author_display_name, body)
  values ('c0000000-0000-0000-0000-0000000000e1', repeat('a', 64), 'Anon', 'x') $$, '42501', null, 'anon cannot insert posts');

set local role authenticated;
:as_C
select is((select count(*)::int from public.wall_posts), 0, 'a non-host user reads zero posts');
select throws_ok(format('select count(*) from public.%I', t), '42501', null, 'a non-host user cannot read ' || t)
from unnest(array['wall_photos', 'wall_uploads', 'wall_blocks', 'storage_deletion_queue']) t;
:as_D
select is((select count(*)::int from public.wall_posts where event_id = :'E1'), 0, 'a former co-host reads zero posts');
:as_S
select is((select array_agg(body) from public.wall_posts where event_id = :'E1'), array['Sara here'],
  'a signed-in guest reads only their own post');
:as_A
select is((select count(*)::int from public.wall_posts where event_id = :'E1'), 4, 'the owner reads every post (Realtime)');
:as_B
select is((select count(*)::int from public.wall_posts where event_id = :'E1'), 4, 'a co-host reads every post (Realtime)');
select throws_ok($$ update public.wall_posts set body = 'edited' $$, '42501', null, 'managers cannot update posts directly');
select throws_ok($$ delete from public.wall_posts $$, '42501', null, 'managers cannot delete posts directly');
select throws_ok($$ insert into public.wall_posts (event_id, author_user_id, author_display_name, body)
  values ('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0b1', 'Erik', 'x') $$,
  '42501', null, 'managers cannot insert posts directly');
:as_S
select throws_ok($$ delete from public.wall_posts $$, '42501', null, 'authors cannot delete directly either (API only)');
reset role;
select ok((select exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'wall_posts')),
  'wall_posts is in the Realtime publication');

-- ---------------------------------------------------------------------------------------------
-- 1.2 Deletion queue triggers
select is((select array_agg(path order by path) from public.storage_deletion_queue where path like 'x/seed/%' or path = 'seed/incoming'),
  null, 'nothing is queued before anything is deleted');
-- A photo post by S (account) on E1 and one by Pia on W2.
insert into public.wall_photos (post_id, event_id, author_user_id, full_path, thumb_path, width, height, position)
select id, event_id, author_user_id, 'e1/s/full.jpg', 'e1/s/thumb.jpg', 10, 10, 0
from public.wall_posts where event_id = :'E1' and author_display_name = 'Sara';
delete from auth.users where id = :'S';
select is((select array_agg(path order by path) from public.storage_deletion_queue where path like 'e1/s/%'),
  array['e1/s/full.jpg', 'e1/s/thumb.jpg'], 'deleting an account queues its photos'' files');
select is((select count(*)::int from public.wall_posts where event_id = :'E1' and body = 'Sara here'), 0, 'and deletes its posts on other hosts'' events');
delete from public.events where id = :'E1';
select is((select array_agg(path order by bucket, path) from public.storage_deletion_queue where path like 'x/seed/%' or path = 'seed/incoming'),
  array['x/seed/full.jpg', 'x/seed/thumb.jpg', 'seed/incoming'], 'deleting an event (cascade) queues every photo and upload path');
select is((select bucket from public.storage_deletion_queue where path = 'seed/incoming'), 'wall-incoming', 'uploads are queued in the quarantine bucket');
select is((select count(*)::int from public.wall_posts where event_id = :'E1'), 0, 'posts are gone with the event');

-- ---------------------------------------------------------------------------------------------
-- 1.3 Settings and events_guard
select is((select count(*)::int from public.events where wall_enabled is not true and id in (:'W2', :'W3', :'W4', :'W5')), 0,
  'events default to wall on');
update public.profiles set wall_default_enabled = false where id = :'C';
set local role authenticated;
:as_C
insert into public.events (id, title, starts_at, location_text)
values ('c0000000-0000-0000-0000-0000000000b1', 'Quiet party', now() + interval '1 day', 'Y');
select is((select wall_enabled from public.events where id = 'c0000000-0000-0000-0000-0000000000b1'), false,
  'a host whose default is off creates events with the wall off');
:as_B
insert into public.events (id, title, starts_at, location_text)
values ('c0000000-0000-0000-0000-0000000000b2', 'Loud party', now() + interval '1 day', 'Y');
select is((select wall_enabled from public.events where id = 'c0000000-0000-0000-0000-0000000000b2'), true,
  'a host with the default on gets the wall on');
:as_A
select lives_ok($$ update public.events set wall_enabled = false where id = 'c0000000-0000-0000-0000-0000000000a2' $$,
  'the wall can be toggled after the event ended');
select is((select wall_enabled from public.events where id = :'W2'), false, 'the toggle is saved');
select throws_ok($$ update public.events set title = 'Renamed' where id = 'c0000000-0000-0000-0000-0000000000a2' $$,
  'P0001', 'event_ended', 'other edits after the end are still rejected');
select throws_ok($$ update public.events set title = 'Renamed', wall_enabled = true where id = 'c0000000-0000-0000-0000-0000000000a2' $$,
  'P0001', 'event_ended', 'a wall toggle cannot smuggle other edits past the guard');
select lives_ok($$ update public.events set wall_enabled = false where id = 'c0000000-0000-0000-0000-0000000000a4' $$,
  'the wall can be toggled on a cancelled event');
:as_C
select is((select count(*)::int from public.events where id = :'W2'), 0, 'strangers still cannot see or toggle other events');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 1.4 Name sync
update public.events set wall_enabled = true where id = :'W2';
set local role service_role;
select wall_create_post('WallPast13dd', null, null, :'pia', 'Pia one', '{}');
select wall_create_post('WallPast13dd', null, null, :'pia', 'Pia two', '{}');
select wall_create_post(null, :'W2', :'A', null, 'Host on W2', '{}');
reset role;
insert into public.rsvps (event_id, guest_token_hash, display_name, status)
values (:'W2', public.hash_guest_token(:'milo'), 'Milo', 'going');
set local role service_role;
select wall_create_post('WallPast13dd', null, null, :'milo', 'Milo on W2', '{}');
reset role;
update public.rsvps set display_name = 'Pia B' where event_id = :'W2' and guest_token_hash = public.hash_guest_token(:'pia');
select is((select array_agg(distinct author_display_name) from public.wall_posts where event_id = :'W2' and body like 'Pia%'),
  array['Pia B'], 'renaming an RSVP renames that guest''s posts');
select is((select author_display_name from public.wall_posts where event_id = :'W2' and body = 'Milo on W2'), 'Milo', 'and no one else''s');
select is((select author_display_name from public.wall_posts where event_id = :'W2' and body = 'Host on W2'), 'Anna', 'host posts keep the profile name');
select is((select author_display_name from public.wall_posts where event_id = :'W3'), null, 'other events are untouched (no posts there)');
update public.profiles set display_name = 'Anna K' where id = :'A';
select is((select author_display_name from public.wall_posts where event_id = :'W2' and body = 'Host on W2'), 'Anna K', 'renaming the host renames host posts');
select is((select author_display_name from public.wall_posts where event_id = :'W2' and body = 'Milo on W2'), 'Milo', 'but not guest posts');
-- Claiming the browser RSVP links its posts to the account (user-accounts "Wall content removed with account").
update public.rsvps set user_id = :'C' where event_id = :'W2' and guest_token_hash = public.hash_guest_token(:'pia');
select is((select count(*)::int from public.wall_posts where event_id = :'W2' and author_user_id = :'C'), 2,
  'a claim links the browser''s posts to the account');
delete from auth.users where id = :'C';
select is((select count(*)::int from public.wall_posts where event_id = :'W2' and body like 'Pia%'), 0,
  'deleting the claiming account deletes the posts made from the browser');

-- ---------------------------------------------------------------------------------------------
-- 1.5 Private buckets
select is((select array_agg(id || ':' || public::text || ':' || file_size_limit order by id) from storage.buckets where id in ('wall', 'wall-incoming')),
  array['wall:false:10485760', 'wall-incoming:false:10485760'], 'both wall buckets are private with a 10 MB limit');
select is((select allowed_mime_types from storage.buckets where id = 'wall-incoming'),
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'], 'quarantine accepts JPEG/PNG/WebP/HEIC only');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and (qual like '%wall%' or with_check like '%wall%')), 0,
  'no storage policy mentions the wall buckets');
insert into storage.objects (bucket_id, name) values ('wall', 'w2/x/full.jpg'), ('wall-incoming', 'w2/x');
set local role anon;
:as_anon
select is((select count(*)::int from storage.objects where bucket_id in ('wall', 'wall-incoming')), 0, 'anon cannot read or list wall objects');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('wall-incoming', 'w2/anon') $$, '42501', null,
  'anon cannot write to the quarantine bucket');
set local role authenticated;
:as_A
select is((select count(*)::int from storage.objects where bucket_id in ('wall', 'wall-incoming')), 0,
  'even the event owner cannot read or list wall objects directly');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('wall', 'w2/a/full.jpg', '00000000-0000-0000-0000-00000000c0a1') $$,
  '42501', null, 'authenticated users cannot write processed photos');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id) values ('wall-incoming', '00000000-0000-0000-0000-00000000c0a1/x', '00000000-0000-0000-0000-00000000c0a1') $$,
  '42501', null, 'authenticated users cannot write to the quarantine bucket, not even in their own folder');
select is_empty($$ update storage.objects set name = 'moved' where bucket_id = 'wall' returning 1 $$,
  'authenticated users cannot update wall objects');
select throws_like($$ delete from storage.objects where bucket_id in ('wall', 'wall-incoming') $$, '%Direct deletion%',
  'nobody deletes storage objects from SQL (hence the deletion queue)');
reset role;

select * from finish();
rollback;
