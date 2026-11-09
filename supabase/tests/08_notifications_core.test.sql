begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'other@test.dev');
insert into events (id, host_id, title, starts_at, location_text) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Party', now() + interval '3 days', 'X');
insert into rsvps (id, event_id, guest_token_hash, display_name, status) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', repeat('a', 64), 'Anna', 'going');

-- 1.4: the registry must equal NOTIFICATION_KINDS in packages/shared/src/notifications/kinds.ts.
-- packages/shared/src/notifications/kinds.test.ts parses the list below, so update both together.
-- kinds: rsvp_email_confirmation:urgent:email, event_changed::push+email, event_cancelled:urgent:push+email,
--        event_reminder:stale:push+email, announcement:stale:push+email, rsvp_digest::push, wall_digest::push
select results_eq(
  $$ select kind, urgent, channels, stale_after_start from notification_kinds order by kind $$,
  $$ values
       ('announcement', false, array['push', 'email'], true),
       ('date_picked', false, array['push'], true),
       ('event_cancelled', true, array['push', 'email'], false),
       ('event_changed', false, array['push', 'email'], false),
       ('event_reminder', false, array['push', 'email'], true),
       ('group_answer_reminder', false, array['push'], true),
       ('group_date_open', false, array['push'], true),
       ('group_invited', false, array['push'], false),
       ('group_joined', false, array['push'], false),
       ('group_new_owner', false, array['push'], false),
       ('rsvp_digest', false, array['push'], false),
       ('rsvp_email_confirmation', true, array['email'], false),
       ('waitlist_promoted', false, array['push', 'email'], true),
       ('wall_digest', false, array['push'], false) $$,
  'notification_kinds matches the shared NOTIFICATION_KINDS registry'
);

-- 1.2 enqueue: dedupe
create temp table ids (name text primary key, id uuid);
grant all on ids to anon, authenticated;
delete from notifications; -- drop the reminder/digest produced by the fixtures above
insert into ids values ('a', enqueue_notification('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees', p_dedupe_key => 'k1'));
select is(enqueue_notification('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees', p_dedupe_key => 'k1'),
  (select id from ids where name = 'a'), 'duplicate dedupe key returns the existing notification');
select is((select count(*)::int from notifications where dedupe_key = 'k1'), 1, 'duplicate dedupe key inserts nothing');

-- coalesce keep: payload arrays unioned, not_before unchanged
insert into ids values ('c', enqueue_notification('rsvp_digest', '10000000-0000-0000-0000-000000000001', 'event_managers',
  p_payload => '{"rsvp_ids":["r1","r2"]}', p_not_before => '2030-01-01 10:00Z', p_coalesce_key => 'digest:1'));
select is(enqueue_notification('rsvp_digest', '10000000-0000-0000-0000-000000000001', 'event_managers',
  p_payload => '{"rsvp_ids":["r2","r3"]}', p_not_before => '2030-01-01 11:00Z', p_coalesce_key => 'digest:1'),
  (select id from ids where name = 'c'), 'coalesce merges into the pending row');
select is((select payload -> 'rsvp_ids' from notifications where coalesce_key = 'digest:1'), '["r1","r2","r3"]'::jsonb,
  'coalesce unions payload arrays without duplicates');
select is((select not_before from notifications where coalesce_key = 'digest:1'), '2030-01-01 10:00Z'::timestamptz,
  'keep mode leaves not_before alone');

-- coalesce debounce: not_before moves to the latest edit
select enqueue_notification('event_changed', '10000000-0000-0000-0000-000000000001', 'event_attendees',
  p_payload => '{"changed":["time"]}', p_not_before => '2030-01-01 10:00Z', p_coalesce_key => 'chg:1', p_coalesce_mode => 'debounce');
select enqueue_notification('event_changed', '10000000-0000-0000-0000-000000000001', 'event_attendees',
  p_payload => '{"changed":["location"]}', p_not_before => '2030-01-01 10:03Z', p_coalesce_key => 'chg:1', p_coalesce_mode => 'debounce');
select is((select not_before from notifications where coalesce_key = 'chg:1'), '2030-01-01 10:03Z'::timestamptz,
  'debounce moves not_before to the newest edit');
select is((select payload -> 'changed' from notifications where coalesce_key = 'chg:1'), '["time","location"]'::jsonb,
  'debounce keeps what changed across edits');
select is((select count(*)::int from notifications where coalesce_key = 'chg:1'), 1, 'one row per coalesce key while pending');

-- once processed, a new row is started for the same coalesce key
update notifications set state = 'fanned_out', processed_at = now() where coalesce_key = 'chg:1';
select enqueue_notification('event_changed', '10000000-0000-0000-0000-000000000001', 'event_attendees',
  p_coalesce_key => 'chg:1', p_coalesce_mode => 'debounce');
select is((select count(*)::int from notifications where coalesce_key = 'chg:1'), 2, 'processed rows are not merged into');

-- cancel_event_notifications: pending rows cancelled, pending deliveries skipped, except kind kept
insert into notification_deliveries (notification_id, channel, rsvp_id)
values ((select id from ids where name = 'a'), 'email', '20000000-0000-0000-0000-000000000001');
update notifications set state = 'fanned_out' where id = (select id from ids where name = 'a');
insert into ids values ('x', enqueue_notification('event_cancelled', '10000000-0000-0000-0000-000000000001', 'event_attendees'));
select is(cancel_event_notifications('10000000-0000-0000-0000-000000000001', 'event_cancelled'), 2,
  'cancel returns the number of pending notifications cancelled');
select is((select state from notifications where coalesce_key = 'digest:1'), 'cancelled', 'pending notification is cancelled');
select is((select state from notifications where id = (select id from ids where name = 'x')), 'pending', 'excepted kind stays pending');
select is((select status from notification_deliveries where notification_id = (select id from ids where name = 'a')), 'skipped',
  'pending deliveries of the event are skipped');

-- RLS / privileges
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select count(*) from notifications $$, '42501', null, 'host cannot read notifications');
select throws_ok($$ select count(*) from notification_deliveries $$, '42501', null, 'host cannot read deliveries');
select throws_ok($$ insert into notifications (kind, event_id, audience) values ('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees') $$,
  '42501', null, 'authenticated cannot insert notifications');
select throws_ok($$ select enqueue_notification('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees') $$,
  '42501', null, 'authenticated cannot call enqueue_notification');
select throws_ok($$ select cancel_event_notifications('10000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'authenticated cannot call cancel_event_notifications');
select is((select count(*)::int from notification_kinds), 14, 'authenticated can read the kinds registry');
select throws_ok($$ insert into notification_kinds (kind, channels) values ('spam', array['email']) $$,
  '42501', null, 'authenticated cannot add kinds');
select ok(is_event_manager('10000000-0000-0000-0000-000000000001'), 'host is an event manager');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select ok(not is_event_manager('10000000-0000-0000-0000-000000000001'), 'another user is not an event manager');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select count(*) from notifications $$, '42501', null, 'anon cannot read notifications');
select throws_ok($$ select is_event_manager('10000000-0000-0000-0000-000000000001') $$, '42501', null, 'anon cannot call is_event_manager');
reset role;

select ok(is_event_manager_for('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a')
  and not is_event_manager_for('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b'),
  'is_event_manager_for evaluates is_event_manager as another user');

-- 1.3 quiet hours (Europe/Stockholm). Winter = UTC+1, summer = UTC+2.
select is(apply_quiet_hours('2026-01-15 20:59Z', false), '2026-01-15 20:59Z'::timestamptz, '21:59 local is sent now');
select is(apply_quiet_hours('2026-01-15 21:00Z', false), '2026-01-16 07:00Z'::timestamptz, '22:00 local waits for 08:00 next day');
select is(apply_quiet_hours('2026-01-16 06:59Z', false), '2026-01-16 07:00Z'::timestamptz, '07:59 local waits for 08:00 same day');
select is(apply_quiet_hours('2026-01-16 07:00Z', false), '2026-01-16 07:00Z'::timestamptz, '08:00 local is sent now');
select is(apply_quiet_hours('2026-01-15 22:30Z', true), '2026-01-15 22:30Z'::timestamptz, 'urgent bypasses quiet hours');
-- DST starts Sunday 29 March 2026 (02:00 -> 03:00): 23:30 Sat (UTC+1) -> 08:00 Sun (UTC+2) = 06:00Z
select is(apply_quiet_hours('2026-03-28 22:30Z', false), '2026-03-29 06:00Z'::timestamptz, 'spring-forward night resolves to 08:00 CEST');
-- DST ends Sunday 25 October 2026 (03:00 -> 02:00): 23:30 Sat (UTC+2) -> 08:00 Sun (UTC+1) = 07:00Z
select is(apply_quiet_hours('2026-10-24 21:30Z', false), '2026-10-25 07:00Z'::timestamptz, 'fall-back night resolves to 08:00 CET');
select is(apply_quiet_hours('2026-10-25 01:30Z', false), '2026-10-25 07:00Z'::timestamptz, 'repeated 02:30 hour resolves to 08:00 CET');

-- 1.1 cascades
reset role;
insert into notifications (kind, event_id, audience, target_user_id)
values ('rsvp_digest', '10000000-0000-0000-0000-000000000001', 'user', '00000000-0000-0000-0000-00000000000b');
delete from auth.users where id = '00000000-0000-0000-0000-00000000000b';
select is((select count(*)::int from notifications where audience = 'user'), 0, 'deleting a profile cascades notifications targeted at it');
delete from rsvps where id = '20000000-0000-0000-0000-000000000001';
select is((select count(*)::int from notification_deliveries), 0, 'deleting an RSVP cascades its deliveries');
delete from events where id = '10000000-0000-0000-0000-000000000001';
select is((select count(*)::int from notifications where event_id is not null), 0, 'deleting an event cascades its notifications');

select * from finish();
rollback;
