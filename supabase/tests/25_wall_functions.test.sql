-- Event wall functions: eligibility, feed, uploads, posts, deletion, moderation, withdraw, retention
-- (change: add-event-wall, tasks 2.1-2.6).
begin;
create extension if not exists pgtap with schema extensions;
select plan(144);

\ir fixtures/wall.psql

\set nobody 'wall-guest-nobody-0000000001'
-- Upload helper: a ready upload for a guest token on E1, created directly (processing is tested in the web app).
create function pg_temp.ready_upload(p_event uuid, p_guest text, p_user uuid default null) returns uuid language sql as $$
  insert into public.wall_uploads (event_id, author_user_id, author_guest_hash, content_type, size, incoming_path, status,
                                   full_path, thumb_path, width, height)
  select p_event, p_user, case when p_guest is null then null else public.hash_guest_token(p_guest) end, 'image/jpeg', 1000,
         p_event || '/' || x, 'ready', p_event || '/' || x || '/full.jpg', p_event || '/' || x || '/thumb.jpg', 100, 80
  from gen_random_uuid() x
  returning id;
$$;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlerrm;
end;
$$;

-- =============================================================================================
-- 2.1 can_moderate_event and wall_can_post
select ok(can_moderate_event(:'E1', :'A'), 'owner moderates');
select ok(can_moderate_event(:'E1', :'B'), 'co-host moderates');
select ok(not can_moderate_event(:'E1', :'C'), 'stranger does not moderate');
select ok(not can_moderate_event(:'E1', :'D'), 'former co-host does not moderate');
select ok(not can_moderate_event(:'E1', :'S'), 'a guest does not moderate');

select is(wall_can_post(:'E1', :'A', null), 'ok', 'host can post');
select is(wall_can_post(:'E1', :'B', null), 'ok', 'co-host can post');
select is(wall_can_post(:'E1', null, hash_guest_token(:'gina')), 'ok', 'going web guest can post');
select is(wall_can_post(:'E1', :'S', null), 'ok', 'going account guest can post');
select is(wall_can_post(:'E1', null, hash_guest_token(:'milo')), 'ok', 'maybe guest can post');
select is(wall_can_post(:'E1', null, hash_guest_token(:'xena')), 'not_attending', 'declined guest cannot post');
select is(wall_can_post(:'E1', null, hash_guest_token(:'nobody')), 'not_attending', 'no RSVP cannot post');
select is(wall_can_post(:'E1', :'C', null), 'not_attending', 'signed-in stranger cannot post');
select is(wall_can_post(:'E1', :'D', null), 'not_attending', 'former co-host without RSVP cannot post');
select is(wall_can_post(:'E1', null, hash_guest_token(:'wanda')), 'not_attending', 'waitlisted guest cannot post');
insert into public.wall_blocks (event_id, guest_hash, display_name) values (:'E1', hash_guest_token(:'milo'), 'Milo');
select is(wall_can_post(:'E1', null, hash_guest_token(:'milo')), 'blocked', 'blocked guest cannot post');
delete from public.wall_blocks where event_id = :'E1';
update public.events set wall_enabled = false where id = :'E1';
select is(wall_can_post(:'E1', null, hash_guest_token(:'gina')), 'disabled', 'nobody posts while the wall is off (guest)');
select is(wall_can_post(:'E1', :'A', null), 'disabled', 'nobody posts while the wall is off (host)');
update public.events set wall_enabled = true where id = :'E1';
select is(wall_can_post(:'W4', null, hash_guest_token(:'pia')), 'cancelled', 'cancelled event is read-only');
select is(wall_can_post(:'W4', :'A', null), 'cancelled', 'also for the host');
select is(wall_can_post(:'W2', null, hash_guest_token(:'pia')), 'ok', 'ended 13 days ago: still open');
select is(wall_can_post(:'W3', null, hash_guest_token(:'pia')), 'closed', 'ended 15 days ago: closed');
select is(wall_can_post(:'W3', :'A', null), 'closed', 'closed for the host too');
select is(wall_can_post(:'W5', :'A', null), 'ok', 'date-pending event (null end): the host can post');
select is(wall_can_post(:'W5', null, hash_guest_token(:'vera')), 'not_attending', 'a poll voter (no RSVP before the pick) cannot post');
select is(wall_can_post(:'W2', null, hash_guest_token(:'pia'), now() + interval '2 days'), 'closed',
  'the window closes exactly 14 days after the end');

-- =============================================================================================
-- 2.2 wall_feed
set local role service_role;
select wall_create_post('CoHostTest01', null, null, :'gina', 'Gina <b>hi</b> https://x.se', '{}');
select wall_create_post('CoHostTest01', null, null, :'milo', 'Milo here', '{}');
select wall_create_post(null, :'E1', :'B', null, 'Co-host here', '{}');

select is(wall_feed('NoSuchToken1') ->> 'state', 'not_found', 'unknown token: not_found');
select is(wall_feed('bad'), wall_feed('NoSuchToken1'), 'malformed token looks the same');
select is(wall_feed(null, :'E1', :'C') ->> 'state', 'not_found', 'event id for a stranger: not_found');
select is(wall_feed(null, :'E1', :'D') ->> 'state', 'not_found', 'event id for a former co-host: not_found');
select is(wall_feed(null, :'E1', null) ->> 'state', 'not_found', 'event id without a verified user: not_found');
select is(wall_feed(null, :'E1', :'S') ->> 'state', 'ok', 'event id for a guest with an RSVP (my invites) works');
select is(wall_feed(null, :'E1', :'B') ->> 'moderator', 'true', 'event id for a co-host: moderator view');

select is(jsonb_array_length(wall_feed('CoHostTest01') -> 'posts'), 3, 'anyone with the link reads the posts');
select is(wall_feed('CoHostTest01') -> 'posts' -> 0 ->> 'body', 'Co-host here', 'newest first');
select is(wall_feed('CoHostTest01') -> 'posts' -> 0 ->> 'is_host', 'true', 'co-host posts carry the host label');
select is(wall_feed('CoHostTest01') ->> 'can_post', 'not_attending', 'a visitor without RSVP gets the reason, not a form');
select is(wall_feed('CoHostTest01') -> 'posts' -> 2 ->> 'body', 'Gina <b>hi</b> https://x.se', 'text is stored and returned verbatim (rendered as text)');
select is((select array_agg((p ->> 'mine')::boolean order by ord) from jsonb_array_elements(wall_feed('CoHostTest01', null, null, :'gina') -> 'posts') with ordinality x(p, ord)),
  array[false, false, true], 'mine marks only the visitor''s own post');
select is(wall_feed('CoHostTest01', null, null, :'gina') ->> 'can_post', 'ok', 'a going guest can post');
select is((select bool_or((p ->> 'can_block')::boolean) from jsonb_array_elements(wall_feed('CoHostTest01', null, null, :'gina') -> 'posts') p),
  false, 'guests never get can_block');
select is((select array_agg((p ->> 'can_block')::boolean order by ord) from jsonb_array_elements(wall_feed(null, :'E1', :'A') -> 'posts') with ordinality x(p, ord)),
  array[false, true, true], 'moderators can block guests, not hosts');
select ok(wall_feed(null, :'E1', :'A')::text !~ '(guest_token_hash|author_guest_hash|author_user_id|user_id|guest_hash)',
  'the feed JSON contains no user ids or guest hashes (keys)');
select ok(wall_feed('CoHostTest01', null, null, :'gina')::text !~ hash_guest_token(:'gina'), 'nor the visitor''s hash (values)');
select ok(wall_feed(null, :'E1', :'S')::text !~ :'S', 'nor any account id (values)');
select is(wall_feed('CoHostTest01', null, null, :'gina') ->> 'photos_left', '10', 'a guest sees their remaining photo quota');
select is(wall_feed(null, :'E1', :'A') -> 'photos_left', 'null'::jsonb, 'hosts have no quota');

-- Wall off: guests get nothing, managers still read.
reset role;
update public.events set wall_enabled = false where id = :'E1';
set local role service_role;
select is(wall_feed('CoHostTest01', null, null, :'gina'), '{"state":"disabled"}'::jsonb, 'wall off: guests get no posts at all');
select is(wall_feed(null, :'E1', :'S'), '{"state":"disabled"}'::jsonb, 'wall off: also for guests in the app');
select is(jsonb_array_length(wall_feed(null, :'E1', :'A') -> 'posts'), 3, 'wall off: the host still sees the posts');
select is(wall_feed(null, :'E1', :'A') ->> 'can_post', 'disabled', 'and is told the wall is off');
reset role;
update public.events set wall_enabled = true where id = :'E1';

-- Cancelled: read-only wall.
insert into public.wall_posts (event_id, author_guest_hash, author_display_name, body)
values (:'W4', hash_guest_token(:'pia'), 'Pia', 'Too bad');
set local role service_role;
select is(wall_feed('WallCancel01', null, null, :'pia') ->> 'state', 'ok', 'cancelled event: the wall is still readable');
select is(wall_feed('WallCancel01', null, null, :'pia') ->> 'can_post', 'cancelled', 'cancelled event: read-only');
select is(wall_feed('WallCancel01', null, null, :'pia') -> 'posts' -> 0 ->> 'mine', 'true', 'cancelled event: own posts still deletable');

-- Revoked link.
reset role;
set local role authenticated;
:as_A
select regenerate_invite(:'E1');
set local role service_role;
select is(wall_feed('CoHostTest01'), '{"state":"not_found"}'::jsonb, 'a revoked link returns not_found with no wall content');
select throws_ok($$ select wall_reserve_upload('CoHostTest01', null, null, 'cohost-guest-gina-0000000001', 'image/jpeg', 1000) $$,
  'P0002', 'not_found', 'no uploads through a revoked link');
reset role;
delete from public.event_invites where event_id = :'E1' and token <> 'CoHostTest01';
update public.event_invites set revoked_at = null where token = 'CoHostTest01';

-- Keyset pagination: 33 extra posts.
insert into public.wall_posts (event_id, author_guest_hash, author_display_name, body, created_at)
select :'E1', hash_guest_token(:'milo'), 'Milo', 'bulk ' || g, now() - interval '1 hour' + g * interval '1 second'
from generate_series(1, 33) g;
set local role service_role;
select is(jsonb_array_length(wall_feed('CoHostTest01') -> 'posts'), 30, 'first page has 30 posts');
select is(wall_feed('CoHostTest01') ->> 'has_more', 'true', 'and says there are more');
select is((
  with first as (select wall_feed('CoHostTest01') -> 'posts' -> 29 as last),
       second as (select wall_feed('CoHostTest01', null, null, null, ((select last from first) ->> 'created_at')::timestamptz,
                                    ((select last from first) ->> 'id')::uuid) as f)
  select jsonb_array_length(f -> 'posts')::text || ':' || (f ->> 'has_more') from second), '6:false',
  'the second page has the remaining 6 and no more');
select is((
  with a as (select p ->> 'id' id from jsonb_array_elements(wall_feed('CoHostTest01') -> 'posts') p),
       last as (select wall_feed('CoHostTest01') -> 'posts' -> 29 as l),
       b as (select p ->> 'id' id from jsonb_array_elements(wall_feed('CoHostTest01', null, null, null,
              ((select l from last) ->> 'created_at')::timestamptz, ((select l from last) ->> 'id')::uuid) -> 'posts') p)
  select count(*)::int from a join b using (id)), 0, 'pages do not overlap');
reset role;
delete from public.wall_posts where event_id = :'E1' and body like 'bulk %';

-- =============================================================================================
-- 2.3 wall_reserve_upload / wall_claim_upload / wall_mark_upload
set local role service_role;
select is((select count(*)::int from generate_series(1, 10) g
           where wall_reserve_upload('CoHostTest01', null, null, :'gina', 'image/jpeg', 1000) ? 'upload_id'), 10,
  'a guest reserves 10 photos');
select throws_ok($$ select wall_reserve_upload('CoHostTest01', null, null, 'cohost-guest-gina-0000000001', 'image/jpeg', 1000) $$,
  'P0001', 'photo_quota', 'the 11th photo is rejected');
reset role;
update public.wall_uploads set expires_at = now() - interval '1 minute'
where id = (select id from public.wall_uploads where author_guest_hash = hash_guest_token(:'gina') limit 1);
set local role service_role;
select lives_ok($$ select wall_reserve_upload('CoHostTest01', null, null, 'cohost-guest-gina-0000000001', 'image/jpeg', 1000) $$,
  'an expired upload no longer counts towards the quota');
select is((select count(*)::int from generate_series(1, 12) g where wall_reserve_upload(null, :'E1', :'A', null, 'image/png', 1000) ? 'upload_id'), 12,
  'the host is exempt from the photo quota');
select throws_ok($$ select wall_reserve_upload('CoHostTest01', null, null, 'cohost-guest-xena-0000000001', 'image/jpeg', 1000) $$,
  'P0001', 'not_attending', 'declined guests cannot upload');
select throws_ok($$ select wall_reserve_upload('CoHostTest01', null, null, 'cohost-guest-milo-0000000001', 'application/pdf', 1000) $$,
  'P0001', 'unsupported_type', 'unknown content types are rejected');
select throws_ok($$ select wall_reserve_upload('CoHostTest01', null, null, 'cohost-guest-milo-0000000001', 'image/jpeg', 12582912) $$,
  'P0001', 'too_large', '12 MB is rejected');
select is((wall_reserve_upload('CoHostTest01', null, null, :'milo', 'image/heic', 10485760) ->> 'incoming_path') ~ ('^' || :'E1' || '/[0-9a-f-]{36}$'),
  true, 'exactly 10 MB HEIC is accepted, into <event>/<upload id>');
select is((select (expires_at - created_at) from public.wall_uploads where author_guest_hash = hash_guest_token(:'milo')), interval '2 hours',
  'reservations expire after 2 hours');
-- Reservation rate: 20 per poster per event per hour (host on W2 has no quota).
select is((select count(*)::int from generate_series(1, 20) g where wall_reserve_upload(null, :'W2', :'A', null, 'image/jpeg', 10) ? 'upload_id'), 20,
  '20 reservations in an hour are fine');
select throws_ok($$ select wall_reserve_upload(null, 'c0000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-00000000c0a1', null, 'image/jpeg', 10) $$,
  'P0001', 'rate_limited', 'the 21st is rate limited');
-- Event photo cap (500): 125 posts x 4 photos on W5.
reset role;
insert into public.wall_posts (id, event_id, author_user_id, author_display_name, is_host, photo_count)
select ('c1000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, :'W5', :'A', 'Anna', true, 4 from generate_series(1, 125) g;
insert into public.wall_photos (post_id, event_id, author_user_id, is_host, full_path, thumb_path, width, height, position)
select ('c1000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, :'W5', :'A', true, 'cap/' || g || '/' || p || '/f', 'cap/' || g || '/' || p || '/t', 1, 1, p
from generate_series(1, 125) g, generate_series(0, 3) p;
set local role service_role;
select throws_ok($$ select wall_reserve_upload(null, 'c0000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000c0a1', null, 'image/jpeg', 10) $$,
  'P0001', 'wall_full', 'no reservations past 500 photos per event');
reset role;
delete from public.wall_posts where event_id = :'W5';
delete from public.storage_deletion_queue where path like 'cap/%';

-- Claim + mark.
set local role service_role;
select (wall_reserve_upload('CoHostTest01', null, null, :'milo', 'image/jpeg', 1000) ->> 'upload_id') as up \gset
select throws_ok(format('select wall_claim_upload(%L, %L, null, null, %L)', :'up', 'CoHostTest01', :'gina'),
  'P0002', 'upload_not_found', 'another guest cannot complete someone else''s upload');
select is(wall_claim_upload(:'up', 'CoHostTest01', null, null, :'milo') ->> 'incoming_path', :'E1' || '/' || :'up', 'the owner claims it for processing');
select throws_ok(format('select wall_claim_upload(%L, %L, null, null, %L)', :'up', 'CoHostTest01', :'milo'),
  'P0002', 'upload_not_found', 'an upload is processed only once');
select ok(wall_mark_upload(:'up', 'ready', 'p/full.jpg', 'p/thumb.jpg', 2048, 1536), 'processing marks it ready');
select ok(not wall_mark_upload(:'up', 'ready', 'p/full.jpg', 'p/thumb.jpg', 2048, 1536), 'only once');
select (wall_reserve_upload('CoHostTest01', null, null, :'milo', 'image/jpeg', 1000) ->> 'upload_id') as bad \gset
select wall_claim_upload(:'bad', 'CoHostTest01', null, null, :'milo');
select ok(wall_mark_upload(:'bad', 'rejected'), 'a rejected file is marked');
reset role;
select is((select count(*)::int from public.wall_uploads where id = :'bad'), 0, 'a rejected upload row is deleted at once');
select is((select bucket from public.storage_deletion_queue where path = :'E1' || '/' || :'bad'), 'wall-incoming',
  'and its quarantine object is queued for deletion');
delete from public.wall_uploads where event_id in (:'E1', :'W2');
delete from public.storage_deletion_queue;
delete from public.rsvp_rate_limits where bucket like 'wall_%';

-- =============================================================================================
-- 2.4 wall_create_post
set local role service_role;
select throws_ok($$ select wall_create_post('CoHostTest01', null, null, 'cohost-guest-gina-0000000001', E'  \n\t ', '{}') $$,
  'P0001', 'empty_post', 'whitespace-only post without photos is rejected');
select throws_ok(format('select wall_create_post(%L, null, null, %L, %L, %L)', 'CoHostTest01', :'gina', repeat('x', 501), '{}'),
  'P0001', 'body_too_long', '501 characters are rejected');
select lives_ok(format('select wall_create_post(%L, null, null, %L, %L, %L)', 'CoHostTest01', :'gina', repeat('å', 500), '{}'),
  '500 characters (multi-byte) are fine');
select throws_ok($$ select wall_create_post('CoHostTest01', null, null, 'cohost-guest-xena-0000000001', 'hi', '{}') $$,
  'P0001', 'not_attending', 'a declined guest''s post is rejected');
reset role;
select pg_temp.ready_upload(:'E1', :'milo') as milo_up \gset
select pg_temp.ready_upload(:'E1', :'gina') as g1 \gset
select pg_temp.ready_upload(:'E1', :'gina') as g2 \gset
select pg_temp.ready_upload(:'W2', :'pia') as other_event \gset
insert into public.wall_uploads (event_id, author_guest_hash, content_type, size, incoming_path)
values (:'E1', hash_guest_token(:'gina'), 'image/jpeg', 10, 'pending/x') returning id as pend \gset
set local role service_role;
select throws_ok(format('select wall_create_post(%L, null, null, %L, null, array[%L]::uuid[])', 'CoHostTest01', :'gina', :'milo_up'),
  'P0001', 'invalid_upload', 'someone else''s upload id is rejected');
select throws_ok(format('select wall_create_post(%L, null, null, %L, null, array[%L]::uuid[])', 'CoHostTest01', :'gina', :'pend'),
  'P0001', 'invalid_upload', 'a pending (unprocessed) upload is rejected');
select throws_ok(format('select wall_create_post(%L, null, null, %L, null, array[%L]::uuid[])', 'CoHostTest01', :'gina', :'other_event'),
  'P0001', 'invalid_upload', 'an upload for another event is rejected');
select throws_ok(format('select wall_create_post(%L, null, null, %L, null, array[%L, %L, %L, %L, %L]::uuid[])', 'CoHostTest01', :'gina',
  :'g1', :'g2', gen_random_uuid(), gen_random_uuid(), gen_random_uuid()), 'P0001', 'too_many_photos', 'five photos are rejected');
select throws_ok(format('select wall_create_post(%L, null, null, %L, null, array[%L, %L]::uuid[])', 'CoHostTest01', :'gina', :'g1', :'g1'),
  'P0001', 'too_many_photos', 'duplicate upload ids are rejected');
reset role;
select array[(select full_path from public.wall_uploads where id = :'g2'), (select full_path from public.wall_uploads where id = :'g1')]::text as want_paths \gset
set local role service_role;
select wall_create_post('CoHostTest01', null, null, :'gina', 'Pics!', array[:'g2', :'g1']::uuid[]) ->> 'id' as photo_post \gset
reset role;
select is((select array_agg(full_path order by position) from public.wall_photos where post_id = :'photo_post'),
  :'want_paths'::text[], 'photos are attached in the given order');
select is((select photo_count from public.wall_posts where id = :'photo_post'), 2, 'the post counts its photos');
select is((select count(*)::int from public.wall_uploads where id in (:'g1', :'g2')), 0, 'the uploads are consumed atomically');
select is((select array_agg(bucket order by path) from public.storage_deletion_queue), array['wall-incoming', 'wall-incoming'],
  'consuming queues only the quarantine objects, never the posted renditions');
select is((select count(*)::int from public.notifications where kind = 'wall_digest' and event_id = :'E1' and state = 'pending'), 1,
  'guest posts enqueue one batched wall digest');
select is((select jsonb_array_length(payload -> 'post_ids') from public.notifications where kind = 'wall_digest' and event_id = :'E1'), 4,
  'later posts are batched into the same digest');
select is((select audience from public.notifications where kind = 'wall_digest' and event_id = :'E1'), 'event_managers',
  'the digest goes to the host and co-hosts');
set local role service_role;
select wall_create_post(null, :'E1', :'A', null, 'Host note', '{}');
reset role;
select is((select jsonb_array_length(payload -> 'post_ids') from public.notifications where kind = 'wall_digest' and event_id = :'E1'), 4,
  'host posts do not add to the digest');
-- Posts per poster: 10 per 10 minutes (the rate-limit buckets were reset after 2.3).
set local role service_role;
select is((select count(*)::int from generate_series(1, 10) g where wall_create_post('CoHostTest01', null, null, :'milo', 'spam ' || g, '{}') ? 'id'), 10,
  'ten posts in ten minutes are fine');
select throws_ok($$ select wall_create_post('CoHostTest01', null, null, 'cohost-guest-milo-0000000001', 'one more', '{}') $$,
  'P0001', 'rate_limited', 'the 11th post in ten minutes is rate limited');
-- Posts per event: 1 000.
reset role;
insert into public.wall_posts (event_id, author_user_id, author_display_name, is_host, body)
select :'W5', :'A', 'Anna', true, 'p' || g from generate_series(1, 1000) g;
set local role service_role;
select throws_ok($$ select wall_create_post(null, 'c0000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-00000000c0b1', null, 'full?', '{}') $$,
  'P0001', 'wall_full', 'the 1 001st post on an event is rejected');
reset role;
delete from public.wall_posts where event_id = :'W5';
-- Photo quota is re-checked at post time.
insert into public.wall_photos (post_id, event_id, author_guest_hash, full_path, thumb_path, width, height, position)
select :'photo_post', :'E1', hash_guest_token(:'gina'), 'q/' || g || '/f', 'q/' || g || '/t', 1, 1, 0 from generate_series(1, 8) g;
select pg_temp.ready_upload(:'E1', :'gina') as g3 \gset
set local role service_role;
select throws_ok(format('select wall_create_post(%L, null, null, %L, null, array[%L]::uuid[])', 'CoHostTest01', :'gina', :'g3'),
  'P0001', 'photo_quota', 'an 11th photo is rejected at post time too');
reset role;
delete from public.wall_photos where full_path like 'q/%';
delete from public.storage_deletion_queue;

-- =============================================================================================
-- 2.5 Delete, delete mine, block, unblock, wall on/off
set local role service_role;
select id as milo_post from public.wall_posts where event_id = :'E1' and body = 'Milo here' \gset
select id as gina_text from public.wall_posts where event_id = :'E1' and body = 'Gina <b>hi</b> https://x.se' \gset
select throws_ok(format('select wall_delete_post(%L, %L, null, null, %L)', :'milo_post', 'CoHostTest01', :'gina'),
  'P0001', 'forbidden', 'a guest cannot delete another guest''s post');
select throws_ok(format('select wall_delete_post(%L, %L, null, null, null)', :'milo_post', 'CoHostTest01'),
  'P0001', 'forbidden', 'an anonymous visitor cannot delete posts');
select throws_ok(format('select wall_delete_post(%L, %L, null, null, %L)', :'milo_post', 'WallPast13dd', :'pia'),
  'P0002', 'not_found', 'a post cannot be deleted through another event''s link');
select is(wall_delete_post(:'photo_post', 'CoHostTest01', null, null, :'gina') -> 'queue' @> '[{"bucket":"wall"}]', true,
  'deleting a photo post returns its files for immediate removal');
select is((select count(*)::int from public.storage_deletion_queue where bucket = 'wall'), 4, 'both renditions of both photos are queued');
select is((select count(*)::int from public.wall_posts where id = :'photo_post'), 0, 'the author deleted their post');
select is((wall_delete_post(:'gina_text', null, :'E1', :'B', null) ->> 'deleted')::int, 1, 'a co-host deletes any post');

-- Block / unblock.
select throws_ok(format('select wall_block_author(%L, %L, %L)', :'milo_post', :'E1', :'S'),
  'P0001', 'forbidden', 'a guest cannot block');
select throws_ok(format('select wall_block_author(%L, %L, %L)', :'milo_post', :'E1', :'C'),
  'P0002', 'not_found', 'a stranger cannot block');
select throws_ok(format('select wall_block_author(%L, %L, %L)', (select id from public.wall_posts where event_id = 'c0000000-0000-0000-0000-0000000000e1' and body = 'Host note'), :'E1', :'B'),
  'P0001', 'forbidden', 'host posts cannot be blocked');
select wall_block_author(:'milo_post', :'E1', :'B') ->> 'id' as block_id \gset
select is(wall_block_author(:'milo_post', :'E1', :'A') ->> 'id', :'block_id', 'blocking twice is idempotent');
select throws_ok($$ select wall_create_post('CoHostTest01', null, null, 'cohost-guest-milo-0000000001', 'let me in', '{}') $$,
  'P0001', 'blocked', 'a blocked guest''s post is rejected');
select throws_ok($$ select wall_reserve_upload('CoHostTest01', null, null, 'cohost-guest-milo-0000000001', 'image/jpeg', 10) $$,
  'P0001', 'blocked', 'and so are their uploads');
select is(wall_feed('CoHostTest01', null, null, :'milo') ->> 'can_post', 'blocked', 'a blocked guest still reads the wall and is told why');
select is(wall_feed(null, :'E1', :'A') -> 'blocks' -> 0 ->> 'display_name', 'Milo', 'moderators see the blocked list');
select is(wall_feed('CoHostTest01', null, null, :'milo') -> 'blocks', 'null'::jsonb, 'guests do not');
select ok(wall_unblock(:'block_id', :'E1', :'A'), 'the host allows them again');
select is(wall_can_post(:'E1', null, hash_guest_token(:'milo')), 'ok', 'and they can post');
-- Delete all by poster (moderator).
select is((wall_delete_post(:'milo_post', null, :'E1', :'A', null, true) ->> 'deleted')::int, 11,
  'the host deletes all posts by a poster in one action');
select is((select count(*)::int from public.wall_posts where author_guest_hash = hash_guest_token(:'milo')), 0, 'none of them are left');
select throws_ok(format('select wall_delete_post(%L, %L, null, null, %L, true)', (select id from public.wall_posts where author_guest_hash = hash_guest_token(:'gina') limit 1), 'CoHostTest01', :'gina'),
  'P0001', 'forbidden', 'guests cannot delete all posts by a poster');

-- Wall on/off.
select throws_ok(format('select wall_set_enabled(%L, %L, false)', :'E1', :'S'), 'P0001', 'forbidden', 'guests cannot toggle the wall');
select throws_ok(format('select wall_set_enabled(%L, %L, false)', :'E1', :'C'), 'P0002', 'not_found', 'strangers cannot toggle the wall');
select is(wall_set_enabled(:'W3', :'B', false), false, 'a co-host turns off the wall of an ended event');
select is((select wall_enabled from public.events where id = :'W3'), false, 'it is off');

-- Deletes keep working after withdraw / cancel / close.
reset role;
insert into public.wall_posts (event_id, author_guest_hash, author_display_name, body)
values (:'W3', hash_guest_token(:'pia'), 'Pia', 'Closed wall post');
set local role service_role;
select is((wall_delete_mine('WallCancel01', null, null, :'pia') ->> 'deleted')::int, 1, 'own posts can be deleted on a cancelled event');
select is((wall_delete_mine('WallPast15dd', null, null, :'pia') ->> 'deleted')::int, 1, 'own posts can be deleted after the window closed');

-- =============================================================================================
-- 2.6 Withdraw keeps posts; delete-mine on withdraw; retention
select wall_create_post('CoHostTest01', null, null, :'gina', 'Before withdrawing', '{}');
select ok(withdraw_rsvp('CoHostTest01', :'gina'), 'Gina withdraws');
select is((select count(*)::int from public.wall_posts where author_guest_hash = hash_guest_token(:'gina')), 2,
  'withdrawing keeps her posts');
select is(wall_feed('CoHostTest01', null, null, :'gina') ->> 'can_post', 'not_attending', 'she can no longer post');
select is((select count(*)::int from jsonb_array_elements(wall_feed('CoHostTest01', null, null, :'gina') -> 'posts') p where (p ->> 'mine')::boolean), 2,
  'her posts are still recognised as hers on this device');
select is((wall_delete_mine('CoHostTest01', null, null, :'gina') ->> 'deleted')::int, 2, 'and she can delete them all');
-- Account guest: the app withdraws via remove_rsvp, then deletes posts through the API.
select wall_create_post(null, :'E1', :'S', null, 'Sara before', '{}');
reset role;
delete from public.rsvps where event_id = :'E1' and user_id = :'S';
set local role service_role;
select is(wall_feed(null, :'E1', :'S') ->> 'state', 'not_found', 'without an RSVP the app user reads through the link instead');
select is(wall_feed('CoHostTest01', null, :'S') -> 'posts' -> 0 ->> 'mine', 'true', 'and still owns their post');
select is((wall_delete_mine('CoHostTest01', null, :'S', null) ->> 'deleted')::int, 1, 'and can delete it');

-- Retention.
reset role;
insert into public.wall_uploads (event_id, author_guest_hash, content_type, size, incoming_path, created_at, expires_at)
values (:'E1', hash_guest_token(:'milo'), 'image/jpeg', 10, 'ret/old', now() - interval '23 hours', now() - interval '21 hours'),
       (:'E1', hash_guest_token(:'milo'), 'image/jpeg', 10, 'ret/new', now() - interval '1 hour', now() + interval '1 hour');
insert into storage.objects (bucket_id, name, created_at) values
  ('wall-incoming', 'ret/orphan', now() - interval '23 hours'),
  ('wall-incoming', 'ret/new', now() - interval '1 hour'),
  ('wall', 'ret/orphan/full.jpg', now() - interval '23 hours');
delete from public.storage_deletion_queue;
select run_retention();
select is((select array_agg(incoming_path) from public.wall_uploads where incoming_path like 'ret/%'), array['ret/new'],
  'retention purges staged uploads older than 22 hours');
select is((select array_agg(bucket || ':' || path order by bucket, path) from public.storage_deletion_queue where path like 'ret/%'),
  array['wall:ret/orphan/full.jpg', 'wall-incoming:ret/old', 'wall-incoming:ret/orphan'],
  'their files and unreferenced objects are queued; files of live uploads are not');
select is((select count(*)::int from public.notification_kinds where kind = 'wall_digest' and channels = array['push'] and not urgent), 1,
  'wall_digest is a push-only, non-urgent kind');

-- Storage queue claim / done (leftover local objects queued by the orphan sweep are ignored).
delete from public.storage_deletion_queue where path not like 'ret/%';
set local role service_role;
select is((select count(*)::int from storage_queue_claim(10)), 3, 'the cleanup job claims due rows');
select is((select count(*)::int from storage_queue_claim(10)), 0, 'claimed rows back off before the next attempt');
select is(storage_queue_done((select array_agg(id) from public.storage_deletion_queue)), 3, 'done rows are removed');

-- Clients cannot call any wall function.
reset role;
set local role anon;
select throws_ok($$ select wall_feed('CoHostTest01') $$, '42501', null, 'anon cannot call wall_feed directly');
set local role authenticated;
:as_A
select throws_ok($$ select wall_set_enabled('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0a1', false) $$,
  '42501', null, 'signed-in users cannot call wall RPCs directly (no forged user id)');

select * from finish();
rollback;
