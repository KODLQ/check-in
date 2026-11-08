begin;
create extension if not exists pgtap with schema extensions;
select plan(60);

-- Users: host H, guest-with-account S ("Sara Berg"), B, C (no RSVPs), R (rate limit), N (no name yet).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'mi-host@test.dev'),
  ('00000000-0000-0000-0000-0000000000a2', 'mi-sara@test.dev'),
  ('00000000-0000-0000-0000-0000000000a3', 'mi-bo@test.dev'),
  ('00000000-0000-0000-0000-0000000000a4', 'mi-cleo@test.dev'),
  ('00000000-0000-0000-0000-0000000000a5', 'mi-rate@test.dev'),
  ('00000000-0000-0000-0000-0000000000a6', 'mi-noname@test.dev');
update profiles set display_name = 'Hosty' where id = '00000000-0000-0000-0000-0000000000a1';
update profiles set display_name = 'Sara Berg' where id = '00000000-0000-0000-0000-0000000000a2';
update profiles set display_name = 'Bo' where id = '00000000-0000-0000-0000-0000000000a3';
update profiles set display_name = 'Cleo' where id = '00000000-0000-0000-0000-0000000000a4';
update profiles set display_name = 'Rate' where id = '00000000-0000-0000-0000-0000000000a5';

-- Active events by H (E1, E2, E6) and by S (E5).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
insert into events (id, title, starts_at, location_text) values
  ('a0000000-0000-0000-0000-000000000001', 'E1', now() + interval '2 days', 'Secret St 1'),
  ('a0000000-0000-0000-0000-000000000002', 'E2', now() + interval '3 days', 'X'),
  ('a0000000-0000-0000-0000-000000000006', 'E6', now() + interval '4 days', 'X');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
insert into events (id, title, starts_at, location_text) values
  ('a0000000-0000-0000-0000-000000000005', 'Sara party', now() + interval '5 days', 'X');
reset role;

-- Ended (E3) and cancelled (E4) events by H.
set local session_replication_role = replica;
insert into events (id, host_id, title, starts_at, location_text, cancelled_at) values
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-0000000000a1', 'E3', now() - interval '3 days', 'X', null),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-0000000000a1', 'E4', now() + interval '6 days', 'X', now());
set local session_replication_role = origin;

create temp table tok as select event_id, token from event_invites
  where event_id::text like 'a0000000-0000-0000-0000-00000000000%';
create temp table tk (name text primary key, ticket text);
grant select on tok to anon, authenticated, service_role;
grant all on tk to anon, authenticated, service_role;

-- ===== 1.1 identity constraint, ticket table RLS, retention =====
select lives_ok($$
  insert into rsvps (event_id, user_id, guest_token_hash, display_name, status)
  values ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a3', repeat('b', 64), 'Both', 'going')
$$, 'a row with both an account and a guest token is accepted');
select throws_ok($$
  insert into rsvps (event_id, display_name, status) values ('a0000000-0000-0000-0000-000000000006', 'Nobody', 'going')
$$, '23514', null, 'a row with no identity is rejected');
delete from rsvps where display_name = 'Both';

insert into rsvp_claim_tickets (ticket_hash, guest_token_hash, created_at, expires_at, used_at) values
  (repeat('1', 64), repeat('a', 64), now() - interval '2 hours', now() + interval '22 hours', now() - interval '1 hour'),
  (repeat('2', 64), repeat('a', 64), now() - interval '25 hours', now() - interval '1 hour', null),
  (repeat('3', 64), repeat('a', 64), now(), now() + interval '24 hours', null);

set local role anon;
select throws_ok($$ select * from rsvp_claim_tickets $$, '42501', null, 'anon cannot read claim tickets');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select throws_ok($$ select * from rsvp_claim_tickets $$, '42501', null, 'authenticated cannot read claim tickets');
select throws_ok($$ insert into rsvp_claim_tickets (ticket_hash, guest_token_hash) values (repeat('4', 64), repeat('a', 64)) $$,
  '42501', null, 'authenticated cannot insert claim tickets');
reset role;

select run_retention(now());
select is((select array_agg(ticket_hash) from rsvp_claim_tickets where ticket_hash in (repeat('1', 64), repeat('2', 64), repeat('3', 64))),
  array[repeat('3', 64)], 'retention deletes used and expired tickets and keeps fresh ones');
delete from rsvp_claim_tickets where ticket_hash = repeat('3', 64);

-- ===== 1.2 create_claim_ticket =====
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select create_claim_ticket('guest-token-sara-aaaaaaaaaa') $$, '42501', null, 'anon cannot create tickets');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select throws_ok($$ select create_claim_ticket('guest-token-sara-aaaaaaaaaa') $$, '42501', null, 'authenticated cannot create tickets');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into tk values ('first', create_claim_ticket('guest-token-sara-aaaaaaaaaa'));
select ok((select char_length(ticket) >= 22 from tk where name = 'first'), 'a ticket has at least 22 characters');
select throws_ok($$ select create_claim_ticket('short') $$, 'P0001', 'invalid_guest_token', 'short guest tokens are rejected');
reset role;
select is((select guest_token_hash from rsvp_claim_tickets where ticket_hash = hash_claim_ticket((select ticket from tk where name = 'first'))),
  hash_guest_token('guest-token-sara-aaaaaaaaaa'), 'only the ticket hash and guest token hash are stored');
select is((select count(*)::int from rsvp_claim_tickets
           where ticket_hash = (select ticket from tk where name = 'first') or guest_token_hash = 'guest-token-sara-aaaaaaaaaa'),
  0, 'raw ticket and guest token are not stored');

-- ===== 1.3 claim_guest_rsvps =====
-- Browser G (Sara's phone) answered E1 ("Sara B", maybe, with email), E2 (going, newer than the app answer),
-- E6 (declined, older than the app answer), ended E3 and cancelled E4. S answered E2 and E6 in the app.
insert into rsvps (id, event_id, user_id, guest_token_hash, display_name, status, updated_at) values
  ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', null, hash_guest_token('guest-token-sara-aaaaaaaaaa'), 'Sara B', 'maybe', now() - interval '1 hour'),
  ('b0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', null, hash_guest_token('guest-token-sara-aaaaaaaaaa'), 'Sara B', 'going', now() - interval '1 hour'),
  ('b0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2', null, 'Sara Berg', 'maybe', now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000006', null, hash_guest_token('guest-token-sara-aaaaaaaaaa'), 'Sara B', 'declined', now() - interval '2 hours'),
  ('b0000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-0000000000a2', null, 'Sara Berg', 'going', now() - interval '1 hour'),
  ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', null, hash_guest_token('guest-token-sara-aaaaaaaaaa'), 'Sara B', 'going', now() - interval '4 days'),
  ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', null, hash_guest_token('guest-token-sara-aaaaaaaaaa'), 'Sara B', 'going', now() - interval '1 day');
insert into rsvp_email_subscriptions (rsvp_id, event_id, email, consent_at, consent_version)
values ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'sara@x.se', now(), 'v');
create temp table digest_before as
  select count(*)::int as n from notifications where kind = 'rsvp_digest' and event_id::text like 'a0000000%';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select claim_guest_rsvps((select ticket from tk where name = 'first')) $$, '42501', null, 'anon cannot claim');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
select throws_ok($$ select claim_guest_rsvps((select ticket from tk where name = 'first')) $$, 'P0001', 'name_required',
  'a user without a display name cannot claim yet');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is(claim_guest_rsvps((select ticket from tk where name = 'first')), '{"claimed": 3, "merged": 2}'::jsonb,
  'claiming links three responses and merges two');
reset role;

select is((select count(*)::int from rsvps where user_id = '00000000-0000-0000-0000-0000000000a2' and event_id::text like 'a0000000%'),
  5, 'the account now holds one response per event');
select is((select count(*)::int from rsvps where guest_token_hash = hash_guest_token('guest-token-sara-aaaaaaaaaa') and user_id is null),
  0, 'no unclaimed guest rows are left behind');
select is((select display_name || '/' || status || '/' || (guest_token_hash = hash_guest_token('guest-token-sara-aaaaaaaaaa'))::text
           from rsvps where id = 'b0000000-0000-0000-0000-000000000001'),
  'Sara B/maybe/true', 'a claimed row keeps its display name, answer and guest token hash');
select is((select status::text from rsvps where event_id = 'a0000000-0000-0000-0000-000000000002'), 'going',
  'a newer browser answer wins the merge (single row)');
select is((select guest_token_hash from rsvps where id = 'b0000000-0000-0000-0000-000000000012'),
  hash_guest_token('guest-token-sara-aaaaaaaaaa'), 'the merged account row is now editable from the browser');
select is((select status::text from rsvps where event_id = 'a0000000-0000-0000-0000-000000000006'), 'going',
  'an older browser answer loses the merge (single row)');
select is((select count(*)::int from rsvps where event_id in ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004')
           and user_id = '00000000-0000-0000-0000-0000000000a2'), 2, 'responses to ended and cancelled events are claimed');
select is((select count(*)::int from rsvp_email_subscriptions where rsvp_id = 'b0000000-0000-0000-0000-000000000001'), 0,
  'email updates of a claimed response are dropped (app users get push)');
select is((select count(*)::int from notifications where kind = 'rsvp_digest' and event_id::text like 'a0000000%'),
  (select n from digest_before), 'claiming does not notify the host');
select is((select used_at is not null from rsvp_claim_tickets where ticket_hash = hash_claim_ticket((select ticket from tk where name = 'first'))),
  true, 'the ticket is marked used');

-- Reused, unknown and expired tickets fail identically.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into tk values ('expired', create_claim_ticket('guest-token-sara-aaaaaaaaaa'));
insert into tk values ('second', create_claim_ticket('guest-token-sara-aaaaaaaaaa'));
insert into tk values ('empty', create_claim_ticket('guest-token-nobody-aaaaaaa'));
reset role;
update rsvp_claim_tickets set expires_at = now() - interval '1 second'
where ticket_hash = hash_claim_ticket((select ticket from tk where name = 'expired'));

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
select is(claim_guest_rsvps((select ticket from tk where name = 'first')), '{"error": "invalid_ticket"}'::jsonb, 'a reused ticket fails');
select is(claim_guest_rsvps('AAAAAAAAAAAAAAAAAAAAAA'), '{"error": "invalid_ticket"}'::jsonb, 'an unknown ticket fails identically');
select is(claim_guest_rsvps((select ticket from tk where name = 'expired')), '{"error": "invalid_ticket"}'::jsonb, 'an expired ticket fails identically');
select is(claim_guest_rsvps((select ticket from tk where name = 'second')), '{"claimed": 0, "merged": 0}'::jsonb,
  'another account cannot take responses already claimed by S');
select is(claim_guest_rsvps((select ticket from tk where name = 'empty')), '{"claimed": 0, "merged": 0}'::jsonb,
  'a browser without responses claims nothing');

-- Rate limit: 10 attempts per account per hour, failed attempts included.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a5","role":"authenticated"}', true);
select is((select count(*)::int from generate_series(1, 10) i where claim_guest_rsvps('guess-' || i) ->> 'error' = 'invalid_ticket'),
  10, 'ten guesses are answered');
select throws_ok($$ select claim_guest_rsvps('guess-11') $$, 'P0001', 'rate_limited', 'the 11th attempt in an hour is rate limited');
reset role;

-- Same browser after claiming: the claimed row is updated, still owned by S, no duplicate.
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select upsert_rsvp((select token from tok where event_id = 'a0000000-0000-0000-0000-000000000001'), 'guest-token-sara-aaaaaaaaaa', 'Sara B', 'declined');
reset role;
select is((select string_agg(status::text || '/' || coalesce(user_id::text, '-'), ',') from rsvps where event_id = 'a0000000-0000-0000-0000-000000000001'),
  'declined/00000000-0000-0000-0000-0000000000a2', 'the browser still edits the claimed response');

-- ===== 1.4 rsvp_as_user keeps the display name =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is(rsvp_as_user((select token from tok where event_id = 'a0000000-0000-0000-0000-000000000001'), 'going') ->> 'display_name',
  'Sara B', 'changing a claimed answer in the app keeps its name');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
select is(rsvp_as_user((select token from tok where event_id = 'a0000000-0000-0000-0000-000000000001'), 'maybe') ->> 'display_name',
  'Bo', 'a first app RSVP uses the profile name');
-- S answers her own event (excluded from her invites).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select rsvp_as_user((select token from tok where event_id = 'a0000000-0000-0000-0000-000000000005'), 'going');
reset role;
select is((select display_name from rsvps where event_id = 'a0000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-0000000000a2'),
  'Sara B', 'the host still sees the claimed name');

-- ===== 2.1 invite_payload is internal =====
set local role anon;
select throws_ok($$ select invite_payload(e, null::rsvps) from events e limit 1 $$, '42501', null, 'anon cannot execute invite_payload');
set local role authenticated;
select throws_ok($$ select invite_payload(null::events, null::rsvps) $$, '42501', null, 'authenticated cannot execute invite_payload');

-- ===== 2.2 list_my_invites =====
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is((select array_agg(x ->> 'title' order by x ->> 'title') from jsonb_array_elements(list_my_invites()) x),
  array['E1', 'E2', 'E3', 'E4', 'E6'], 'S sees her invites, but not the event she hosts');
select is((select x -> 'state' from jsonb_array_elements(list_my_invites()) x where x ->> 'title' = 'E3'), '"past"'::jsonb, 'ended invites are past');
select is((select x -> 'state' from jsonb_array_elements(list_my_invites()) x where x ->> 'title' = 'E4'), '"cancelled"'::jsonb, 'cancelled invites are cancelled');
select is((select x -> 'my_rsvp' from jsonb_array_elements(list_my_invites()) x where x ->> 'title' = 'E1'),
  '{"status": "going", "display_name": "Sara B"}'::jsonb, 'each invite carries the own answer');
select is((select x -> 'host' ->> 'display_name' from jsonb_array_elements(list_my_invites()) x where x ->> 'title' = 'E1'), 'Hosty', 'host name is included');
select is((select count(*)::int from jsonb_array_elements(list_my_invites()) x where x ? 'location_text' or x ? 'token' or x -> 'event' ? 'location_text'),
  0, 'no invite token or location in the list');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a3","role":"authenticated"}', true);
select is((select array_agg(x ->> 'title') from jsonb_array_elements(list_my_invites()) x), array['E1'], 'B sees only his own invites');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
select is(list_my_invites(), '[]'::jsonb, 'a user without RSVPs gets an empty list');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select list_my_invites() $$, '42501', null, 'anon cannot list invites');

-- ===== 2.3 get_my_invite / set_my_rsvp =====
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
select is(get_my_invite('a0000000-0000-0000-0000-000000000001'), get_my_invite(gen_random_uuid()),
  'a non-respondent gets the same answer as for an unknown event');
select is(get_my_invite('a0000000-0000-0000-0000-000000000001'), '{"state": "not_found"}'::jsonb, 'that answer is not_found');
select throws_ok($$ select set_my_rsvp('a0000000-0000-0000-0000-000000000001', 'going') $$, 'P0002', 'not_found',
  'a non-respondent cannot set an answer');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is(jsonb_array_length(get_my_invite('a0000000-0000-0000-0000-000000000001') -> 'guests'), 2, 'visible guest list shows names');
select is(get_my_invite('a0000000-0000-0000-0000-000000000001') -> 'event' ->> 'location_text', 'Secret St 1', 'details include the location');
select is((select jsonb_build_object('state', j -> 'state', 'title', j -> 'event' -> 'title', 'has_time', j -> 'event' ? 'starts_at',
                                     'has_location', j -> 'event' ? 'location_text', 'host', j -> 'host' -> 'display_name', 'mine', j -> 'my_rsvp' -> 'status')
           from get_my_invite('a0000000-0000-0000-0000-000000000004') j),
  '{"state": "cancelled", "title": "E4", "has_time": true, "has_location": false, "host": "Hosty", "mine": "going"}'::jsonb,
  'cancelled invite shows title, time, host and own answer only');
reset role;
update events set guest_list_visible = false where id = 'a0000000-0000-0000-0000-000000000001';
update event_invites set revoked_at = now() where event_id = 'a0000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is(get_my_invite('a0000000-0000-0000-0000-000000000001') -> 'guests', 'null'::jsonb, 'hidden guest list shows no names');
select is(set_my_rsvp('a0000000-0000-0000-0000-000000000001', 'maybe'), '{"status": "maybe", "display_name": "Sara B"}'::jsonb,
  'set_my_rsvp works after the link was revoked');
select is((select count(*)::int from rsvps where event_id = 'a0000000-0000-0000-0000-000000000001' and user_id = '00000000-0000-0000-0000-0000000000a2'),
  1, 'set_my_rsvp updates the single row');
select throws_ok($$ select set_my_rsvp('a0000000-0000-0000-0000-000000000004', 'maybe') $$, 'P0001', 'event_closed', 'cancelled events are closed');
select throws_ok($$ select set_my_rsvp('a0000000-0000-0000-0000-000000000003', 'maybe') $$, 'P0001', 'event_closed', 'ended events are closed');
delete from rsvps where event_id = 'a0000000-0000-0000-0000-000000000002';
reset role;
select is((select count(*)::int from rsvps where event_id = 'a0000000-0000-0000-0000-000000000002'), 0, 'a user can withdraw their own response through RLS');

-- ===== 2.4 account deletion removes claimed responses =====
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a2';
select is((select count(*)::int from rsvps where id in ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000004')),
  0, 'deleting the account removes its claimed responses on other hosts'' events');

select * from finish();
rollback;
