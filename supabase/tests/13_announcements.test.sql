begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'other@test.dev');
insert into events (id, host_id, title, starts_at, location_text) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Party', now() + interval '3 days', 'X'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Cancelled', now() + interval '3 days', 'X');
update event_invites set token = 'AnnounceTok1' where event_id = '10000000-0000-0000-0000-000000000001';
update event_invites set token = 'AnnounceTok2' where event_id = '10000000-0000-0000-0000-000000000002';
update events set cancelled_at = now() where id = '10000000-0000-0000-0000-000000000002';
set local session_replication_role = replica;
insert into events (id, host_id, title, starts_at, location_text) values
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Over', now() - interval '13 hours', 'X');
set local session_replication_role = origin;

create temp table posted (n int primary key, id uuid);
grant all on posted to authenticated;

-- Host posts
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into posted select 1, (post_announcement('10000000-0000-0000-0000-000000000001', '  Doors open 19:30, ring Andersson ') ->> 'id')::uuid;
select is((select body from event_announcements where id = (select id from posted where n = 1)), 'Doors open 19:30, ring Andersson',
  'host posts a trimmed announcement');
select ok((select created_at is not null from event_announcements where id = (select id from posted where n = 1)), 'posting time is saved');
select throws_ok($$ select post_announcement('10000000-0000-0000-0000-000000000001', '   ') $$, 'P0001', 'invalid_body', 'empty announcement is rejected');
select throws_ok($$ select post_announcement('10000000-0000-0000-0000-000000000001', repeat('x', 501)) $$, 'P0001', 'invalid_body', '501 characters is rejected');
select lives_ok($$ select post_announcement('10000000-0000-0000-0000-000000000001', repeat('x', 500)) $$, '500 characters is accepted');
select throws_ok($$ select post_announcement('10000000-0000-0000-0000-000000000002', 'hi') $$, 'P0001', 'event_closed', 'cancelled event is rejected');
select throws_ok($$ select post_announcement('10000000-0000-0000-0000-000000000003', 'hi') $$, 'P0001', 'event_closed', 'ended event is rejected');
select throws_ok($$ insert into event_announcements (event_id, body) values ('10000000-0000-0000-0000-000000000001', 'x') $$,
  '42501', null, 'no direct inserts, even for the host');
select is((select count(*)::int from event_announcements), 2, 'host can read the event''s announcements');

-- Delivery is enqueued for attendees, excluding the author
reset role;
select is((select audience || ':' || exclude_user_id from notifications where subject_id = (select id from posted where n = 1)),
  'event_attendees:00000000-0000-0000-0000-00000000000a', 'announcement notifies attendees and excludes the author');

-- Not the host
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select throws_ok($$ select post_announcement('10000000-0000-0000-0000-000000000001', 'spam') $$, 'P0002', 'not_found', 'other users cannot post');
select is((select count(*)::int from event_announcements), 0, 'other users cannot read announcements directly');
select throws_ok($$ select delete_announcement((select id from posted where n = 1)) $$, 'P0002', 'not_found', 'other users cannot delete');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select post_announcement('10000000-0000-0000-0000-000000000001', 'spam') $$, '42501', null, 'anon cannot post');

-- Guests read through get_invite, newest first
select is((select array_agg(a ->> 'body') from jsonb_array_elements(get_invite('AnnounceTok1') -> 'announcements') a),
  array[repeat('x', 500), 'Doors open 19:30, ring Andersson'], 'invite lists announcements newest first');
select ok((get_invite('AnnounceTok1') -> 'announcements' -> 0) ? 'created_at', 'each announcement has its posting time');
select is(get_invite('NoSuchToken1') -> 'announcements', null, 'unknown invite returns no announcements');
reset role;
update event_invites set revoked_at = now() where token = 'AnnounceTok1';
insert into event_invites (token, event_id) values ('AnnounceTok3', '10000000-0000-0000-0000-000000000001');
set local role anon;
select is(get_invite('AnnounceTok1') -> 'announcements', null, 'revoked invite returns no announcements');
select is(get_invite('AnnounceTok2') -> 'announcements', null, 'cancelled invite returns no announcements');

-- Limit: 5 per rolling 24h, deleted ones count
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select delete_announcement((select id from posted where n = 1));
select post_announcement('10000000-0000-0000-0000-000000000001', 'third');
select post_announcement('10000000-0000-0000-0000-000000000001', 'fourth');
select post_announcement('10000000-0000-0000-0000-000000000001', 'fifth');
select throws_ok($$ select post_announcement('10000000-0000-0000-0000-000000000001', 'sixth') $$, 'P0001', 'announcement_limit',
  'sixth announcement in 24h is rejected, counting the deleted one');
reset role;
update event_announcements set created_at = now() - interval '25 hours' where body is null; -- the deleted first post ages out
set local role authenticated;
select lives_ok($$ select post_announcement('10000000-0000-0000-0000-000000000001', 'sixth') $$, 'posting is possible again after 24h');
select throws_ok($$ select post_announcement('10000000-0000-0000-0000-000000000001', 'seventh') $$, 'P0001', 'announcement_limit',
  'and the limit applies again');

-- Delete: gone everywhere, pending notification cancelled, sent ones not recalled
reset role;
insert into posted select 2, id from event_announcements where body = 'third';
insert into posted select 3, id from event_announcements where body = 'fourth';
update notifications set state = 'fanned_out' where subject_id = (select id from posted where n = 3);
set local role authenticated;
select lives_ok($$ select delete_announcement((select id from posted where n = 2)) $$, 'host deletes a pending announcement');
select delete_announcement((select id from posted where n = 3));
reset role;
select is((select state from notifications where subject_id = (select id from posted where n = 2)), 'cancelled',
  'deleted before delivery: nobody is notified');
select is((select state from notifications where subject_id = (select id from posted where n = 3)), 'fanned_out',
  'deleted after delivery: already-sent notifications are not touched');
select ok((select body is null and deleted_at is not null from event_announcements where id = (select id from posted where n = 2)),
  'deleted announcement body is erased');
set local role anon;
select ok(not (get_invite('AnnounceTok3')::text ~ 'third|fourth'), 'deleted announcements disappear from the invite');

select * from finish();
rollback;
