begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Isolate from rows left by local manual testing (rolled back at the end).
delete from rsvp_email_subscriptions;
delete from notifications;
delete from rsvp_rate_limits;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'other@test.dev');
insert into events (id, host_id, title, starts_at, location_text) values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Party', now() + interval '3 days', 'X'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Other', now() + interval '3 days', 'Y');
update event_invites set token = 'EmailParty01' where event_id = '10000000-0000-0000-0000-000000000001';
update event_invites set token = 'EmailOther01' where event_id = '10000000-0000-0000-0000-000000000002';

create function pg_temp.confirmations() returns int language sql as $$
  select count(*)::int from notifications where kind = 'rsvp_email_confirmation' $$;

set local role service_role;
-- 3.2 set
select is(upsert_rsvp('EmailParty01', 'guest-aaaaaaaaaaaaaaaaaaaaa', 'Anna', 'going', ' Anna@Gmail.com ', 'h1', 'set', 'sv') -> 'email_updates',
  '{"state":"on","masked":"a•••@gmail.com"}'::jsonb, 'RSVP with email subscribes and returns the masked address');
reset role;
select is((select email || ':' || locale || ':' || consent_version from rsvp_email_subscriptions), 'anna@gmail.com:sv:rsvp-updates-v1',
  'address is normalised; locale and consent version recorded');
select ok((select consent_at is not null and char_length(unsubscribe_token) = 22 from rsvp_email_subscriptions), 'consent time and unsubscribe token stored');
select is(pg_temp.confirmations(), 1, 'a confirmation email is enqueued');
create temp table first_token as select unsubscribe_token from rsvp_email_subscriptions;

set local role service_role;
-- keep: changing the answer leaves the subscription and sends no new confirmation
select is(upsert_rsvp('EmailParty01', 'guest-aaaaaaaaaaaaaaaaaaaaa', 'Anna', 'maybe') -> 'email_updates' ->> 'state', 'on',
  'old 4-argument call still works and keeps the subscription');
select upsert_rsvp('EmailParty01', 'guest-aaaaaaaaaaaaaaaaaaaaa', 'Anna', 'going', 'anna@gmail.com', 'h1', 'set', 'sv');
reset role;
select is(pg_temp.confirmations(), 1, 'opting in again with the same address sends no new confirmation');

-- change address: new token + new confirmation
set local role service_role;
select upsert_rsvp('EmailParty01', 'guest-aaaaaaaaaaaaaaaaaaaaa', 'Anna', 'going', 'anna@work.se', 'h2', 'set', 'en');
reset role;
select is((select email from rsvp_email_subscriptions), 'anna@work.se', 'address can be changed');
select ok((select unsubscribe_token from rsvp_email_subscriptions) <> (select unsubscribe_token from first_token),
  'changing the address issues a new unsubscribe token');
select is(pg_temp.confirmations(), 2, 'changing the address sends a new confirmation');

-- 3.1 nobody but definer functions can read the table
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select throws_ok($$ select * from rsvp_email_subscriptions $$, '42501', null, 'host cannot read subscriptions');
select ok((select bool_and(not (to_jsonb(r)::text ilike '%@%')) from rsvps r), 'host''s select * from rsvps contains no email');
select ok(not (to_jsonb((select array_agg(r) from rsvps r))::text ilike '%anna@%'), 'no email anywhere in the host''s rsvps rows');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select throws_ok($$ select * from rsvp_email_subscriptions $$, '42501', null, 'other users cannot read subscriptions');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from rsvp_email_subscriptions $$, '42501', null, 'anon cannot read subscriptions');

-- 3.3 get_invite: own device sees masked state, other devices / host see nothing
select is(get_invite('EmailParty01', 'guest-aaaaaaaaaaaaaaaaaaaaa') -> 'my_rsvp' -> 'email_updates',
  '{"state":"on","masked":"a•••@work.se"}'::jsonb, 'guest sees their own subscription masked');
select is(get_invite('EmailParty01', 'guest-zzzzzzzzzzzzzzzzzzzzz') -> 'my_rsvp', 'null'::jsonb, 'another device sees nothing');
select ok(get_invite('EmailParty01')::text !~ '@', 'invite payload without guest token has no email');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select ok(get_invite('EmailParty01', 'guest-aaaaaaaaaaaaaaaaaaaaa')::text !~ '@', 'host calling get_invite never gets an email');

-- remove
set local role service_role;
select is(upsert_rsvp('EmailParty01', 'guest-aaaaaaaaaaaaaaaaaaaaa', 'Anna', 'going', null, null, 'remove') -> 'email_updates',
  '{"state":"off","masked":null}'::jsonb, 'turning updates off deletes the address');
reset role;
select is((select count(*)::int from rsvp_email_subscriptions), 0, 'subscription row deleted');
select is((select status::text from rsvps where display_name = 'Anna'), 'going', 'RSVP kept after turning updates off');

-- invalid email rejected
set local role service_role;
select throws_ok($$ select upsert_rsvp('EmailParty01', 'guest-ccccccccccccccccccccc', 'Cleo', 'going', 'nope', 'h', 'set') $$,
  'P0001', 'invalid_email', 'malformed email is rejected');

-- rate-limited opt-in: 5 per address per 24h, the RSVP is still saved
select upsert_rsvp('EmailOther01', 'guest-' || i || 'bbbbbbbbbbbbbbbbbbbb', 'G' || i, 'going', 'same@x.se', 'samehash', 'set')
from generate_series(1, 5) i;
select is(upsert_rsvp('EmailParty01', 'guest-6bbbbbbbbbbbbbbbbbbbb', 'Sixth', 'going', 'same@x.se', 'samehash', 'set') -> 'email_updates' ->> 'state',
  'rate_limited', 'sixth opt-in for the same address in 24h is refused');
reset role;
select is((select count(*)::int from rsvps where display_name = 'Sixth'), 1, 'the RSVP itself is still saved');

-- unsubscribe: deletes the address, keeps the RSVP, same result for unknown tokens
set local role service_role;
select lives_ok($$ select unsubscribe_email((select unsubscribe_token from rsvp_email_subscriptions limit 1)) $$, 'unsubscribe by token');
select lives_ok($$ select unsubscribe_email('no-such-token') $$, 'unknown token behaves the same');
reset role;
select is((select count(*)::int from rsvp_email_subscriptions), 4, 'unsubscribed address deleted, RSVP kept');

select * from finish();
rollback;
