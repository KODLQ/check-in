begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

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
select is((select count(*)::int from rsvps), 2, 'changing an answer updates instead of duplicating');
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

select * from finish();
rollback;
