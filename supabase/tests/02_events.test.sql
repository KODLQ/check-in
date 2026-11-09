begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

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

-- Date polls (add-date-polls): pending events are written only by the poll RPCs
select throws_ok($$ insert into events (title, starts_at, location_text) values ('Poll', null, 'X') $$,
  'P0001', 'start_required', 'a host cannot insert a date-pending event directly');
select throws_ok($$ update events set starts_at = null where id = '10000000-0000-0000-0000-000000000001' $$,
  'P0001', 'start_required', 'a dated event cannot be turned back into a poll');

reset role;
select set_config('checkin.poll_rpc', 'on', true);
insert into events (id, host_id, title, starts_at, location_text)
values ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Pending', null, 'X');
select set_config('checkin.poll_rpc', '', true);
select is((select event_ended_at(e) from events e where id = '10000000-0000-0000-0000-000000000003'), null,
  'a pending event has no end, so it is never past');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ update events set starts_at = now() + interval '1 day' where id = '10000000-0000-0000-0000-000000000003' $$,
  'P0001', 'date_pending', 'a pending event''s time cannot be set directly');
select throws_ok($$ update events set poll_closes_at = now() + interval '1 hour' where id = '10000000-0000-0000-0000-000000000003' $$,
  'P0001', 'date_pending', 'the voting deadline cannot be set directly');
select throws_ok($$ update events set date_picked_at = now() where id = '10000000-0000-0000-0000-000000000003' $$,
  'P0001', 'date_pending', 'a pick cannot be faked directly');
select lives_ok($$ update events set title = 'Pending party', location_text = 'Y' where id = '10000000-0000-0000-0000-000000000003' $$,
  'other fields of a pending event can be edited directly');

-- The poll RPCs' flag lets the pick through, and a pick is not a "time changed"
select set_config('checkin.poll_rpc', 'on', true);
update events set starts_at = now() + interval '2 days', date_picked_at = now() where id = '10000000-0000-0000-0000-000000000003';
select set_config('checkin.poll_rpc', '', true);
select is((select starts_at is not null and time_changed_at is null from events where id = '10000000-0000-0000-0000-000000000003'),
  true, 'picking a date sets the start without marking the time as updated');
update events set starts_at = now() + interval '3 days' where id = '10000000-0000-0000-0000-000000000003';
select isnt((select time_changed_at from events where id = '10000000-0000-0000-0000-000000000003'), null,
  'after the pick, time changes are normal edits again');

select * from finish();
rollback;
