begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- Stockholm local time helper: day offset from today, hour, minute.
create function pg_temp.local(p_day int, p_h int, p_m int default 0) returns timestamptz language sql stable as $$
  select (((now() at time zone 'Europe/Stockholm')::date + p_day) + make_time(p_h, p_m, 0)) at time zone 'Europe/Stockholm' $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'user@test.dev');
insert into push_tokens (id, user_id, token, platform, locale) values
  ('70000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'ExponentPushToken[host]', 'ios', 'en'),
  ('70000000-0000-0000-0000-000000000b01', '00000000-0000-0000-0000-00000000000b', 'ExponentPushToken[phone]', 'ios', 'sv'),
  ('70000000-0000-0000-0000-000000000b02', '00000000-0000-0000-0000-00000000000b', 'ExponentPushToken[tablet]', 'android', 'en');

insert into events (id, host_id, title, starts_at, location_text) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Party', pg_temp.local(5, 19), 'X');
update event_invites set token = 'WorkerParty1' where event_id = '10000000-0000-0000-0000-000000000001';
insert into rsvps (id, event_id, user_id, guest_token_hash, display_name, status) values
  ('20000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', null, 'App User', 'going'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', null, repeat('1', 64), 'Email Going', 'going'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', null, repeat('2', 64), 'No Email Maybe', 'maybe'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', null, repeat('3', 64), 'Email Declined', 'declined'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', null, repeat('4', 64), 'Email Maybe', 'maybe');
insert into rsvp_email_subscriptions (rsvp_id, event_id, email, locale, consent_at, consent_version) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'going@x.se', 'sv', now(), 'v'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'declined@x.se', 'en', now(), 'v'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'maybe@x.se', 'en', now(), 'v');
insert into event_announcements (id, event_id, author_id, body) values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Doors 19:30'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Bring a jacket');
delete from notifications; -- start from a clean outbox (fixtures enqueue reminders/digests)

create temp table ids (name text primary key, id uuid);
create function pg_temp.id(p text) returns uuid language sql as $$ select id from ids where name = p $$;
create function pg_temp.deliveries(p text) returns setof notification_deliveries language sql as $$
  select * from notification_deliveries where notification_id = pg_temp.id(p) order by channel, rsvp_id, push_token_id $$;

-- 5.1 fan-out to attendees at noon
insert into ids values ('ann1', enqueue_notification('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees',
  p_subject_id => '40000000-0000-0000-0000-000000000001', p_exclude_user_id => '00000000-0000-0000-0000-00000000000a',
  p_not_before => '2000-01-01'));
select is(fan_out_due_notifications(100, pg_temp.local(1, 12)), 1, 'one due notification processed');
select is((select state from notifications where id = pg_temp.id('ann1')), 'fanned_out', 'notification is fanned out');
select is((select count(*)::int from pg_temp.deliveries('ann1') where channel = 'push'), 2, 'signed-in guest gets push on both devices');
select is((select array_agg(rsvp_id order by rsvp_id) from pg_temp.deliveries('ann1') where channel = 'email'),
  array['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004']::uuid[],
  'subscribed Going/Maybe web guests get email; Can''t go and guests without email get nothing');
select is((select count(*)::int from pg_temp.deliveries('ann1') where user_id = '00000000-0000-0000-0000-00000000000a'), 0,
  'the author is not notified');
select is(fan_out_due_notifications(100, pg_temp.local(1, 12)), 0, 'running again does nothing');

-- quiet hours + recipients at send time
insert into ids values ('ann2', enqueue_notification('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees',
  p_subject_id => '40000000-0000-0000-0000-000000000002', p_exclude_user_id => '00000000-0000-0000-0000-00000000000a',
  p_not_before => pg_temp.local(1, 23, 30)));
select fan_out_due_notifications(100, pg_temp.local(1, 23, 30));
select is((select state || ' ' || (not_before = pg_temp.local(2, 8)) from notifications where id = pg_temp.id('ann2')), 'pending true',
  'announcement posted at 23:30 waits for 08:00');
update rsvps set status = 'declined' where id = '20000000-0000-0000-0000-000000000001';
select fan_out_due_notifications(100, pg_temp.local(2, 8));
select is((select count(*)::int from pg_temp.deliveries('ann2') where rsvp_id = '20000000-0000-0000-0000-000000000001'), 0,
  'guest who switched to Can''t go during the deferral is not notified');
select is((select count(*)::int from pg_temp.deliveries('ann2')), 3, 'remaining Going/Maybe recipients are notified at 08:00');
update rsvps set status = 'going' where id = '20000000-0000-0000-0000-000000000001';

-- deleted announcement and digest without remaining replies
insert into ids values ('ann3', enqueue_notification('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees',
  p_subject_id => gen_random_uuid(), p_not_before => '2000-01-01'));
insert into ids values ('dig0', enqueue_notification('rsvp_digest', '10000000-0000-0000-0000-000000000001', 'event_managers',
  p_payload => jsonb_build_object('rsvp_ids', jsonb_build_array(gen_random_uuid())), p_not_before => '2000-01-01'));
select fan_out_due_notifications(100, pg_temp.local(1, 12));
select is((select state from notifications where id = pg_temp.id('ann3')), 'cancelled', 'deleted announcement is not sent');
select is((select state from notifications where id = pg_temp.id('dig0')), 'skipped', 'digest whose replies were all withdrawn is skipped');

-- managers audience: host push only
insert into ids values ('dig1', enqueue_notification('rsvp_digest', '10000000-0000-0000-0000-000000000001', 'event_managers',
  p_payload => '{"rsvp_ids":["20000000-0000-0000-0000-000000000001","20000000-0000-0000-0000-000000000004"]}', p_not_before => '2000-01-01'));
select fan_out_due_notifications(100, pg_temp.local(1, 12));
select is((select array_agg(push_token_id) from pg_temp.deliveries('dig1')), array['70000000-0000-0000-0000-00000000000a']::uuid[],
  'host digest goes to the host''s device only');

-- stale after start / urgency
insert into ids values ('rem', enqueue_notification('event_reminder', '10000000-0000-0000-0000-000000000001', 'event_attendees', p_not_before => '2000-01-01'));
select fan_out_due_notifications(100, pg_temp.local(6, 12));
select is((select state from notifications where id = pg_temp.id('rem')), 'skipped', 'reminder whose event already started is skipped');

insert into ids values ('chg_far', enqueue_notification('event_changed', '10000000-0000-0000-0000-000000000001', 'event_attendees', p_not_before => '2000-01-01'));
select fan_out_due_notifications(100, pg_temp.local(1, 23, 30));
select is((select state from notifications where id = pg_temp.id('chg_far')), 'pending', 'change to an event days away waits for 08:00');
select fan_out_due_notifications(100, pg_temp.local(5, 7));
select is((select state from notifications where id = pg_temp.id('chg_far')), 'fanned_out', 'change to an event starting within 12h is urgent');
select ok((select bool_and(urgent) from pg_temp.deliveries('chg_far')), 'its deliveries are marked urgent');

-- 5.2 claim / complete
create temp table claimed as select x as c from claim_deliveries(100, pg_temp.local(5, 7)) x;
select ok((select count(*) from claimed) > 0, 'claim returns deliveries with a render context');
select is((select c ->> 'url_path' from claimed cl where c ->> 'to' = 'ExponentPushToken[phone]' and c ->> 'kind' = 'event_changed'), '/i/WorkerParty1',
  'guests'' push opens the current invite');
select is((select c ->> 'locale' from claimed cl where c ->> 'to' = 'ExponentPushToken[phone]' and c ->> 'kind' = 'event_changed'), 'sv',
  'push uses the device language');
select ok((select c ->> 'unsubscribe_token' is not null and c ->> 'locale' = 'sv' from claimed cl where c ->> 'to' = 'going@x.se' and c ->> 'kind' = 'event_changed'),
  'email context carries the unsubscribe token and opt-in language');
select is((select c ->> 'url_path' from claimed cl where c ->> 'notification_id' = pg_temp.id('dig1')::text), '/events/10000000-0000-0000-0000-000000000001',
  'host push opens the host view');
select is((select jsonb_array_length(c -> 'replies') from claimed cl where c ->> 'notification_id' = pg_temp.id('dig1')::text), 2, 'digest context has the replies');
select is((select c -> 'announcement' ->> 'body' from claimed cl where c ->> 'kind' = 'announcement' limit 1) is not null, true,
  'announcement context has the body');
select is((select count(*)::int from claim_deliveries(100, pg_temp.local(5, 7)) c where c ->> 'delivery_id' in (select c2x.c ->> 'delivery_id' from claimed c2x)),
  0, 'a second claim never returns the same deliveries');

create function pg_temp.d(p_to text, p_kind text) returns uuid language sql as $$
  select (c ->> 'delivery_id')::uuid from claimed cl where c ->> 'to' = p_to and c ->> 'kind' = p_kind limit 1 $$;
create function pg_temp.st(p uuid) returns text language sql as $$ select status from notification_deliveries where id = p $$;

select is(complete_delivery(pg_temp.d('maybe@x.se', 'event_changed'), 'sent', 'msg-1', null, pg_temp.local(5, 7)), 'sent', 'success is recorded');
select is((select provider_message_id from notification_deliveries where id = pg_temp.d('maybe@x.se', 'event_changed')), 'msg-1', 'provider id stored');
select is(complete_delivery(pg_temp.d('maybe@x.se', 'event_changed'), 'sent', 'msg-1', null, pg_temp.local(5, 7)), 'sent',
  'completing twice is a no-op');

-- temporary errors back off 1m, 5m, 30m, 2h, 6h, 12h, then fail
create temp table backoff (n int, next_at timestamptz);
do $$
declare
  d uuid := pg_temp.d('going@x.se', 'event_changed');
  t timestamptz := pg_temp.local(5, 7);
  outcome text;
begin
  for i in 1..7 loop
    if i > 1 then
      t := (select next_attempt_at from notification_deliveries where id = d);
      -- what claim_deliveries does for this one delivery (a full claim at later times would disturb other fixtures)
      update notification_deliveries set status = 'sending', attempts = attempts + 1, locked_until = t + interval '2 minutes' where id = d;
    end if;
    outcome := complete_delivery(d, 'temporary', null, 'http_503', t);
    insert into backoff values (i, case when outcome = 'retry' then (select next_attempt_at from notification_deliveries where id = d) - t end::text::interval + '2000-01-01'::timestamptz);
  end loop;
end $$;
select is((select array_agg((next_at - '2000-01-01'::timestamptz)::text order by n) from backoff where n <= 6),
  array['00:01:00', '00:05:00', '00:30:00', '02:00:00', '06:00:00', '12:00:00'], 'temporary errors retry with increasing delays');
select is(pg_temp.st(pg_temp.d('going@x.se', 'event_changed')), 'failed', 'gives up after the last retry (~21h)');

select is(complete_delivery(pg_temp.d('ExponentPushToken[tablet]', 'event_changed'), 'permanent', null, 'InvalidCredentials', pg_temp.local(5, 7)),
  'failed', 'permanent errors fail immediately');
select is(complete_delivery(pg_temp.d('ExponentPushToken[phone]', 'event_changed'), 'permanent', null, 'DeviceNotRegistered', pg_temp.local(5, 7)),
  'token_removed', 'DeviceNotRegistered removes the device');
select is((select count(*)::int from push_tokens where token = 'ExponentPushToken[phone]'), 0, 'token row deleted');

-- crash after send: push lock expiry fails (never resent); email lock expiry is retried
select is(pg_temp.st(pg_temp.d('ExponentPushToken[host]', 'rsvp_digest')), 'sending', 'host push is in flight');
select is(pg_temp.st(pg_temp.d('maybe@x.se', 'announcement')), 'sending', 'email is in flight');
create temp table reclaimed as select x as c from claim_deliveries(100, pg_temp.local(5, 7, 10)) x;
select is(pg_temp.st(pg_temp.d('ExponentPushToken[host]', 'rsvp_digest')), 'failed', 'expired push lock is failed, not resent');
select ok(exists (select 1 from reclaimed cl where (c ->> 'delivery_id')::uuid = pg_temp.d('maybe@x.se', 'announcement') and (c ->> 'attempts')::int = 2),
  'expired email lock is retried (provider idempotency key = delivery id)');

-- missing subscription => skipped
insert into ids values ('ann4', enqueue_notification('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees',
  p_subject_id => '40000000-0000-0000-0000-000000000001', p_dedupe_key => 'ann4', p_not_before => '2000-01-01'));
select fan_out_due_notifications(100, pg_temp.local(1, 12));
delete from rsvp_email_subscriptions where rsvp_id = '20000000-0000-0000-0000-000000000004';
select claim_deliveries(100, pg_temp.local(1, 12));
select is((select status || ':' || last_error from notification_deliveries where notification_id = pg_temp.id('ann4') and rsvp_id = '20000000-0000-0000-0000-000000000004'),
  'skipped:unsubscribed', 'unsubscribed address is skipped');

-- rate limit: 21st non-urgent push in an hour is postponed, then dropped once the event started
insert into rsvp_rate_limits (bucket, window_start, count)
values ('push:00000000-0000-0000-0000-00000000000b', to_timestamp(floor(extract(epoch from pg_temp.local(1, 12)) / 3600) * 3600), 20)
on conflict (bucket, window_start) do update set count = 20;
insert into ids values ('ann5', enqueue_notification('announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees',
  p_subject_id => '40000000-0000-0000-0000-000000000001', p_dedupe_key => 'ann5', p_not_before => '2000-01-01'));
select fan_out_due_notifications(100, pg_temp.local(1, 12));
select claim_deliveries(100, pg_temp.local(1, 12));
select is((select status || ':' || (next_attempt_at = pg_temp.local(1, 13)) from notification_deliveries
           where notification_id = pg_temp.id('ann5') and push_token_id = '70000000-0000-0000-0000-000000000b02'),
  'pending:true', 'over the hourly push limit: postponed to the next window');
select claim_deliveries(100, pg_temp.local(6, 12));
select is((select status from notification_deliveries where notification_id = pg_temp.id('ann5') and push_token_id = '70000000-0000-0000-0000-000000000b02'),
  'skipped', 'postponed delivery is dropped once its event has started');

-- 5.3 receipts
update notification_deliveries set status = 'sent', provider_message_id = 'ticket-1', sent_at = pg_temp.local(1, 12)
where notification_id = pg_temp.id('ann5') and push_token_id = '70000000-0000-0000-0000-000000000b02';
select is((select count(*)::int from due_push_receipts(100, pg_temp.local(1, 12, 10))), 0, 'receipts are not checked before 15 minutes');
select is((select array_agg(ticket_id) from due_push_receipts(100, pg_temp.local(1, 12, 15))), array['ticket-1'], 'receipts are due after 15 minutes');
select record_push_receipt((select delivery_id from due_push_receipts(100, pg_temp.local(1, 12, 15))), 'error', 'DeviceNotRegistered', pg_temp.local(1, 12, 15));
select is((select count(*)::int from push_tokens where token = 'ExponentPushToken[tablet]'), 0, 'DeviceNotRegistered receipt removes the device');

-- 7.4 hard bounce / complaint from the provider deletes the address the message went to
insert into rsvp_email_subscriptions (rsvp_id, event_id, email, consent_at, consent_version)
values ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'maybe@x.se', now(), 'v');
update notification_deliveries set provider_message_id = 'em_bounce' where id = pg_temp.d('maybe@x.se', 'event_changed');
select ok(email_bounced('em_bounce'), 'bounce for a known message is handled');
select is((select count(*)::int from rsvp_email_subscriptions where rsvp_id = '20000000-0000-0000-0000-000000000004'), 0,
  'bounced address is deleted');

-- worker functions are service-role only
set local role authenticated;
select throws_ok($$ select fan_out_due_notifications() $$, '42501', null, 'authenticated cannot run the worker');
select throws_ok($$ select claim_deliveries() $$, '42501', null, 'authenticated cannot claim deliveries');
reset role;

select * from finish();
rollback;
