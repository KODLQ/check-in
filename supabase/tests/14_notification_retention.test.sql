begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'host@test.dev');
set local session_replication_role = replica;
insert into events (id, host_id, title, starts_at, ends_at, location_text, cancelled_at) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Ends', '2030-06-01 18:00Z', '2030-06-01 22:00Z', 'X', null),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Cancelled', '2030-07-01 18:00Z', null, 'X', '2030-05-01 10:00Z');
insert into rsvps (id, event_id, guest_token_hash, display_name, status) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', repeat('1', 64), 'A', 'going'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', repeat('2', 64), 'B', 'going');
set local session_replication_role = origin;
insert into rsvp_email_subscriptions (rsvp_id, event_id, email, consent_at, consent_version) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'a@x.se', '2030-05-01', 'v'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'b@x.se', '2030-04-01', 'v');
insert into notifications (id, kind, event_id, audience, state, processed_at) values
  ('50000000-0000-0000-0000-000000000001', 'announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees', 'fanned_out', '2030-05-01'),
  ('50000000-0000-0000-0000-000000000002', 'announcement', '10000000-0000-0000-0000-000000000001', 'event_attendees', 'fanned_out', '2030-05-20');
insert into push_tokens (user_id, token, platform, last_seen_at) values
  ('00000000-0000-0000-0000-00000000000a', 'ExponentPushToken[old]', 'ios', '2029-11-01'),
  ('00000000-0000-0000-0000-00000000000a', 'ExponentPushToken[new]', 'ios', '2030-05-01');
insert into event_announcements (event_id, body, deleted_at) values
  ('10000000-0000-0000-0000-000000000001', null, '2030-05-31 13:00Z'),
  ('10000000-0000-0000-0000-000000000001', null, '2030-05-31 11:00Z'),
  ('10000000-0000-0000-0000-000000000001', 'kept', null);

select run_retention('2030-06-01 12:00Z');
select is((select count(*)::int from rsvp_email_subscriptions where rsvp_id = '20000000-0000-0000-0000-000000000002'), 0,
  'email deleted 2 days after the event was cancelled');
select is((select count(*)::int from rsvp_email_subscriptions where rsvp_id = '20000000-0000-0000-0000-000000000001'), 1,
  'email kept while the event has not ended');
select is((select array_agg(id) from notifications where id::text like '50000000%'), array['50000000-0000-0000-0000-000000000002'::uuid],
  'processed notifications are deleted after 30 days');
select is((select array_agg(token) from push_tokens), array['ExponentPushToken[new]'], 'devices unseen for 180 days are removed');
select is((select count(*)::int from event_announcements), 2, 'deleted announcements are removed after 24 hours');

select run_retention('2030-06-03 21:00Z');
select is((select count(*)::int from rsvp_email_subscriptions), 1, 'email kept until 2 days after the end');
select run_retention('2030-06-03 22:01Z');
select is((select count(*)::int from rsvp_email_subscriptions), 0, 'email deleted 2 days after the event ended');
select is((select count(*)::int from rsvps), (select count(*)::int from rsvps where id::text like '20000000%') + (select count(*)::int from rsvps where id::text not like '20000000%'),
  'RSVPs themselves remain');

select * from finish();
rollback;
