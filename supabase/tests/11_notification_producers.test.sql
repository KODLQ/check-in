begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'member@test.dev');

-- 4.1 schedule_event_reminder with a controlled clock (fixtures bypass triggers via replica mode)
set local session_replication_role = replica;
insert into events (id, host_id, title, starts_at, location_text) values
  -- Saturday 8 June 2030 20:00 CEST
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Sat', '2030-06-08 18:00Z', 'X'),
  -- 19:00 CEST
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Late', '2030-06-08 17:00Z', 'X'),
  -- 20:00 CEST
  ('30000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Later', '2030-06-08 18:00Z', 'X');
set local session_replication_role = origin;

create function pg_temp.reminder(p_event uuid) returns timestamptz language sql as $$
  select not_before from notifications where event_id = p_event and kind = 'event_reminder' and state = 'pending' $$;

select schedule_event_reminder(e, '2030-06-04 10:00Z') from events e where id = '30000000-0000-0000-0000-000000000001';
select is(pg_temp.reminder('30000000-0000-0000-0000-000000000001'), '2030-06-07 18:00Z'::timestamptz,
  'created on Tuesday: reminder 24h before start (Friday 20:00)');
select schedule_event_reminder(e, '2030-06-08 05:00Z') from events e where id = '30000000-0000-0000-0000-000000000002';
select is(pg_temp.reminder('30000000-0000-0000-0000-000000000002'), '2030-06-08 06:00Z'::timestamptz,
  'created 07:00 for 19:00 today: reminder at 08:00');
select is((select schedule_event_reminder(e, '2030-06-08 12:00Z') from events e where id = '30000000-0000-0000-0000-000000000003'),
  null, 'created 14:00 for 20:00 today: no reminder');
select is(pg_temp.reminder('30000000-0000-0000-0000-000000000003'), null, 'nothing pending for the late event');

-- one reminder per start time
update notifications set state = 'fanned_out', processed_at = now() where event_id = '30000000-0000-0000-0000-000000000001';
select schedule_event_reminder(e, '2030-06-07 19:00Z') from events e where id = '30000000-0000-0000-0000-000000000001';
select is((select count(*)::int from notifications where event_id = '30000000-0000-0000-0000-000000000001'), 1,
  'a sent reminder is not scheduled again for the same start time');
-- start moved: a new reminder for the new time, the stale pending one disappears
set local session_replication_role = replica;
update events set starts_at = '2030-06-15 18:00Z' where id = '30000000-0000-0000-0000-000000000002';
set local session_replication_role = origin;
select schedule_event_reminder(e, '2030-06-08 05:30Z') from events e where id = '30000000-0000-0000-0000-000000000002';
select is((select array_agg(not_before) from notifications where event_id = '30000000-0000-0000-0000-000000000002' and state = 'pending'),
  array['2030-06-14 18:00Z'::timestamptz], 'moving the start replaces the pending reminder');

-- 4.1 trigger: new events get a reminder
insert into events (id, host_id, title, starts_at, location_text) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Party', now() + interval '3 days', 'Old place');
select is(pg_temp.reminder('10000000-0000-0000-0000-000000000001'), now() + interval '2 days',
  'creating an event schedules its reminder');

-- 4.2 events_notify
create temp table r as select id from rsvps limit 0;
insert into rsvps (event_id, guest_token_hash, display_name, status)
values ('10000000-0000-0000-0000-000000000001', repeat('1', 64), 'Anna', 'going');

create function pg_temp.changed() returns setof notifications language sql as $$
  select * from notifications where event_id = '10000000-0000-0000-0000-000000000001' and kind = 'event_changed' $$;

update events set description = 'Bring snacks', cover_path = 'x/y.jpg', theme = 'meadow' where id = '10000000-0000-0000-0000-000000000001';
select is((select count(*)::int from pg_temp.changed()), 0, 'description/cover edits enqueue nothing');

update events set starts_at = starts_at + interval '1 hour' where id = '10000000-0000-0000-0000-000000000001';
select is((select payload -> 'changed' from pg_temp.changed()), '["time"]'::jsonb, 'time change enqueues event_changed');
select is((select not_before from pg_temp.changed()), now() + interval '5 minutes', 'change is debounced by 5 minutes');
select is(pg_temp.reminder('10000000-0000-0000-0000-000000000001'), now() + interval '2 days 1 hour',
  'moving the start reschedules the reminder');
select is((select count(*)::int from notifications where event_id = '10000000-0000-0000-0000-000000000001' and kind = 'event_reminder'), 1,
  'only one reminder exists after rescheduling');

update events set location_text = 'New place' where id = '10000000-0000-0000-0000-000000000001';
update events set location_text = 'Final place', latitude = 59.3, longitude = 18.0 where id = '10000000-0000-0000-0000-000000000001';
select is((select count(*)::int from pg_temp.changed()), 1, 'quick successive edits produce one notification');
select is((select payload -> 'changed' from pg_temp.changed()), '["time","location"]'::jsonb, 'it records everything that changed');

update events set ends_at = starts_at + interval '5 hours' where id = '10000000-0000-0000-0000-000000000001';
select is((select count(*)::int from pg_temp.changed()), 1, 'end time edits coalesce too');

-- cancellation
update events set cancelled_at = now() where id = '10000000-0000-0000-0000-000000000001';
select is((select state from pg_temp.changed()), 'cancelled', 'pending change notification is cancelled');
select is((select state from notifications where event_id = '10000000-0000-0000-0000-000000000001' and kind = 'event_reminder'),
  'cancelled', 'pending reminder is cancelled');
select is((select state || ':' || audience from notifications where event_id = '10000000-0000-0000-0000-000000000001' and kind = 'event_cancelled'),
  'pending:event_attendees', 'cancellation notification enqueued for attendees');
select ok((select not_before <= now() from notifications where event_id = '10000000-0000-0000-0000-000000000001' and kind = 'event_cancelled'),
  'cancellation is due immediately');

-- 4.3 rsvp digest
insert into events (id, host_id, title, starts_at, location_text) values
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Digest', now() + interval '3 days', 'X');
create function pg_temp.digests() returns setof notifications language sql as $$
  select * from notifications where event_id = '10000000-0000-0000-0000-000000000002' and kind = 'rsvp_digest' order by created_at $$;

insert into rsvps (event_id, user_id, display_name, status)
values ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Host', 'going');
select is((select count(*)::int from pg_temp.digests()), 0, 'host''s own RSVP does not notify the host');

insert into rsvps (event_id, guest_token_hash, display_name, status)
select '10000000-0000-0000-0000-000000000002', repeat(i::text, 64), 'Guest ' || i, 'going' from generate_series(1, 6) i;
select is((select count(*)::int from pg_temp.digests()), 1, 'a burst of replies gives one pending digest');
select is((select jsonb_array_length(payload -> 'rsvp_ids') from pg_temp.digests()), 6, 'the digest lists every reply');
select is((select not_before from pg_temp.digests()), now() + interval '1 minute', 'first digest goes out after 1 minute');
select is((select audience from pg_temp.digests()), 'event_managers', 'digest goes to the event managers');

update rsvps set display_name = 'Renamed' where display_name = 'Guest 1';
select is((select jsonb_array_length(payload -> 'rsvp_ids') from pg_temp.digests()), 6, 'non-status edits do not count as replies');

-- After a digest was sent, the next one waits 15 minutes from that send.
update notifications set state = 'fanned_out', processed_at = now() + interval '1 minute'
where event_id = '10000000-0000-0000-0000-000000000002' and kind = 'rsvp_digest';
update rsvps set status = 'maybe' where display_name = 'Guest 2';
select is((select not_before from pg_temp.digests() where state = 'pending'), now() + interval '16 minutes',
  'the next digest is at least 15 minutes after the previous one');

delete from rsvps where display_name = 'Guest 3';
select is((select jsonb_array_length(payload -> 'rsvp_ids') from pg_temp.digests() where state = 'pending'), 1,
  'withdrawals do not trigger a digest');

select * from finish();
rollback;
