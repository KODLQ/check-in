begin;
create extension if not exists pgtap with schema extensions;
select plan(35);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'member@test.dev');
update profiles set display_name = 'Hosty' where id = '00000000-0000-0000-0000-00000000000a';
update profiles set display_name = 'Member' where id = '00000000-0000-0000-0000-00000000000c';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into events (id, title, starts_at, location_text)
values ('10000000-0000-0000-0000-000000000001', 'Party', now() + interval '2 days', 'Secret St 1');
reset role;

create temp table t as
  select token from event_invites where event_id = '10000000-0000-0000-0000-000000000001';
grant select on t to anon, authenticated, service_role;

-- Not found equivalence
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(get_invite('ZZZZZZZZZZZZ'), '{"state":"not_found"}'::jsonb, 'unknown token is not found');
select is(get_invite('bad'), '{"state":"not_found"}'::jsonb, 'malformed token is not found');
select is(get_invite((select token from t)) ->> 'state', 'active', 'valid token returns active event');
select is(get_invite((select token from t)) -> 'host' ->> 'display_name', 'Hosty', 'host name is shown');
select is(get_invite((select token from t)) -> 'my_rsvp', 'null'::jsonb, 'no RSVP yet');

-- anon cannot write RSVPs directly through the function
select throws_ok($$ select upsert_rsvp((select token from t), 'guest-token-aaaaaaaaaaaaaaa', 'X', 'going') $$,
  '42501', null, 'anon cannot call upsert_rsvp (server only)');

-- Server (service role) RSVPs on behalf of guests
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$ select upsert_rsvp((select token from t), 'guest-token-aaaaaaaaaaaaaaa', ' Anna ', 'maybe') $$,
  'guest can RSVP with just a name');
select lives_ok($$ select upsert_rsvp((select token from t), 'guest-token-aaaaaaaaaaaaaaa', 'Anna', 'going') $$,
  'guest can change their answer');
select upsert_rsvp((select token from t), 'guest-token-bbbbbbbbbbbbbbb', 'Bo', 'declined');
select is((select count(*)::int from rsvps where event_id = '10000000-0000-0000-0000-000000000001'), 2, 'changing an answer updates instead of duplicating');
select throws_ok($$ select upsert_rsvp((select token from t), 'guest-token-ccccccccccccccc', '  ', 'going') $$,
  'P0001', 'name_required', 'a name is required');

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(get_invite((select token from t), 'guest-token-aaaaaaaaaaaaaaa') -> 'my_rsvp' ->> 'status', 'going',
  'guest sees their own answer on the same device');
select is(get_invite((select token from t), 'guest-token-zzzzzzzzzzzzzzz') -> 'my_rsvp', 'null'::jsonb,
  'a different device is a new guest');
select is(jsonb_array_length(get_invite((select token from t)) -> 'guests'), 1,
  'guest list shows going/maybe only, not declined');
select is((get_invite((select token from t)) -> 'counts' ->> 'going')::int, 1, 'going count is shown');

-- Signed-in member RSVPs from the app
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is(rsvp_as_user((select token from t), 'going') ->> 'display_name', 'Member', 'signed-in user RSVPs with profile name');

-- Hidden guest list
reset role;
update events set guest_list_visible = false where id = '10000000-0000-0000-0000-000000000001';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(get_invite((select token from t)) -> 'guests', 'null'::jsonb, 'hidden guest list shows no names');
select is((get_invite((select token from t)) -> 'counts' ->> 'going')::int, 2, 'hidden guest list still shows the count');

-- Withdraw
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select ok(withdraw_rsvp((select token from t), 'guest-token-aaaaaaaaaaaaaaa'), 'guest can withdraw');
select is((select count(*)::int from rsvps where display_name = 'Anna'), 0, 'withdrawn response is deleted');

-- Cancelled event
reset role;
update events set cancelled_at = now() where id = '10000000-0000-0000-0000-000000000001';
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select upsert_rsvp((select token from t), 'guest-token-ddddddddddddddd', 'Late', 'going') $$,
  'P0001', 'event_closed', 'cancelled events take no RSVPs');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(get_invite((select token from t)), '{"state":"cancelled","event":{"title":"Party"}}'::jsonb,
  'cancelled invite shows only title and state');

-- Date-pending events (add-date-polls, task 3.2)
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
create temp table p as select public.create_poll_event(
  jsonb_build_object('title', 'Poll party', 'location_text', 'Secret St 2'),
  jsonb_build_array(jsonb_build_object('starts_at', now() + interval '1 day'),
                    jsonb_build_object('starts_at', now() + interval '2 days', 'ends_at', now() + interval '2 days 3 hours'))) as r;
grant select on p to anon, authenticated, service_role;
create function pg_temp.o(n int) returns uuid language sql as $$
  select id from date_poll_options where event_id = (select (r ->> 'event_id')::uuid from p) order by starts_at offset n - 1 limit 1
$$;
select submit_votes((select r ->> 'token' from p), 'guest-token-p1111111111111', 'Pia',
  jsonb_build_array(jsonb_build_object('option_id', pg_temp.o(1), 'choice', 'yes'),
                    jsonb_build_object('option_id', pg_temp.o(2), 'choice', 'no')));
select submit_votes((select r ->> 'token' from p), 'guest-token-p2222222222222', 'Per',
  jsonb_build_array(jsonb_build_object('option_id', pg_temp.o(1), 'choice', 'if_needed'),
                    jsonb_build_object('option_id', pg_temp.o(2), 'choice', 'yes')));
select submit_votes((select r ->> 'token' from p), 'guest-token-p3333333333333', 'Nils',
  jsonb_build_array(jsonb_build_object('option_id', pg_temp.o(1), 'choice', 'no')));
create temp table opt_ids as select pg_temp.o(1) as o1, pg_temp.o(2) as o2;
grant select on opt_ids to anon, authenticated, service_role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
create temp table inv as select get_invite((select r ->> 'token' from p), 'guest-token-p1111111111111') as j;
select is((select j ->> 'state' from inv), 'date_pending', 'a pending invite has state date_pending');
select ok((select not (j ? 'counts') and not (j ? 'guests') and not (j ? 'my_rsvp') from inv),
  'a pending invite has no counts, guest list or RSVP');
select is((select j -> 'event' -> 'starts_at' from inv), 'null'::jsonb, 'a pending invite has no start time');
select is((select j -> 'poll' -> 'options' -> 0 -> 'tallies' from inv), '{"yes": 1, "if_needed": 1, "no": 1}'::jsonb,
  'guests see the tallies per option');
select is((select j -> 'poll' -> 'options' -> 0 -> 'voters' from inv),
  '[{"display_name": "Pia", "choice": "yes"}, {"display_name": "Per", "choice": "if_needed"}]'::jsonb,
  'with the guest list shown, guests see Yes and If needed names but never No');
select is((select j -> 'my_votes' from inv),
  jsonb_build_object('display_name', 'Pia', 'votes', jsonb_build_object((select o1 from opt_ids), 'yes', (select o2 from opt_ids), 'no')),
  'the guest''s own ballot is returned to the same device');
select is((select j -> 'poll' -> 'voting_open' from inv), 'true'::jsonb, 'voting is open');
select is(get_invite((select r ->> 'token' from p)) -> 'my_votes', 'null'::jsonb, 'another device sees no ballot');

reset role;
update events set guest_list_visible = false where id = (select (r ->> 'event_id')::uuid from p);
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(get_invite((select r ->> 'token' from p)) -> 'poll' -> 'options' -> 0 -> 'voters', 'null'::jsonb,
  'with the guest list hidden, guests see tallies only');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select throws_ok($$ select upsert_rsvp((select r ->> 'token' from p), 'guest-token-p1111111111111', 'Pia', 'going') $$,
  'P0001', 'date_pending', 'web RSVPs are rejected while the date is pending');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select throws_ok($$ select rsvp_as_user((select r ->> 'token' from p), 'going') $$,
  'P0001', 'date_pending', 'app RSVPs are rejected while the date is pending');

-- Deadline passed / every option passed
reset role;
select set_config('checkin.poll_rpc', 'on', true);
update events set poll_closes_at = now() - interval '1 minute' where id = (select (r ->> 'event_id')::uuid from p);
select set_config('checkin.poll_rpc', '', true);
select is(get_invite((select r ->> 'token' from p)) -> 'poll' -> 'voting_open', 'false'::jsonb,
  'after the deadline voting is closed (options and tallies still shown)');
update date_poll_options set starts_at = starts_at - interval '3 days', ends_at = ends_at - interval '3 days' where event_id = (select (r ->> 'event_id')::uuid from p);
select is((get_invite((select r ->> 'token' from p)) -> 'poll') - 'options' - 'closes_at',
  '{"expired": true, "voting_open": false, "voter_count": 3}'::jsonb, 'when every option has passed the poll is expired');

-- Picked
update date_poll_options set starts_at = starts_at + interval '5 days', ends_at = ends_at + interval '5 days' where event_id = (select (r ->> 'event_id')::uuid from p);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select pick_poll_option((select o1 from opt_ids));
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(get_invite((select r ->> 'token' from p)) ->> 'state', 'active', 'a picked event returns the normal active state');

select * from finish();
rollback;
