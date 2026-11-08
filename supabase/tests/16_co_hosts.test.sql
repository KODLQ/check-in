-- Co-hosts: schema, helpers and membership-aware policies (change: add-co-hosts, tasks 1.x, 2.1-2.4).
-- Every permission is checked for owner A, co-host B, stranger C, former co-host D and guests/anon.
begin;
create extension if not exists pgtap with schema extensions;
select plan(79);

\ir fixtures/co_hosts.psql

-- ---------------------------------------------------------------------------------------------
-- 1.3 Fixture loads
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 1,
  'fixture: exactly one current co-host (B); D was removed');
select is((select count(*)::int from public.rsvps where event_id = :'E1'), 4, 'fixture: four RSVPs');

-- ---------------------------------------------------------------------------------------------
-- 1.1 Tables, keys, cascades, owner-is-not-co-host
select has_table('public', 'event_co_hosts', 'event_co_hosts exists');
select has_table('public', 'co_host_invites', 'co_host_invites exists');
select col_is_pk('public', 'event_co_hosts', array['event_id', 'user_id'], 'membership PK is (event_id, user_id)');
select col_is_pk('public', 'co_host_invites', 'token', 'co-host invite PK is the token');
select is((select confdeltype::text from pg_constraint where conname = 'event_co_hosts_event_id_fkey'), 'c',
  'membership cascades with the event');
select is((select confdeltype::text from pg_constraint where conname = 'event_co_hosts_user_id_fkey'), 'c',
  'membership cascades with the profile');
select is((select confdeltype::text from pg_constraint where conname = 'co_host_invites_event_id_fkey'), 'c',
  'co-host invites cascade with the event');
select is((select confdeltype::text from pg_constraint where conname = 'co_host_invites_accepted_by_fkey'), 'n',
  'accepted_by is nulled when the profile is deleted');
select ok((select relrowsecurity from pg_class where oid = 'public.event_co_hosts'::regclass), 'RLS on event_co_hosts');
select ok((select relrowsecurity from pg_class where oid = 'public.co_host_invites'::regclass), 'RLS on co_host_invites');
select throws_ok(
  $$ insert into public.event_co_hosts (event_id, user_id)
     values ('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0a1') $$,
  'P0001', 'owner_is_host', 'the owner cannot be added as a co-host');
select matches(public.generate_random_token(22), '^[A-Za-z0-9]{22}$', 'generate_random_token(22) is 22 base62 chars');
select matches(public.generate_invite_token(), '^[A-Za-z0-9]{12}$', 'guest tokens stay 12 chars');
select isnt(public.generate_random_token(22), public.generate_random_token(22), 'tokens are random');

-- ---------------------------------------------------------------------------------------------
-- 1.2 Helpers: [owner, co_host, manager, host(alias=owner)]
set local role authenticated;
:as_A
select is(array[public.is_event_owner(:'E1'), public.is_event_co_host(:'E1'), public.is_event_manager(:'E1'), public.is_event_host(:'E1')],
  array[true, false, true, true], 'helpers for owner A');
:as_B
select is(array[public.is_event_owner(:'E1'), public.is_event_co_host(:'E1'), public.is_event_manager(:'E1'), public.is_event_host(:'E1')],
  array[false, true, true, false], 'helpers for co-host B (is_event_host stays owner-only)');
:as_C
select is(array[public.is_event_owner(:'E1'), public.is_event_co_host(:'E1'), public.is_event_manager(:'E1'), public.is_event_host(:'E1')],
  array[false, false, false, false], 'helpers for stranger C');
:as_D
select is(array[public.is_event_owner(:'E1'), public.is_event_co_host(:'E1'), public.is_event_manager(:'E1'), public.is_event_host(:'E1')],
  array[false, false, false, false], 'helpers for former co-host D');
select is(public.try_uuid('not-a-uuid'), null, 'try_uuid returns null for malformed input');
select is(public.try_uuid('c0000000-0000-0000-0000-0000000000e1'), 'c0000000-0000-0000-0000-0000000000e1'::uuid, 'try_uuid parses uuids');

reset role;
:as_anon
set local role anon;
select throws_ok($$ select public.is_event_owner('c0000000-0000-0000-0000-0000000000e1') $$, '42501', null, 'anon cannot call is_event_owner');
select throws_ok($$ select public.is_event_co_host('c0000000-0000-0000-0000-0000000000e1') $$, '42501', null, 'anon cannot call is_event_co_host');
select throws_ok($$ select public.is_event_manager('c0000000-0000-0000-0000-0000000000e1') $$, '42501', null, 'anon cannot call is_event_manager');
select throws_ok($$ select public.is_event_host('c0000000-0000-0000-0000-0000000000e1') $$, '42501', null, 'anon cannot call is_event_host');

reset role;
select ok(public.is_event_manager_for(:'E1', :'B'), 'is_event_manager_for includes co-hosts (notifications, digest)');
select ok(not public.is_event_manager_for(:'E1', :'D'), 'is_event_manager_for excludes former co-hosts');

-- ---------------------------------------------------------------------------------------------
-- 2.1 events: managers read and update; delete stays owner-only
set local role authenticated;
:as_B
select is((select count(*)::int from public.events where id = :'E1'), 1, 'co-host B can read the event');
select lives_ok($$ update public.events set location_text = 'New place 2' where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'co-host B can edit the event');
delete from public.events where id = :'E1';
:as_C
select is((select count(*)::int from public.events where id = :'E1'), 0, 'stranger C cannot read the event');
update public.events set title = 'Hijacked by C' where id = :'E1';
delete from public.events where id = :'E1';
:as_D
select is((select count(*)::int from public.events where id = :'E1'), 0, 'former co-host D cannot read the event');
update public.events set title = 'Hijacked by D' where id = :'E1';
reset role;
select is((select title || ' @ ' || location_text from public.events where id = :'E1'), 'Co-host party @ New place 2',
  'B''s edit is saved; B cannot delete, C and D cannot edit or delete');
set local role anon;
select is((select count(*)::int from public.events where id = :'E1'), 0, 'anon cannot read the event');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 2.2 events_guard: owner-only cancel, cover path validation
set local role authenticated;
:as_B
select throws_ok($$ update public.events set cancelled_at = now() where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'P0001', 'owner_only', 'co-host B cannot cancel');
select lives_ok($$ update public.events set cover_path = 'e/c0000000-0000-0000-0000-0000000000e1/cover.jpg' where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'co-host B can set a cover in the event folder');
select lives_ok($$ update public.events set cover_path = '00000000-0000-0000-0000-00000000c0b1/mine.jpg' where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'co-host B can set a cover from their own folder');
select throws_ok($$ update public.events set cover_path = '00000000-0000-0000-0000-00000000c0c1/other.jpg' where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'P0001', 'invalid_cover', 'co-host B cannot point the cover at another user''s folder');
select throws_ok($$ update public.events set cover_path = 'e/c0000000-0000-0000-0000-0000000000e1/../x/y.jpg' where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'P0001', 'invalid_cover', 'path traversal in cover_path is rejected');
:as_A
select lives_ok($$ update public.events set cancelled_at = now() where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'owner A can cancel');
:as_B
select throws_ok($$ update public.events set cancelled_at = null where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'P0001', 'owner_only', 'co-host B cannot un-cancel');
:as_A
select lives_ok($$ update public.events set cancelled_at = null where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'owner A can un-cancel');
select throws_ok($$ update public.events set cover_path = '00000000-0000-0000-0000-00000000c0b1/other.jpg' where id = 'c0000000-0000-0000-0000-0000000000e1' $$,
  'P0001', 'invalid_cover', 'owner A cannot set a cover in co-host B''s folder (same rule for everyone)');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 2.3 Guest invite link: managers read and regenerate
set local role authenticated;
:as_B
select is((select token from public.event_invites where event_id = :'E1' and revoked_at is null), 'CoHostTest01',
  'co-host B can read the active invite link');
select matches(public.regenerate_invite(:'E1'), '^[A-Za-z0-9]{12}$', 'co-host B can regenerate the link');
:as_A
select isnt((select token from public.event_invites where event_id = :'E1' and revoked_at is null), 'CoHostTest01',
  'owner A sees the new link');
:as_C
select throws_ok($$ select public.regenerate_invite('c0000000-0000-0000-0000-0000000000e1') $$, 'P0002', 'not_found',
  'stranger C cannot regenerate');
select is((select count(*)::int from public.event_invites where event_id = :'E1'), 0, 'stranger C cannot read invite links');
:as_D
select throws_ok($$ select public.regenerate_invite('c0000000-0000-0000-0000-0000000000e1') $$, 'P0002', 'not_found',
  'former co-host D cannot regenerate');
select is((select count(*)::int from public.event_invites where event_id = :'E1'), 0, 'former co-host D cannot read invite links');
reset role;
select is((select count(*)::int from public.rsvps where event_id = :'E1'), 4, 'existing RSVPs survive regeneration');
select is((public.get_invite('CoHostTest01'))->>'state', 'not_found', 'the old link stops working');

-- ---------------------------------------------------------------------------------------------
-- 2.4 RSVPs: managers see all (incl. declined) and remove; others see only their own
set local role authenticated;
:as_B
select is((select array_agg(status::text order by status) from public.rsvps where event_id = :'E1'),
  array['going', 'going', 'maybe', 'declined'], 'co-host B sees every response including Can''t go');
select lives_ok($$ delete from public.rsvps where id = 'c0000000-0000-0000-0000-0000000000f4' $$, 'co-host B can remove a guest');
:as_C
select is((select count(*)::int from public.rsvps where event_id = :'E1'), 0, 'stranger C sees no RSVPs');
delete from public.rsvps where event_id = :'E1';
:as_D
select is((select count(*)::int from public.rsvps where event_id = :'E1'), 0, 'former co-host D sees no RSVPs');
delete from public.rsvps where event_id = :'E1';
:as_S
select is((select array_agg(display_name) from public.rsvps where event_id = :'E1'), array['Sara'],
  'a signed-in guest sees only their own response');
:as_A
select is((select array_agg(display_name order by display_name) from public.rsvps where event_id = :'E1'),
  array['Gina', 'Milo', 'Sara'], 'B''s removal is visible to the owner; C and D removed nothing');
reset role;
set local role anon;
select is((select count(*)::int from public.rsvps where event_id = :'E1'), 0, 'anon sees no RSVPs');
reset role;

-- ---------------------------------------------------------------------------------------------
-- New tables: who can read / write membership and co-host links
insert into public.co_host_invites (token, event_id) values ('CoHostLinkFixture00001', :'E1');
set local role authenticated;
:as_A
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 1, 'owner A reads the co-host list');
select is((select count(*)::int from public.co_host_invites where event_id = :'E1'), 1, 'owner A reads co-host links');
:as_B
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 1, 'co-host B reads the co-host list');
select is((select count(*)::int from public.co_host_invites where event_id = :'E1'), 0, 'co-host B cannot read co-host links');
select throws_ok($$ insert into public.event_co_hosts (event_id, user_id) values ('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0c1') $$,
  '42501', null, 'co-host B cannot add co-hosts directly');
select throws_ok($$ insert into public.co_host_invites (event_id) values ('c0000000-0000-0000-0000-0000000000e1') $$,
  '42501', null, 'co-host B cannot insert co-host links directly');
:as_C
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 0, 'stranger C cannot read the co-host list');
select is((select count(*)::int from public.co_host_invites where event_id = :'E1'), 0, 'stranger C cannot read co-host links');
select throws_ok($$ insert into public.event_co_hosts (event_id, user_id) values ('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0c1') $$,
  '42501', null, 'stranger C cannot make themself a co-host');
delete from public.event_co_hosts where event_id = :'E1';
:as_D
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 0, 'former co-host D cannot read the co-host list');
:as_S
select is((select count(*)::int from public.co_host_invites where event_id = :'E1'), 0, 'a guest cannot read co-host links');
reset role;
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 1, 'C''s delete removed nobody');
set local role anon;
select throws_ok($$ select * from public.co_host_invites $$, '42501', null, 'anon cannot read co-host links');
select throws_ok($$ select * from public.event_co_hosts $$, '42501', null, 'anon cannot read memberships');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 8.2 Sibling changes authorize via is_event_manager: announcements and my-invites
set local role authenticated;
:as_B
select lives_ok($$ select public.post_announcement('c0000000-0000-0000-0000-0000000000e1', 'Bring a jacket') $$,
  'co-host B can post an announcement');
:as_A
select lives_ok($$ select public.post_announcement('c0000000-0000-0000-0000-0000000000e1', 'Owner update') $$, 'owner A posts too');
:as_B
select lives_ok(format('select public.delete_announcement(%L)',
  (select id from public.event_announcements where event_id = 'c0000000-0000-0000-0000-0000000000e1' and body = 'Owner update')),
  'co-host B can delete the owner''s announcement');
select is((select array_agg(body) from public.event_announcements where event_id = :'E1'), array['Bring a jacket'],
  'co-host B reads announcements');
:as_D
select throws_ok($$ select public.post_announcement('c0000000-0000-0000-0000-0000000000e1', 'Former') $$, 'P0002', 'not_found',
  'former co-host D cannot post');
:as_C
select throws_ok($$ select public.post_announcement('c0000000-0000-0000-0000-0000000000e1', 'Stranger') $$, 'P0002', 'not_found',
  'stranger C cannot post');
reset role;

select * from finish();
rollback;
