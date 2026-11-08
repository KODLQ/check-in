-- Co-host invite links, membership RPCs, guest-facing host names, retention and account deletion
-- (change: add-co-hosts, tasks 3.1-3.4, 4.2, 8.2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(77);

\ir fixtures/co_hosts.psql

-- Extra users: N (no display name), F1-F3 (fill co-host slots), G (would-be sixth co-host).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c0f0', 'cohost-noname@test.dev'),
  ('00000000-0000-0000-0000-00000000c0f1', 'cohost-f1@test.dev'),
  ('00000000-0000-0000-0000-00000000c0f2', 'cohost-f2@test.dev'),
  ('00000000-0000-0000-0000-00000000c0f3', 'cohost-f3@test.dev'),
  ('00000000-0000-0000-0000-00000000c0f4', 'cohost-g@test.dev');
update public.profiles set display_name = 'Filip' where id = '00000000-0000-0000-0000-00000000c0f1';
update public.profiles set display_name = 'Frida' where id = '00000000-0000-0000-0000-00000000c0f2';
update public.profiles set display_name = 'Fanny' where id = '00000000-0000-0000-0000-00000000c0f3';
update public.profiles set display_name = 'Gustav' where id = '00000000-0000-0000-0000-00000000c0f4';

-- E2: A's event that will be cancelled. E3: A's event that has ended (guard bypassed).
insert into public.events (id, host_id, title, starts_at, location_text) values
  ('c0000000-0000-0000-0000-0000000000e2', :'A', 'To cancel', now() + interval '3 days', 'X');
set local session_replication_role = replica;
insert into public.events (id, host_id, title, starts_at, location_text) values
  ('c0000000-0000-0000-0000-0000000000e3', :'A', 'Ended', now() - interval '2 days', 'X');
set local session_replication_role = origin;
-- Links that are no longer valid: expired, revoked, on a cancelled event, on an ended event.
insert into public.co_host_invites (token, event_id, created_at, expires_at) values
  ('ExpiredLink00000000001', :'E1', now() - interval '8 days', now() - interval '1 day');
insert into public.co_host_invites (token, event_id, revoked_at) values
  ('RevokedLink00000000001', :'E1', now());
insert into public.co_host_invites (token, event_id) values
  ('CancelledEvLink0000001', 'c0000000-0000-0000-0000-0000000000e2'),
  ('EndedEventLink00000001', 'c0000000-0000-0000-0000-0000000000e3');
update public.events set cancelled_at = now() where id = 'c0000000-0000-0000-0000-0000000000e2';

create temp table links (name text primary key, token text);
grant all on links to authenticated, anon, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3.1 Create / revoke (owner only, 5 slots counting pending links)
set local role authenticated;
:as_A
insert into links values ('first', public.create_co_host_invite(:'E1'));
select matches((select token from links where name = 'first'), '^[A-Za-z0-9]{22}$', 'owner A creates a 22-char co-host link');
:as_B
select throws_ok($$ select public.create_co_host_invite('c0000000-0000-0000-0000-0000000000e1') $$, 'P0001', 'owner_only',
  'co-host B cannot create co-host links');
:as_C
select throws_ok($$ select public.create_co_host_invite('c0000000-0000-0000-0000-0000000000e1') $$, 'P0002', 'not_found',
  'stranger C cannot create co-host links');
:as_D
select throws_ok($$ select public.create_co_host_invite('c0000000-0000-0000-0000-0000000000e1') $$, 'P0002', 'not_found',
  'former co-host D cannot create co-host links');
:as_A
select throws_ok($$ select public.create_co_host_invite('c0000000-0000-0000-0000-0000000000e2') $$, 'P0001', 'event_closed',
  'no co-host links for a cancelled event');
select throws_ok($$ select public.create_co_host_invite('c0000000-0000-0000-0000-0000000000e3') $$, 'P0001', 'event_closed',
  'no co-host links for an ended event');
-- 1 co-host (B) + first + 3 more = 5 slots.
insert into links values ('second', public.create_co_host_invite(:'E1'));
insert into links values ('third', public.create_co_host_invite(:'E1'));
insert into links values ('fourth', public.create_co_host_invite(:'E1'));
select throws_ok($$ select public.create_co_host_invite('c0000000-0000-0000-0000-0000000000e1') $$, 'P0001', 'co_host_limit',
  'a sixth slot (1 co-host + 4 pending links + 1) is rejected with co_host_limit');
select is((select count(*)::int from public.co_host_invites where event_id = :'E1' and revoked_at is null and accepted_at is null and expires_at > now()),
  4, 'owner A sees 4 pending links');
:as_B
select throws_ok(format('select public.revoke_co_host_invite(%L)', (select token from links where name = 'fourth')),
  'P0002', 'not_found', 'co-host B cannot revoke co-host links');
:as_C
select throws_ok(format('select public.revoke_co_host_invite(%L)', (select token from links where name = 'fourth')),
  'P0002', 'not_found', 'stranger C cannot revoke co-host links');
:as_A
select lives_ok(format('select public.revoke_co_host_invite(%L)', (select token from links where name = 'fourth')),
  'owner A revokes a pending link');
insert into links values ('fifth', public.create_co_host_invite(:'E1'));
select matches((select token from links where name = 'fifth'), '^[A-Za-z0-9]{22}$', 'a revoked link frees its slot');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 3.2 Get / accept
set local role authenticated;
:as_C
select is(public.get_co_host_invite((select token from links where name = 'first')),
  '{"state":"valid","event":{"title":"Co-host party"},"owner":{"display_name":"Anna"}}'::jsonb,
  'accept screen shows only title and owner name');
select is(public.accept_co_host_invite((select token from links where name = 'first')), :'E1'::uuid,
  'stranger C accepts and gets the event id');
select is((select count(*)::int from public.events where id = :'E1'), 1, 'C can now read the event as co-host');
reset role;
select is((select accepted_by from public.co_host_invites where token = (select token from links where name = 'first')),
  :'C'::uuid, 'the link is consumed by C');
set local role authenticated;
:as_D
select is(public.get_co_host_invite((select token from links where name = 'first')), '{"state":"invalid"}'::jsonb,
  'a used link is invalid for a second person');
select throws_ok(format('select public.accept_co_host_invite(%L)', (select token from links where name = 'first')),
  'P0001', 'invalid_invite', 'a second person cannot accept a used link');
select is(public.get_co_host_invite('ExpiredLink00000000001'), '{"state":"invalid"}'::jsonb, 'expired link: invalid');
select is(public.get_co_host_invite('RevokedLink00000000001'), '{"state":"invalid"}'::jsonb, 'revoked link: invalid');
select is(public.get_co_host_invite('CancelledEvLink0000001'), '{"state":"invalid"}'::jsonb, 'cancelled event link: invalid');
select is(public.get_co_host_invite('EndedEventLink00000001'), '{"state":"invalid"}'::jsonb, 'ended event link: invalid');
select is(public.get_co_host_invite('UnknownLink00000000001'), '{"state":"invalid"}'::jsonb, 'unknown link: invalid');
select is(public.get_co_host_invite('CoHostTest01'), '{"state":"invalid"}'::jsonb, 'a guest link is not a co-host link');
select throws_ok($$ select public.accept_co_host_invite('ExpiredLink00000000001') $$, 'P0001', 'invalid_invite', 'cannot accept an expired link');
select throws_ok($$ select public.accept_co_host_invite('RevokedLink00000000001') $$, 'P0001', 'invalid_invite', 'cannot accept a revoked link');
select throws_ok($$ select public.accept_co_host_invite('CancelledEvLink0000001') $$, 'P0001', 'invalid_invite', 'cannot accept for a cancelled event');
select throws_ok($$ select public.accept_co_host_invite('EndedEventLink00000001') $$, 'P0001', 'invalid_invite', 'cannot accept for an ended event');
:as_A
select is(public.get_co_host_invite((select token from links where name = 'second'))->>'state', 'owner', 'owner opening own link: owner');
select throws_ok(format('select public.accept_co_host_invite(%L)', (select token from links where name = 'second')),
  'P0001', 'already_host', 'owner cannot accept their own link');
:as_B
select is(public.get_co_host_invite((select token from links where name = 'second'))->>'state', 'already_co_host',
  'existing co-host opening a link: already_co_host');
select is(public.accept_co_host_invite((select token from links where name = 'second')), :'E1'::uuid,
  'existing co-host accepting is a no-op that returns the event');
reset role;
select is((select accepted_at from public.co_host_invites where token = (select token from links where name = 'second')), null,
  'owner and existing co-host leave the link unused');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0f0","role":"authenticated"}', true);
select throws_ok(format('select public.accept_co_host_invite(%L)', (select token from links where name = 'second')),
  'P0001', 'name_required', 'accepting requires a display name');
reset role;
-- Fill to 5 co-hosts: B, C + F1, F2, F3.
insert into public.event_co_hosts (event_id, user_id) values
  (:'E1', '00000000-0000-0000-0000-00000000c0f1'),
  (:'E1', '00000000-0000-0000-0000-00000000c0f2'),
  (:'E1', '00000000-0000-0000-0000-00000000c0f3');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0f4","role":"authenticated"}', true);
select throws_ok(format('select public.accept_co_host_invite(%L)', (select token from links where name = 'second')),
  'P0001', 'co_host_limit', 'a full event rejects a sixth co-host');
reset role;
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 5, 'still 5 co-hosts');
set local role anon;
select throws_ok($$ select public.get_co_host_invite('UnknownLink00000000001') $$, '42501', null, 'anon cannot look up co-host links');
select throws_ok($$ select public.accept_co_host_invite('UnknownLink00000000001') $$, '42501', null, 'anon cannot accept co-host links');
select is((public.get_invite((select token from links where name = 'second')))->>'state', 'not_found',
  'a co-host token opened as a guest link is not found');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 3.3 Hosts list, remove, leave
set local role authenticated;
:as_B
select is((select array_agg(display_name || ':' || role) from public.list_event_hosts(:'E1')),
  array['Anna:owner', 'Erik:co_host', 'Cecilia:co_host', 'Filip:co_host', 'Frida:co_host', 'Fanny:co_host'],
  'co-host B lists hosts: owner first, then co-hosts in join order');
:as_D
select is((select count(*)::int from public.list_event_hosts(:'E1')), 0, 'former co-host D cannot list hosts');
:as_S
select is((select count(*)::int from public.list_event_hosts(:'E1')), 0, 'a guest cannot list hosts');
:as_B
select throws_ok($$ select public.remove_co_host('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f1') $$,
  'P0001', 'owner_only', 'co-host B cannot remove another co-host');
:as_D
select throws_ok($$ select public.remove_co_host('c0000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000c0f1') $$,
  'P0002', 'not_found', 'former co-host D cannot remove co-hosts');
:as_A
select ok(public.remove_co_host(:'E1', '00000000-0000-0000-0000-00000000c0f1'), 'owner A removes co-host F1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0f1","role":"authenticated"}', true);
select is((select count(*)::int from public.events where id = :'E1'), 0, 'removed co-host F1 loses access immediately');
select is((select count(*)::int from public.rsvps where event_id = :'E1'), 0, 'removed co-host F1 sees no RSVPs');
:as_C
select ok(public.leave_event(:'E1'), 'co-host C leaves');
select is((select count(*)::int from public.events where id = :'E1'), 0, 'C no longer sees the event after leaving');
select ok(not public.leave_event(:'E1'), 'leaving twice is a no-op');
:as_A
select ok(not public.leave_event(:'E1'), 'the owner cannot "leave" (nothing to delete)');
select is((select count(*)::int from public.events where id = :'E1'), 1, 'and keeps the event');
-- Owner may also delete a membership row directly (RLS), a co-host only their own.
:as_B
delete from public.event_co_hosts where event_id = :'E1' and user_id = '00000000-0000-0000-0000-00000000c0f2';
reset role;
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1' and user_id = '00000000-0000-0000-0000-00000000c0f2'), 1,
  'co-host B cannot delete another co-host''s membership row');
set local role anon;
select throws_ok($$ select * from public.list_event_hosts('c0000000-0000-0000-0000-0000000000e1') $$, '42501', null, 'anon cannot list hosts');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 3.4 Guest-facing names, web preview, retention
-- Current co-hosts in join order: B (Erik), F2 (Frida), F3 (Fanny).
select is((public.get_invite((select token from public.event_invites where event_id = :'E1' and revoked_at is null)))->'co_hosts',
  '[{"display_name":"Erik"},{"display_name":"Frida"},{"display_name":"Fanny"}]'::jsonb,
  'get_invite lists co-host names in join order and nothing else about them');
select is((public.get_invite((select token from public.event_invites where event_id = :'E1' and revoked_at is null)))->'host'->>'display_name',
  'Anna', 'the owner stays in host');
set local role authenticated;
:as_S
select is((public.get_my_invite(:'E1'))->'co_hosts', '[{"display_name":"Erik"},{"display_name":"Frida"},{"display_name":"Fanny"}]'::jsonb,
  'my-invites details show the same host names');
reset role;
set local role service_role;
select is(public.get_co_host_invite_preview((select token from links where name = 'second')),
  '{"state":"valid","event":{"title":"Co-host party"},"owner":{"display_name":"Anna"}}'::jsonb,
  'web preview returns only title and owner name');
select is(public.get_co_host_invite_preview('ExpiredLink00000000001'), '{"state":"invalid"}'::jsonb, 'web preview: expired is invalid');
select is(public.get_co_host_invite_preview('CoHostTest01'), '{"state":"invalid"}'::jsonb, 'web preview: guest token is invalid');
reset role;
set local role anon;
select throws_ok($$ select public.get_co_host_invite_preview('UnknownLink00000000001') $$, '42501', null, 'anon cannot call the preview');
reset role;
set local role authenticated;
:as_C
select throws_ok($$ select public.get_co_host_invite_preview('UnknownLink00000000001') $$, '42501', null, 'signed-in users cannot call the preview');
reset role;

insert into public.co_host_invites (token, event_id, created_at, expires_at, revoked_at, accepted_at, accepted_by) values
  ('RetentionExpired000001', :'E1', now() - interval '40 days', now() - interval '33 days', null, null, null),
  ('RetentionRevoked000001', :'E1', now() - interval '35 days', now() - interval '28 days', now() - interval '31 days', null, null),
  ('RetentionAccepted00001', :'E1', now() - interval '35 days', now() - interval '28 days', null, now() - interval '31 days', :'B'),
  ('RetentionRecentRevoke1', :'E1', now() - interval '10 days', now() - interval '3 days', now() - interval '5 days', null, null);
select public.run_retention(now());
select is((select array_agg(token order by token) from public.co_host_invites where token like 'Retention%'),
  array['RetentionRecentRevoke1'], 'retention deletes co-host links 30 days after expiry, revocation or use');
select is((select count(*)::int from public.co_host_invites where token = (select token from links where name = 'second')), 1,
  'retention keeps pending links');
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 3, 'retention keeps memberships');

-- ---------------------------------------------------------------------------------------------
-- 8.2 Notifications and my-invites follow is_event_manager
insert into public.push_tokens (user_id, token, platform) values
  (:'A', 'ExponentPushToken[cohost-a]', 'ios'),
  (:'B', 'ExponentPushToken[cohost-b]', 'ios'),
  (:'C', 'ExponentPushToken[cohost-c]', 'ios');
select is((select array_agg(r.user_id order by r.user_id) from public.notifications n, public.notification_recipients(n) r
           where n.event_id = :'E1' and n.kind = 'rsvp_digest'),
  array[:'A', :'B']::uuid[], 'the reply digest goes to the owner and current co-hosts, not to a former co-host');
-- B also answered the event before becoming co-host: it is listed as hosted, not as an invite.
insert into public.rsvps (event_id, user_id, display_name, status) values (:'E1', :'B', 'Erik', 'going');
set local role authenticated;
:as_B
select is(public.list_my_invites(), '[]'::jsonb, 'a co-hosted event is not listed among the co-host''s invites');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 4.2 Account deletion: co-host B, then owner A
update public.events set cover_path = 'e/c0000000-0000-0000-0000-0000000000e1/cover.jpg' where id = :'E1';
delete from auth.users where id = :'B';
select is((select count(*)::int from public.event_co_hosts where user_id = :'B'), 0, 'deleting a co-host removes their memberships');
select is((select count(*)::int from public.co_host_invites where accepted_by = :'B'), 0, 'accepted_by is nulled');
select is((select cover_path from public.events where id = :'E1'), 'e/c0000000-0000-0000-0000-0000000000e1/cover.jpg',
  'the owner''s event and its event-folder cover stay');
select is((select count(*)::int from public.rsvps where event_id = :'E1'), 4, 'the event''s other RSVPs stay (B''s own is removed)');
select is((public.get_invite((select token from public.event_invites where event_id = :'E1' and revoked_at is null)))->'co_hosts',
  '[{"display_name":"Frida"},{"display_name":"Fanny"}]'::jsonb, 'guests no longer see the deleted co-host');

delete from auth.users where id = :'A';
select is((select count(*)::int from public.events where id = :'E1'), 0, 'deleting the owner deletes the event');
select is((select count(*)::int from public.event_co_hosts where event_id = :'E1'), 0, '... and its memberships');
select is((select count(*)::int from public.co_host_invites where event_id = :'E1'), 0, '... and its co-host links');
select is((select count(*)::int from public.rsvps where event_id = :'E1'), 0, '... and its RSVPs');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000c0f2","role":"authenticated"}', true);
select is((select count(*)::int from public.events where id = :'E1'), 0, 'the event disappears from co-hosts'' lists');
reset role;

select * from finish();
rollback;
