begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'other@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$
  insert into events (id, title, starts_at, location_text, latitude, longitude)
  values ('10000000-0000-0000-0000-000000000001', 'Party', now() + interval '2 days', 'Hornsgatan 12', 59.317, 18.06)
$$, 'host can create an event with title, start and location');

select is((select host_id from events where id = '10000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-00000000000a'::uuid, 'host_id defaults to the caller');

select isnt((select location_point from events where id = '10000000-0000-0000-0000-000000000001'),
  null, 'map point is stored as PostGIS geography');

select throws_ok($$
  insert into events (title, starts_at, location_text) values ('Old', now() - interval '1 hour', 'X')
$$, 'P0001', 'start_in_past', 'start time in the past is rejected');

select throws_ok($$
  insert into events (title, starts_at, ends_at, location_text)
  values ('Bad', now() + interval '2 days', now() + interval '1 day', 'X')
$$, '23514', null, 'end before start is rejected');

update events set starts_at = now() + interval '3 days' where id = '10000000-0000-0000-0000-000000000001';
select isnt((select time_changed_at from events where id = '10000000-0000-0000-0000-000000000001'),
  null, 'changing the time marks the event as time-updated');

-- Another user
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from events), 0, 'other users cannot see the event');

update events set title = 'Hijacked' where id = '10000000-0000-0000-0000-000000000001';
delete from events where id = '10000000-0000-0000-0000-000000000001';

select throws_ok($$
  insert into events (host_id, title, starts_at, location_text)
  values ('00000000-0000-0000-0000-00000000000a', 'Spoof', now() + interval '1 day', 'X')
$$, '42501', null, 'cannot create an event on behalf of someone else');

reset role;
select is((select title from events where id = '10000000-0000-0000-0000-000000000001'),
  'Party', 'other users cannot edit or delete the event');

set local role anon;
select is((select count(*)::int from events), 0, 'anon cannot read events');

-- Ended events cannot be edited
reset role;
set local session_replication_role = replica; -- bypass guard trigger to create a past event
insert into events (id, host_id, title, starts_at, location_text)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Past', now() - interval '2 days', 'X');
set local session_replication_role = origin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ update events set title = 'x' where id = '10000000-0000-0000-0000-000000000002' $$,
  'P0001', 'event_ended', 'ended events cannot be edited');

select * from finish();
rollback;
