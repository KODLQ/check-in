-- Guest capacity, part 1 (change: add-guest-capacity, tasks 1.2, 2.2, 2.3, 2.8): columns and constraints,
-- head counting, plus-one rules, the RPC signatures/payloads and the guest-facing invite payload.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

\ir fixtures/capacity.psql

-- ---------------------------------------------------------------------------------------------
-- 1.2 Columns, defaults, constraints
select has_column('public', 'events', 'allow_plus_ones', 'events.allow_plus_ones exists');
select has_column('public', 'events', 'max_plus_ones', 'events.max_plus_ones exists');
select has_column('public', 'events', 'capacity', 'events.capacity exists');
select has_column('public', 'rsvps', 'plus_ones', 'rsvps.plus_ones exists');
select has_column('public', 'rsvps', 'waitlisted_at', 'rsvps.waitlisted_at exists');
select has_column('public', 'rsvps', 'promoted_at', 'rsvps.promoted_at exists');
select ok('waitlisted' = any (enum_range(null::public.rsvp_status)::text[]), 'rsvp_status has waitlisted');

-- An event and answer created the old way get the "no plus-ones, unlimited" defaults.
insert into public.events (id, host_id, title, starts_at, location_text)
values ('ca000000-0000-0000-0000-000000000001', :'O', 'Old style', now() + interval '1 day', 'X');
insert into public.rsvps (event_id, guest_token_hash, display_name, status)
values ('ca000000-0000-0000-0000-000000000001', public.hash_guest_token(pg_temp.guest_token('old')), 'Old', 'going');
select is((select array[allow_plus_ones::text, max_plus_ones::text, coalesce(capacity::text, 'null')]
           from public.events where id = 'ca000000-0000-0000-0000-000000000001'),
  array['false', '1', 'null'], 'existing events: plus-ones off, max 1, no capacity');
select is((select array[plus_ones::text, coalesce(waitlisted_at::text, 'null'), coalesce(promoted_at::text, 'null')]
           from public.rsvps where event_id = 'ca000000-0000-0000-0000-000000000001'),
  array['0', 'null', 'null'], 'existing answers: no plus-ones, not waitlisted, not promoted');

select throws_ok($$ update public.events set max_plus_ones = 0 where id = 'ca000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'max plus-ones 0 is rejected');
select throws_ok($$ update public.events set max_plus_ones = 6 where id = 'ca000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'max plus-ones 6 is rejected');
select throws_ok($$ update public.events set capacity = 0 where id = 'ca000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'capacity 0 is rejected');
select throws_ok($$ update public.events set capacity = 3001 where id = 'ca000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'capacity above 3000 is rejected');
select throws_ok($$ update public.rsvps set status = 'maybe', plus_ones = 1 where event_id = 'ca000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'plus-ones on Maybe are rejected');
select throws_ok($$ update public.rsvps set status = 'waitlisted' where event_id = 'ca000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'waitlisted without waitlisted_at is rejected');
select throws_ok($$ update public.rsvps set waitlisted_at = now() where event_id = 'ca000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'Going with waitlisted_at is rejected');
select throws_ok($$ update public.rsvps set plus_ones = 6 where event_id = 'ca000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'more than 5 plus-ones is rejected');

-- ---------------------------------------------------------------------------------------------
-- Heads (spec: Capacity counts heads)
select pg_temp.mk_event('ca000000-0000-0000-0000-000000000002', 'CapHeads0001', 10, true, 2);
select pg_temp.g('CapHeads0001', 'Ann', 'going', 0);
select pg_temp.g('CapHeads0001', 'Ben', 'going', 1);
select pg_temp.g('CapHeads0001', 'Cat', 'going', 2);
select pg_temp.g('CapHeads0001', 'Dan', 'maybe');
select pg_temp.g('CapHeads0001', 'Eve', 'declined');
select is(pg_temp.heads('ca000000-0000-0000-0000-000000000002'), 6, 'heads = sum of 1 + plus-ones over Going only');
select is(public.get_invite('CapHeads0001') -> 'counts',
  '{"going": 6, "maybe": 1, "waitlist": 0, "spots_left": 4, "full": false}'::jsonb,
  'invite counts: 6 of 10 taken, 4 remain');
select is(public.get_invite('CapHeads0001') -> 'event' -> 'capacity', '10'::jsonb, 'invite shows the capacity');
select is(public.get_invite('CapHeads0001') -> 'event' ->> 'max_plus_ones', '2', 'invite shows the plus-one max');
select is((select jsonb_agg(x -> 'plus_ones' order by x ->> 'display_name')
           from jsonb_array_elements(public.get_invite('CapHeads0001') -> 'guests') x),
  '[0, 1, 2, 0]'::jsonb, 'visible guests carry their plus-ones (Going and Maybe only)');

-- ---------------------------------------------------------------------------------------------
-- Plus-one rules (spec: event-rsvp RSVP without account)
select is(pg_temp.g('CapHeads0001', 'Fay', 'going', 2) - 'email_updates',
  '{"status": "going", "display_name": "Fay", "plus_ones": 2, "waitlist_position": null, "spots_left": 1}'::jsonb,
  'Going +2 is saved and returned with spots left');
select throws_ok($$ select pg_temp.g('CapHeads0001', 'Gus', 'going', 3) $$, 'P0001', 'too_many_plus_ones',
  'more plus-ones than the host''s maximum are rejected');
select is(pg_temp.st('ca000000-0000-0000-0000-000000000002', 'Gus'), null, 'a rejected answer is not saved');
select is(pg_temp.g('CapHeads0001', 'Cat', 'maybe') ->> 'plus_ones', '0', 'Maybe drops plus-ones');
select throws_ok($$ select pg_temp.g('CapHeads0001', 'Hal', 'waitlisted') $$, 'P0001', 'invalid_status',
  'clients cannot answer "waitlisted"');
select throws_ok($$ select pg_temp.g('CapHeads0001', 'Hal', 'going', -1) $$, 'P0001', 'too_many_plus_ones',
  'negative plus-ones are rejected');

select pg_temp.mk_event('ca000000-0000-0000-0000-000000000003', 'CapNoPlus001', null);
select throws_ok($$ select pg_temp.g('CapNoPlus001', 'Ann', 'going', 1) $$, 'P0001', 'plus_ones_not_allowed',
  'plus-ones are rejected when the host has not allowed them');
select is(pg_temp.g('CapNoPlus001', 'Ann', 'going', 0) ->> 'status', 'going', '+0 is fine without plus-ones');

-- Existing callers: the 4-argument named call and email-only changes keep the current plus-ones.
select is(public.upsert_rsvp(p_token => 'CapHeads0001', p_guest_token => pg_temp.guest_token('Fay'),
                             p_display_name => 'Fay', p_status => 'going') ->> 'plus_ones', '2',
  'a named call without p_plus_ones keeps Going +2');
select is(public.upsert_rsvp('CapHeads0001', pg_temp.guest_token('Fay'), 'Fay', 'going', null, null, 'remove', 'en')
            ->> 'plus_ones', '2', 'the 8-argument (email) call keeps plus-ones');

-- Host turns plus-ones off / lowers the maximum: existing answers keep theirs until they change.
update public.events set allow_plus_ones = false where id = 'ca000000-0000-0000-0000-000000000002';
select is(pg_temp.st('ca000000-0000-0000-0000-000000000002', 'Fay') || '+' ||
          (select plus_ones from public.rsvps where id = pg_temp.rid('ca000000-0000-0000-0000-000000000002', 'Fay')),
  'going+2', 'turning plus-ones off keeps existing plus-ones');
select is(pg_temp.g('CapHeads0001', 'Fay', 'going', 2) ->> 'plus_ones', '2', 're-sending the same +2 is allowed');
select throws_ok($$ select pg_temp.g('CapHeads0001', 'Fay', 'going', 1) $$, 'P0001', 'plus_ones_not_allowed',
  'a changed answer cannot add plus-ones once they are off');
update public.events set allow_plus_ones = true, max_plus_ones = 1 where id = 'ca000000-0000-0000-0000-000000000002';
select throws_ok($$ select pg_temp.g('CapHeads0001', 'Ben', 'going', 2) $$, 'P0001', 'too_many_plus_ones',
  'a lowered maximum applies to changed answers');
select is(pg_temp.g('CapHeads0001', 'Fay', 'going', 0) ->> 'plus_ones', '0', 'lowering to +0 is always allowed');

-- ---------------------------------------------------------------------------------------------
-- 2.3 Signatures, grants and payloads
select has_function('public', 'upsert_rsvp',
  array['text', 'text', 'text', 'rsvp_status', 'text', 'text', 'text', 'text', 'integer'], 'upsert_rsvp takes p_plus_ones');
select hasnt_function('public', 'upsert_rsvp',
  array['text', 'text', 'text', 'rsvp_status', 'text', 'text', 'text', 'text'], 'old 8-argument upsert_rsvp is gone');
select has_function('public', 'rsvp_as_user', array['text', 'rsvp_status', 'integer'], 'rsvp_as_user takes p_plus_ones');
select has_function('public', 'set_my_rsvp', array['uuid', 'rsvp_status', 'integer'], 'set_my_rsvp takes p_plus_ones');
select ok(not has_function_privilege('authenticated', 'public.upsert_rsvp(text, text, text, rsvp_status, text, text, text, text, integer)', 'execute'),
  'upsert_rsvp stays service-role only');

-- In-app RSVP with plus-ones.
set local role authenticated;
:as_U
select is(public.rsvp_as_user('CapHeads0001', 'going', 1) - 'spots_left',
  '{"status": "going", "display_name": "Ulla", "plus_ones": 1, "waitlist_position": null}'::jsonb,
  'rsvp_as_user saves Going +1 with the profile name');
select is(public.rsvp_as_user('CapHeads0001', 'going') ->> 'plus_ones', '1', 'rsvp_as_user without p_plus_ones keeps them');
select is(public.set_my_rsvp('ca000000-0000-0000-0000-000000000002', 'maybe') ->> 'plus_ones', '0',
  'set_my_rsvp Maybe drops plus-ones');
select is(public.set_my_rsvp('ca000000-0000-0000-0000-000000000002', 'going', 1) ->> 'plus_ones', '1',
  'set_my_rsvp Going +1');
select throws_ok($$ select public.set_my_rsvp('ca000000-0000-0000-0000-000000000002', 'going', 4) $$, 'P0001',
  'too_many_plus_ones', 'set_my_rsvp respects the maximum');
select is((public.get_my_invite('ca000000-0000-0000-0000-000000000002') -> 'my_rsvp') - 'display_name',
  '{"status": "going", "plus_ones": 1, "waitlist_position": null, "promoted": false}'::jsonb,
  'get_my_invite shows the own plus-ones and waitlist state');
select is((select x -> 'my_rsvp' ->> 'plus_ones' from jsonb_array_elements(public.list_my_invites()) x
           where x ->> 'id' = 'ca000000-0000-0000-0000-000000000002'), '1', 'list_my_invites carries plus-ones');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------------------------
-- 2.8 get_invite: full state, hidden waitlist names, own waitlist position, not-found unchanged
select pg_temp.mk_event('ca000000-0000-0000-0000-000000000004', 'CapFull00001', 2, true, 3);
select pg_temp.g('CapFull00001', 'Ann', 'going', 1);
select pg_temp.g('CapFull00001', 'Ben', 'going', 3);
select pg_temp.g('CapFull00001', 'Cat', 'going');
select is(public.get_invite('CapFull00001') -> 'counts',
  '{"going": 2, "maybe": 0, "waitlist": 5, "spots_left": 0, "full": true}'::jsonb,
  'full event: no spots, waitlist counted in heads');
select is((select jsonb_agg(x ->> 'display_name') from jsonb_array_elements(public.get_invite('CapFull00001') -> 'guests') x),
  '["Ann"]'::jsonb, 'waitlisted guests are never listed to guests');
select is(public.get_invite('CapFull00001', pg_temp.guest_token('Cat')) -> 'my_rsvp' ->> 'waitlist_position', '2',
  'a waitlisted guest sees their position');
select is(public.get_invite('CapFull00001', pg_temp.guest_token('Ben')) -> 'my_rsvp' ->> 'status', 'waitlisted',
  'a waitlisted guest sees the waitlisted status');
update public.events set guest_list_visible = false where id = 'ca000000-0000-0000-0000-000000000004';
select is(public.get_invite('CapFull00001') -> 'guests', 'null'::jsonb, 'hidden guest list still hides names');
select is(public.get_invite('CapNotThere1'), '{"state": "not_found"}'::jsonb, 'unknown tokens are still not_found');

select * from finish();
rollback;
