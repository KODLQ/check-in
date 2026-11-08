begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'host@test.dev');

set local session_replication_role = replica; -- bypass triggers to create fixtures freely
insert into events (id, host_id, title, starts_at, location_text) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Past', now() - interval '13 hours', 'X'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Ancient', now() - interval '14 months', 'X'),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000a', 'Live', now() + interval '1 day', 'X');
insert into event_invites (token, event_id, revoked_at) values
  ('PastPastPast', '10000000-0000-0000-0000-000000000001', null),
  ('RevokedToken', '10000000-0000-0000-0000-000000000003', now()),
  ('LiveLiveLive', '10000000-0000-0000-0000-000000000003', null);
set local session_replication_role = origin;

set local role anon;
select is(get_invite('PastPastPast') ->> 'state', 'past', 'events 12h after start without end are past');
select is(get_invite('RevokedToken'), get_invite('NoSuchToken1'), 'revoked links look identical to unknown links');

set local role service_role;
select throws_ok($$ select upsert_rsvp('PastPastPast', 'guest-token-aaaaaaaaaaaaaaa', 'X', 'going') $$,
  'P0001', 'event_closed', 'past events take no RSVPs');
select throws_ok($$ select upsert_rsvp('RevokedToken', 'guest-token-aaaaaaaaaaaaaaa', 'X', 'going') $$,
  'P0002', 'not_found', 'revoked links take no RSVPs');

-- Rate limiting
select ok(hit_rate_limit('ip:1', 2, 600), 'first hit allowed');
select ok(hit_rate_limit('ip:1', 2, 600), 'second hit allowed');
select ok(not hit_rate_limit('ip:1', 2, 600), 'third hit over the limit is rejected');

set local role anon;
select throws_ok($$ select hit_rate_limit('ip:2', 2, 600) $$, '42501', null, 'anon cannot touch rate limits');

-- Retention
reset role;
insert into rsvp_rate_limits (bucket, window_start, count) values ('old', now() - interval '2 days', 5);
select run_retention();
select is((select count(*)::int from rsvp_rate_limits where bucket = 'old'), 0, 'rate-limit buckets expire after 24h');
select is((select array_agg(title order by title) from events), array['Live', 'Past'],
  'events are deleted 12 months after they end');

select * from finish();
rollback;
