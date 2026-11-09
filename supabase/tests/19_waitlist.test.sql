-- Guest capacity, part 2 (change: add-guest-capacity, tasks 2.1, 2.2, 2.4-2.7, 6.2): waitlist admission,
-- order and position, automatic promotion on every path that frees a spot, manager actions, account
-- deletion, the retention sweep, claim merges and the promotion notification.
-- Concurrency (two sessions at once) can't be expressed in pgTAP: see supabase/tests/concurrency/.
begin;
create extension if not exists pgtap with schema extensions;
select plan(87);

\ir fixtures/capacity.psql

\set E1 'cb000000-0000-0000-0000-000000000001'
\set E2 'cb000000-0000-0000-0000-000000000002'
\set E3 'cb000000-0000-0000-0000-000000000003'
\set E4 'cb000000-0000-0000-0000-000000000004'
\set E5 'cb000000-0000-0000-0000-000000000005'
\set E6 'cb000000-0000-0000-0000-000000000006'
\set E7 'cb000000-0000-0000-0000-000000000007'
\set E8 'cb000000-0000-0000-0000-000000000008'
\set E9 'cb000000-0000-0000-0000-000000000009'

-- ---------------------------------------------------------------------------------------------
-- 2.1 Internal functions are not callable by clients
select ok(not has_function_privilege('authenticated', 'public.promote_from_waitlist(uuid)', 'execute'),
  'authenticated cannot call promote_from_waitlist');
select ok(not has_function_privilege('anon', 'public.promote_from_waitlist(uuid)', 'execute'),
  'anon cannot call promote_from_waitlist');
select ok(not has_function_privilege('authenticated',
  'public.save_rsvp_locked(public.events, uuid, text, text, public.rsvp_status, integer, boolean, boolean)', 'execute'),
  'authenticated cannot call save_rsvp_locked');
select ok(not has_function_privilege('authenticated', 'public.lock_event(uuid)', 'execute'), 'authenticated cannot call lock_event');
select ok(not has_function_privilege('anon', 'public.remove_rsvp(uuid)', 'execute'), 'anon cannot call remove_rsvp');
select ok(not has_function_privilege('anon', 'public.promote_waitlisted(uuid, boolean)', 'execute'), 'anon cannot call promote_waitlisted');
select ok(has_function_privilege('authenticated', 'public.remove_rsvp(uuid)', 'execute'), 'signed-in users can call remove_rsvp');

-- ---------------------------------------------------------------------------------------------
-- 2.2 Join the waitlist when full (E1: capacity 3, plus-ones up to 3)
select pg_temp.mk_event(:'E1', 'CapWait00001', 3, true, 3);
select pg_temp.g('CapWait00001', 'Ann', 'going', 1);
select is(pg_temp.g('CapWait00001', 'Ben', 'going', 1) ->> 'status', 'waitlisted',
  '1 spot left, Going +1 -> waitlisted');
select is(pg_temp.g('CapWait00001', 'Ben', 'going', 1) ->> 'waitlist_position', '1', 'and sees position #1');
select is(pg_temp.g('CapWait00001', 'Cat', 'going', 0) ->> 'status', 'going',
  'a new single guest who fits is admitted although Ben (+1) waits');
select is(pg_temp.heads(:'E1'), 3, 'event is full');
select pg_temp.g('CapWait00001', 'Dan', 'going', 0);
select pg_temp.g('CapWait00001', 'Eve', 'going', 2);
select is(array[pg_temp.pos(:'E1', 'Ben'), pg_temp.pos(:'E1', 'Dan'), pg_temp.pos(:'E1', 'Eve')], array[1, 2, 3],
  'waitlist ordered by join time');
select is((select plus_ones from public.rsvps where id = pg_temp.rid(:'E1', 'Eve')), 2::smallint,
  'waitlisted guests keep their requested plus-ones');

-- Changing only plus-ones while waitlisted keeps the place.
select pg_temp.g('CapWait00001', 'Eve', 'going', 1);
select is(pg_temp.pos(:'E1', 'Eve'), 3, 'waitlisted guest lowering plus-ones keeps position');
select pg_temp.g('CapWait00001', 'Ben', 'going', 3);
select is(pg_temp.pos(:'E1', 'Ben'), 1, 'waitlisted guest raising plus-ones keeps position');

-- Leave the waitlist by answering Maybe (spec: Leave the waitlist).
select is(pg_temp.g('CapWait00001', 'Dan', 'maybe') ->> 'status', 'maybe', 'waitlisted guest switches to Maybe');
select is((select waitlisted_at from public.rsvps where id = pg_temp.rid(:'E1', 'Dan')), null, 'and leaves the waitlist');
select is(pg_temp.pos(:'E1', 'Eve'), 2, 'the guest behind moves up');

-- A guest with no capacity is never waitlisted.
select pg_temp.mk_event(:'E2', 'CapNoLimit01', null, true, 5);
select is((select count(*)::int from generate_series(1, 30) i
           where pg_temp.g('CapNoLimit01', 'G' || i, 'going', 5) ->> 'status' = 'going'), 30,
  'without capacity every Going answer is accepted');

-- Answer fits exactly.
select pg_temp.mk_event(:'E3', 'CapExact0001', 4, true, 2);
select pg_temp.g('CapExact0001', 'Ann', 'going', 1);
select is(pg_temp.g('CapExact0001', 'Ben', 'going', 1) ->> 'status', 'going', '2 left, Going +1 -> Going');
select is(public.get_invite('CapExact0001') -> 'counts' -> 'full', 'true'::jsonb, 'and the event is full');

-- ---------------------------------------------------------------------------------------------
-- Automatic promotion
-- E1 now: Going Ann(+1) Cat(+0) = 3/3; waitlist Ben(+3), Eve(+1).
-- Cat withdraws -> 1 spot. Ben (needs 4) doesn't fit, Eve (needs 2) doesn't fit -> nobody.
select ok(public.withdraw_rsvp('CapWait00001', pg_temp.guest_token('Cat')), 'Cat withdraws');
select is(array[pg_temp.st(:'E1', 'Ben'), pg_temp.st(:'E1', 'Eve')], array['waitlisted', 'waitlisted'],
  'nobody fits in 1 spot: nobody promoted');
select pg_temp.g('CapWait00001', 'Fay', 'going', 0);
select is(pg_temp.st(:'E1', 'Fay'), 'going', 'a single guest who fits takes the free spot (invariant: nobody waiting fits)');
-- Ann (+1) goes to +0 -> 1 spot; Eve (+1) still needs 2; Ben 4. Then Ann -> Maybe frees 1 more -> Eve fits.
select is(pg_temp.g('CapWait00001', 'Ann', 'going', 0) ->> 'status', 'going', 'Going guest lowers plus-ones');
select is(pg_temp.g('CapWait00001', 'Ann', 'maybe') ->> 'status', 'maybe', 'then switches to Maybe');
select is(array[pg_temp.st(:'E1', 'Ben'), pg_temp.st(:'E1', 'Eve')], array['waitlisted', 'going'],
  'first in line (needs 4) is skipped, second (needs 2) is promoted');
select is(pg_temp.pos(:'E1', 'Ben'), 1, 'the skipped guest stays first');
select ok((select promoted_at is not null and waitlisted_at is null from public.rsvps where id = pg_temp.rid(:'E1', 'Eve')),
  'promotion sets promoted_at and clears waitlisted_at');
select is(public.get_invite('CapWait00001', pg_temp.guest_token('Eve')) -> 'my_rsvp' -> 'promoted', 'true'::jsonb,
  'the promoted guest sees "You got a spot"');
select is(pg_temp.g('CapWait00001', 'Eve', 'going') -> 'status', '"going"'::jsonb, 're-sending the same answer stays Going');
select is(public.get_invite('CapWait00001', pg_temp.guest_token('Eve')) -> 'my_rsvp' -> 'promoted', 'true'::jsonb,
  'an unchanged answer keeps the banner');
select pg_temp.g('CapWait00001', 'Eve', 'going', 0);
select is(public.get_invite('CapWait00001', pg_temp.guest_token('Eve')) -> 'my_rsvp' -> 'promoted', 'false'::jsonb,
  'the guest''s own change clears the banner');

-- Going guest lowers plus-ones on a full event: freed spots go to the waitlist (spec: event-rsvp).
select pg_temp.mk_event(:'E4', 'CapLower0001', 4, true, 2);
select pg_temp.g('CapLower0001', 'Ann', 'going', 2);
select pg_temp.g('CapLower0001', 'Ben', 'going', 0);
select pg_temp.g('CapLower0001', 'Cat', 'going', 0);
select pg_temp.g('CapLower0001', 'Dan', 'going', 1);
select is(pg_temp.g('CapLower0001', 'Ann', 'going', 0) ->> 'status', 'going', 'Ann goes from +2 to +0');
select is(array[pg_temp.st(:'E4', 'Cat'), pg_temp.st(:'E4', 'Dan')], array['going', 'waitlisted'],
  'the 2 freed spots go to Cat (1); Dan (+1 needs 2) keeps waiting');
-- Going guest adds plus-ones beyond what is left: rejected, keeps the answer, told spots left.
select throws_ok($$ select pg_temp.g('CapLower0001', 'Ben', 'going', 2) $$, 'P0001', 'capacity_exceeded',
  'Going guest asking for more plus-ones than spots left is rejected');
select is(pg_temp.st(:'E4', 'Ben') || (select plus_ones from public.rsvps where id = pg_temp.rid(:'E4', 'Ben')), 'going0',
  'and keeps the current Going answer');

-- ---------------------------------------------------------------------------------------------
-- 2.4 Withdraw / remove promote; direct DELETE is gone
select pg_temp.mk_event(:'E5', 'CapRemove001', 2, true, 1);
select pg_temp.g('CapRemove001', 'Ann', 'going', 1);
select pg_temp.g('CapRemove001', 'Ben', 'going', 0);
select pg_temp.g('CapRemove001', 'Cat', 'going', 0);
set local role authenticated;
:as_U
select is(public.rsvp_as_user('CapRemove001', 'going') ->> 'waitlist_position', '3', 'signed-in user joins the waitlist (#3)');
select is(public.remove_rsvp(pg_temp.rid(:'E5', 'Ann')), false, 'a guest cannot remove someone else');
:as_X
select is(public.remove_rsvp(pg_temp.rid(:'E5', 'Ann')), false, 'a stranger cannot remove a guest');
:as_O
delete from public.rsvps where event_id = :'E5';
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.rsvps where event_id = :'E5'), 4, 'direct DELETE by the owner removes nothing');
set local role authenticated;
:as_U
delete from public.rsvps where event_id = :'E5';
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.rsvps where event_id = :'E5'), 4, 'direct DELETE of the own row removes nothing');
set local role authenticated;
:as_K
select ok(public.remove_rsvp(pg_temp.rid(:'E5', 'Ann')), 'co-host removes a Going +1 guest');
reset role;
select set_config('request.jwt.claims', '', true);
select is(array[pg_temp.st(:'E5', 'Ben'), pg_temp.st(:'E5', 'Cat')], array['going', 'going'],
  'the 2 freed spots are filled from the waitlist in order');
select is(pg_temp.pos(:'E5', 'Ulla'), 1, 'the next guest moves up to #1');
set local role authenticated;
:as_U
select ok(public.set_my_rsvp(:'E5', 'declined') ->> 'status' = 'declined', 'waitlisted user declines in the app');
select ok(public.remove_rsvp(pg_temp.rid(:'E5', 'Ulla')), 'and can withdraw their own response');
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------------------------------------------------------------------------------------------
-- 2.5 Manager promotes out of order / over capacity
select pg_temp.mk_event(:'E6', 'CapPromote01', 3, false, 1);
select pg_temp.g('CapPromote01', 'Ann', 'going');
select pg_temp.g('CapPromote01', 'Ben', 'going');
select pg_temp.g('CapPromote01', 'Cat', 'going');
select pg_temp.g('CapPromote01', 'W1', 'going');
select pg_temp.g('CapPromote01', 'W2', 'going');
select pg_temp.g('CapPromote01', 'W3', 'going');
set local role authenticated;
:as_O
select throws_ok(format('select public.promote_waitlisted(%L)', pg_temp.rid(:'E6', 'W3')), 'P0001', 'over_capacity',
  'promoting on a full event needs confirmation');
:as_X
select throws_ok(format('select public.promote_waitlisted(%L, true)', pg_temp.rid(:'E6', 'W3')), 'P0002', 'not_found',
  'a non-manager cannot promote');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.st(:'E6', 'W3'), 'waitlisted', 'and nothing changed');
update public.events set capacity = 4 where id = :'E6';
select is(pg_temp.st(:'E6', 'W1'), 'going', 'raising capacity by 1 promotes the first in line');
-- Make room for one more out of order: owner promotes W3 (third... now second) while a spot remains.
update public.events set capacity = 5 where id = :'E6';
select is(pg_temp.st(:'E6', 'W2'), 'going', 'raising again promotes W2 (automatic, in order)');
select pg_temp.g('CapPromote01', 'W4', 'going');
select pg_temp.g('CapPromote01', 'W5', 'going');
-- Waitlist: W3, W4, W5. Free one spot so the owner can promote W5 out of order.
select ok(public.withdraw_rsvp('CapPromote01', pg_temp.guest_token('Ann')), 'Ann withdraws');
select is(pg_temp.st(:'E6', 'W3'), 'going', 'which promotes W3 automatically');
set local role authenticated;
:as_O
select throws_ok(format('select public.promote_waitlisted(%L)', pg_temp.rid(:'E6', 'W5')), 'P0001', 'over_capacity',
  'still full: over_capacity');
select is(public.promote_waitlisted(pg_temp.rid(:'E6', 'W5'), true) ->> 'status', 'going',
  'owner confirms going over capacity');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.heads(:'E6'), 6, 'Going heads now exceed capacity (6 / 5)');
select is(pg_temp.pos(:'E6', 'W4'), 1, 'others keep their order');
-- Lowering capacity below Going removes nobody; the next Going answer is waitlisted.
update public.events set capacity = 3 where id = :'E6';
select is(pg_temp.heads(:'E6'), 6, 'lowering capacity below Going keeps every Going guest');
select is(pg_temp.g('CapPromote01', 'W6', 'going') ->> 'status', 'waitlisted', 'the next new Going answer is waitlisted');
-- Co-host manages: promote out of order while a spot remains (W6 before W4).
update public.events set capacity = 7 where id = :'E6';
select is(array[pg_temp.st(:'E6', 'W4'), pg_temp.st(:'E6', 'W6')], array['going', 'waitlisted'],
  'raising to 7 promotes W4 only');
update public.events set capacity = null where id = :'E6';
select is(pg_temp.st(:'E6', 'W6'), 'going', 'clearing capacity promotes everyone left');
-- Out of order: 1 spot left, W1 needs 4, W2 needs 3, W3 needs 2 -> nobody fits automatically.
select pg_temp.mk_event(:'E7', 'CapCoHost001', 3, true, 3);
select pg_temp.g('CapCoHost001', 'Ann', 'going', 1);
select pg_temp.g('CapCoHost001', 'W1', 'going', 3);
select pg_temp.g('CapCoHost001', 'W2', 'going', 2);
select pg_temp.g('CapCoHost001', 'W3', 'going', 1);
set local role authenticated;
:as_K
select throws_ok(format('select public.promote_waitlisted(%L)', pg_temp.rid(:'E7', 'W3')), 'P0001', 'over_capacity',
  'co-host: the third guest does not fit the 1 spot left');
select is(public.promote_waitlisted(pg_temp.rid(:'E7', 'W3'), true) ->> 'status', 'going',
  'co-host promotes the third guest after confirming');
reset role;
select set_config('request.jwt.claims', '', true);
select is(array[pg_temp.pos(:'E7', 'W1'), pg_temp.pos(:'E7', 'W2')], array[1, 2], 'the others keep their order');
-- Co-host raising capacity through the events UPDATE policy also promotes (4 heads Going; 9 -> 5 free).
set local role authenticated;
:as_K
update public.events set capacity = 9 where id = :'E7';
reset role;
select set_config('request.jwt.claims', '', true);
select is(array[pg_temp.st(:'E7', 'W1'), pg_temp.st(:'E7', 'W2')], array['going', 'waitlisted'],
  'co-host raising capacity promotes as the owner would (W1 +3 fits, W2 +2 no longer does)');

-- ---------------------------------------------------------------------------------------------
-- Inactive events: nobody is promoted
select pg_temp.mk_event(:'E8', 'CapInactive1', 1, false, 1);
select pg_temp.g('CapInactive1', 'Ann', 'going');
select pg_temp.g('CapInactive1', 'Ben', 'going');
update public.events set cancelled_at = now() where id = :'E8';
delete from public.rsvps where id = pg_temp.rid(:'E8', 'Ann');
select is(pg_temp.st(:'E8', 'Ben'), 'waitlisted', 'cancelled event: a freed spot promotes nobody');
update public.events set cancelled_at = null where id = :'E8';
select pg_temp.g('CapInactive1', 'Cat', 'going');
set local session_replication_role = replica;
update public.events set starts_at = now() - interval '2 days' where id = :'E8';
set local session_replication_role = origin;
update public.rsvps set status = 'declined', waitlisted_at = null where id = pg_temp.rid(:'E8', 'Cat');
select is(pg_temp.st(:'E8', 'Ben'), 'waitlisted', 'ended event: a freed spot promotes nobody');

-- ---------------------------------------------------------------------------------------------
-- 2.7 Account deletion and the retention sweep
select pg_temp.mk_event(:'E9', 'CapAccount01', 1, false, 1);
set local role authenticated;
:as_V
select public.rsvp_as_user('CapAccount01', 'going');
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.g('CapAccount01', 'Ann', 'going');
select is(pg_temp.st(:'E9', 'Ann'), 'waitlisted', 'Ann waits behind Vera');
delete from auth.users where id = :'V';
select is(pg_temp.st(:'E9', 'Ann'), 'going', 'deleting Vera''s account promotes Ann');

-- A waitlisted guest who fits (only possible by bypassing the triggers) is promoted by the sweep.
set local session_replication_role = replica;
delete from public.rsvps where id = pg_temp.rid(:'E9', 'Ann');
set local session_replication_role = origin;
select pg_temp.g('CapAccount01', 'Ben', 'going');
set local session_replication_role = replica;
update public.rsvps set status = 'waitlisted', waitlisted_at = now() where id = pg_temp.rid(:'E9', 'Ben');
set local session_replication_role = origin;
select is(pg_temp.st(:'E9', 'Ben'), 'waitlisted', 'setup: a waitlisted guest fits but was not promoted');
select public.run_retention(now());
select is(pg_temp.st(:'E9', 'Ben'), 'going', 'run_retention promotes them (safety sweep)');

-- ---------------------------------------------------------------------------------------------
-- Claim merges (add-my-invites) respect capacity
-- E1 now: Going Fay(0) Eve(0) = 2/3 ... make it simple on a fresh event.
create temp table tk (ticket text);
grant select on tk to authenticated;
select pg_temp.mk_event('cb000000-0000-0000-0000-00000000000a', 'CapClaim0001', 2, false, 1);
set local role authenticated;
:as_U
select public.rsvp_as_user('CapClaim0001', 'going');
reset role;
select set_config('request.jwt.claims', '', true);
select pg_temp.g('CapClaim0001', 'UllaWeb', 'going');
-- Make the browser's answer the newer one (now() is constant within the test transaction).
set local session_replication_role = replica;
update public.rsvps set updated_at = now() - interval '1 hour' where event_id = 'cb000000-0000-0000-0000-00000000000a' and user_id = :'U';
set local session_replication_role = origin;
select pg_temp.g('CapClaim0001', 'Wait', 'going');
insert into tk select public.create_claim_ticket(pg_temp.guest_token('UllaWeb'));
set local role authenticated;
:as_U
select is(public.claim_guest_rsvps((select ticket from tk)), '{"claimed": 0, "merged": 1}'::jsonb, 'claim merges the duplicate');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.st('cb000000-0000-0000-0000-00000000000a', 'Wait'), 'going', 'the freed spot goes to the waitlist');
select is(pg_temp.heads('cb000000-0000-0000-0000-00000000000a'), 2, 'Going heads equal capacity after the merge');

-- Account Going, newer browser answer waitlisted: the account keeps its spot.
delete from tk;
select pg_temp.g('CapClaim0001', 'UllaWeb2', 'going');
select is(pg_temp.st('cb000000-0000-0000-0000-00000000000a', 'UllaWeb2'), 'waitlisted', 'setup: browser answer is waitlisted');
set local session_replication_role = replica;
update public.rsvps set updated_at = now() - interval '1 hour' where event_id = 'cb000000-0000-0000-0000-00000000000a' and user_id = :'U';
set local session_replication_role = origin;
insert into tk select public.create_claim_ticket(pg_temp.guest_token('UllaWeb2'));
set local role authenticated;
:as_U
select public.claim_guest_rsvps((select ticket from tk));
reset role;
select set_config('request.jwt.claims', '', true);
select is((select status::text from public.rsvps where event_id = 'cb000000-0000-0000-0000-00000000000a' and user_id = :'U'),
  'going', 'a newer waitlisted browser answer does not cost the account its spot');

-- ---------------------------------------------------------------------------------------------
-- 6.2 Notifications: one per promotion, none for ordinary answers, not in the host digest
select is((select count(*)::int from public.notifications n
           where n.kind = 'waitlist_promoted' and n.target_rsvp_id = pg_temp.rid(:'E1', 'Eve')), 1,
  'one waitlist_promoted notification for the promoted guest');
select is((select count(*)::int from public.notifications n
           where n.kind = 'waitlist_promoted' and n.event_id = :'E1'), 1,
  'no notification for guests admitted by their own answer');
select is((select audience from public.notifications n
           where n.kind = 'waitlist_promoted' and n.target_rsvp_id = pg_temp.rid(:'E1', 'Eve')), 'rsvp',
  'it targets that one RSVP (push for app users, email for opted-in web guests)');
select is((select count(*)::int from public.notifications n
           where n.kind = 'waitlist_promoted' and n.event_id = :'E6'), 6,
  'automatic and manager promotions each notify once (W1, W2, W3, W5, W4, W6)');
-- Digest: set up a full event and a waitlist without firing triggers, then free the spot.
select pg_temp.mk_event('cb000000-0000-0000-0000-00000000000b', 'CapDigest001', 1, false, 1);
set local session_replication_role = replica;
insert into public.rsvps (event_id, guest_token_hash, display_name, status, waitlisted_at) values
  ('cb000000-0000-0000-0000-00000000000b', public.hash_guest_token(pg_temp.guest_token('Ann')), 'Ann', 'going', null),
  ('cb000000-0000-0000-0000-00000000000b', public.hash_guest_token(pg_temp.guest_token('Ben')), 'Ben', 'waitlisted', now());
set local session_replication_role = origin;
select ok(public.withdraw_rsvp('CapDigest001', pg_temp.guest_token('Ann')), 'Ann withdraws from the digest event');
select is(pg_temp.st('cb000000-0000-0000-0000-00000000000b', 'Ben'), 'going', 'Ben is promoted');
select is((select count(*)::int from public.notifications where event_id = 'cb000000-0000-0000-0000-00000000000b' and kind = 'rsvp_digest'), 0,
  'a promotion does not notify the host digest');
select is((select count(*)::int from public.notifications where event_id = 'cb000000-0000-0000-0000-00000000000b' and kind = 'waitlist_promoted'), 1,
  'but notifies the promoted guest');
select is(public.notification_stale_reason(
  (select n from public.notifications n where n.kind = 'waitlist_promoted' and n.target_rsvp_id = pg_temp.rid(:'E1', 'Eve')),
  now()), null, 'a still-Going promoted guest gets the notification');
select pg_temp.g('CapWait00001', 'Eve', 'declined');
select is(public.notification_stale_reason(
  (select n from public.notifications n where n.kind = 'waitlist_promoted' and n.target_rsvp_id = pg_temp.rid(:'E1', 'Eve')),
  now()), 'no_longer_going', 'a promoted guest who changed to Can''t go is not notified');

select * from finish();
rollback;
