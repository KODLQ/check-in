-- Group RPCs (change: add-groups-and-recurring-events, tasks 2.1-2.6).
begin;
create extension if not exists pgtap with schema extensions;
select plan(70);

\ir fixtures/groups.psql

-- ---------------------------------------------------------------------------------------------
-- 2.1 create / rename / delete / list / get
set local role authenticated;
:as_E
select lives_ok($$ select public.create_group('  Padel  ') $$, 'any signed-in user creates a group');
select is((select name from public.groups where owner_id = auth.uid()), 'Padel', 'name is trimmed');
select is((select count(*)::int from public.group_members m join public.groups g on g.id = m.group_id where g.owner_id = auth.uid()),
  1, 'creator is the only member');
select throws_ok($$ select public.create_group('   ') $$, '22023', 'invalid_name', 'empty name rejected');
select throws_ok($$ select public.create_group(repeat('x', 51)) $$, '22023', 'invalid_name', 'name over 50 rejected');

reset role;
insert into public.groups (owner_id, name) select :'F', 'g' || i from generate_series(1, 20) i;
insert into public.group_members (group_id, user_id) select id, :'F' from public.groups where owner_id = :'F';
set local role authenticated;
:as_F
select throws_ok($$ select public.create_group('one too many') $$, 'P0001', 'group_limit', '21st group rejected');

:as_B
select lives_ok($$ select public.rename_group('67000000-0000-0000-0000-0000000000a1', 'Friday crew') $$, 'admin renames');
:as_C
select throws_ok($$ select public.rename_group('67000000-0000-0000-0000-0000000000a1', 'Mine') $$, 'P0001', 'not_group_admin',
  'member cannot rename');
:as_E
select throws_ok($$ select public.rename_group('67000000-0000-0000-0000-0000000000a1', 'Mine') $$, 'P0002', 'not_found',
  'stranger gets not_found');
select throws_ok($$ select public.get_group('67000000-0000-0000-0000-0000000000a1') $$, 'P0002', 'not_found',
  'stranger cannot get the group');
:as_C
select is(public.get_group(:'G1') ->> 'name', 'Friday crew', 'member sees the new name');
select is(public.get_group(:'G1') ->> 'my_role', 'member', 'member role');
select is((select array_agg(x ->> 'role' order by ord) from jsonb_array_elements(public.get_group(:'G1') -> 'members') with ordinality t(x, ord)),
  array['owner', 'admin', 'member'], 'members listed owner, admin, member');
select is(public.get_group(:'G1') -> 'link', 'null'::jsonb, 'member does not get the link');
select is(jsonb_array_length(public.list_my_groups() -> 'groups'), 1, 'member lists the group');
:as_D
select is(jsonb_array_length(public.list_my_groups() -> 'invitations'), 1, 'invited user sees the invitation');
select is(public.list_my_groups() -> 'invitations' -> 0 ->> 'owner_name', 'Anna', 'invitation names the owner');

-- ---------------------------------------------------------------------------------------------
-- 2.2 admins
:as_B
select lives_ok(format($$ select public.set_group_admin(%L, %L, true) $$, :'G1', :'C'), 'admin promotes a member');
select throws_ok(format($$ select public.set_group_admin(%L, %L, false) $$, :'G1', :'C'), 'P0001', 'owner_only',
  'admin cannot demote another admin');
select throws_ok(format($$ select public.set_group_admin(%L, %L, false) $$, :'G1', :'A'), 'P0001', 'owner_target',
  'nobody targets the owner');
:as_A
select lives_ok(format($$ select public.set_group_admin(%L, %L, false) $$, :'G1', :'C'), 'owner demotes an admin');
:as_C
select throws_ok(format($$ select public.set_group_admin(%L, %L, true) $$, :'G1', :'C'), 'P0001', 'not_group_admin',
  'regular member cannot promote');
select is(public.get_group(:'G1') -> 'members' -> 1 ->> 'display_name', 'Erik', 'admin marked second');

-- ---------------------------------------------------------------------------------------------
-- 2.3 links and joining
:as_C
select throws_ok(format($$ select public.create_group_link(%L) $$, :'G1'), 'P0001', 'not_group_admin', 'member cannot create a link');
:as_B
select matches(public.create_group_link(:'G1'), '^[A-Za-z0-9]{22}$', 'admin creates a 22-char link');
select is(public.create_group_link(:'G1'), (select token from public.group_invite_links where group_id = :'G1' and revoked_at is null),
  'asking again returns the active link');
select is(public.get_group(:'G1') ->> 'link', (select token from public.group_invite_links where group_id = :'G1' and revoked_at is null),
  'admin sees the link');

reset role;
select set_config('test.link', (select token from public.group_invite_links where group_id = :'G1' and revoked_at is null), true);
:as_anon
set local role anon;
select is(public.get_group_link_preview(current_setting('test.link')) - 'group_id',
  jsonb_build_object('state', 'valid', 'name', 'Friday crew', 'owner_name', 'Anna', 'member_count', 3, 'is_member', false),
  'preview shows only name, owner and member count');
select is(public.get_group_link_preview('UnknownTokenUnknownTok'), '{"state":"invalid"}'::jsonb, 'unknown token is invalid');
select throws_ok($$ select public.join_group_by_link('x') $$, '42501', null, 'anon cannot join');

reset role;
set local role authenticated;
:as_G
select is(public.join_group_by_link(current_setting('test.link')), :'G1'::uuid, 'signed-in user joins by link');
select is(public.join_group_by_link(current_setting('test.link')), :'G1'::uuid, 'joining again is a no-op');
select is((select count(*)::int from public.group_members where group_id = :'G1' and user_id = :'G'), 1, 'one membership');
reset role;
select is((select count(*)::int from public.notifications where kind = 'group_joined' and target_user_id = :'A'
            and payload ->> 'group_id' = :'G1'), 1, 'owner gets a (batched) join notice');

set local role authenticated;
:as_B
select lives_ok(format($$ select public.revoke_group_link(%L) $$, :'G1'), 'admin revokes the link');
reset role;
:as_anon
set local role anon;
select is(public.get_group_link_preview(current_setting('test.link')), '{"state":"invalid"}'::jsonb,
  'revoked link looks like an unknown one');
reset role;
set local role authenticated;
:as_H
select throws_ok(format($$ select public.join_group_by_link(%L) $$, current_setting('test.link')), 'P0001', 'invalid',
  'revoked link cannot be used');

-- Full group: fill to 50 seats, then a join is rejected
reset role;
select set_config('test.link2', public.generate_random_token(22), true);
insert into public.group_invite_links (token, group_id) values (current_setting('test.link2'), :'G1');
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000068' || lpad(i::text, 2, '0'))::uuid, 'filler' || i || '@test.dev' from generate_series(1, 45) i;
update public.profiles set display_name = 'Filler' where id::text like '00000000-0000-0000-0000-0000000068%';
insert into public.group_members (group_id, user_id)
select :'G1', ('00000000-0000-0000-0000-0000000068' || lpad(i::text, 2, '0'))::uuid from generate_series(1, 45) i;
select is(public.group_seats_used(:'G1'), 50, 'seats: 49 members + 1 pending invitation');
set local role authenticated;
:as_H
select throws_ok(format($$ select public.join_group_by_link(%L) $$, current_setting('test.link2')), 'P0001', 'group_full',
  '51st join rejected');
:as_D
select lives_ok(format($$ select public.respond_group_invitation(%L, true) $$, :'G1'),
  'a pending invitation holds a seat, so it can still be accepted');
reset role;
delete from public.group_members where user_id::text like '00000000-0000-0000-0000-0000000068%';

-- ---------------------------------------------------------------------------------------------
-- 2.4 invitations
set local role authenticated;
:as_C
select throws_ok(format($$ select public.invitable_past_guests(%L) $$, :'G1'), 'P0001', 'not_group_admin', 'member cannot list past guests');
:as_B
select is((select array_agg(x ->> 'display_name') from jsonb_array_elements(public.invitable_past_guests(:'G1')) x),
  null::text[], 'admin B: own event guest Gustav already joined, so nobody left');
:as_A
select is((select array_agg(x ->> 'display_name' order by x ->> 'display_name') from jsonb_array_elements(public.invitable_past_guests(:'G1')) x),
  array['Frida', 'Hugo'], 'owner sees account guests of own events only (no web guest, no members)');
select is(public.invite_to_group(:'G1', array[:'F'::uuid, :'H'::uuid]), 2, 'owner invites two past guests');
reset role;
select is((select count(*)::int from public.notifications where kind = 'group_invited' and payload ->> 'group_id' = :'G1'), 2,
  'each invitee gets a push');
set local role authenticated;
:as_A
select is(public.invite_to_group(:'G1', array[:'F'::uuid]), 0, 'inviting a pending invitee again is a no-op');
select throws_ok(format($$ select public.invite_to_group(%L, array[%L::uuid]) $$, :'G1', :'E'), 'P0001', 'not_invitable',
  'cannot invite someone who is not a past guest');
:as_F
select lives_ok(format($$ select public.respond_group_invitation(%L, false) $$, :'G1'), 'Frida declines');
select is(public.is_group_member(:'G1'), false, 'decliner is not a member');
:as_A
select is(public.invite_to_group(:'G1', array[:'F'::uuid]), 1, 're-invite after decline looks successful');
reset role;
select is((select count(*)::int from public.notifications where kind = 'group_invited' and target_user_id = :'F'), 1,
  'but no second push is sent');
set local role authenticated;
:as_H
select lives_ok(format($$ select public.respond_group_invitation(%L, true) $$, :'G1'), 'Hugo accepts');
select is(public.is_group_member(:'G1'), true, 'accepter is a member');
select throws_ok(format($$ select public.respond_group_invitation(%L, true) $$, :'G1'), 'P0002', 'not_found',
  'an invitation can be answered once');

-- ---------------------------------------------------------------------------------------------
-- 2.5 leave / remove / retention
:as_A
select throws_ok(format($$ select public.leave_group(%L) $$, :'G1'), 'P0001', 'owner_must_hand_over', 'owner cannot just leave');
:as_C
select lives_ok(format($$ select public.leave_group(%L) $$, :'G1'), 'member leaves');
:as_A
select lives_ok(format($$ select public.set_group_admin(%L, %L, true) $$, :'G1', :'H'), 'owner makes Hugo admin');
:as_B
select throws_ok(format($$ select public.remove_group_member(%L, %L) $$, :'G1', :'H'), 'P0001', 'owner_only',
  'admin cannot remove another admin');
select lives_ok(format($$ select public.remove_group_member(%L, %L) $$, :'G1', :'G'), 'admin removes a regular member');
select throws_ok(format($$ select public.remove_group_member(%L, %L) $$, :'G1', :'A'), 'P0001', 'owner_target',
  'nobody removes the owner');

reset role;
insert into public.group_invitations (group_id, user_id, created_at, expires_at, declined_at)
values (:'G1', :'E', now() - interval '31 days', now() - interval '1 day', null);
select public.run_retention();
select is((select count(*)::int from public.group_invitations where group_id = :'G1' and user_id = :'E'), 0,
  'retention deletes invitations older than 30 days');
select is((select count(*)::int from public.group_invitations where group_id = :'G1' and user_id = :'F'), 1,
  'retention keeps recent invitations');

-- ---------------------------------------------------------------------------------------------
-- 2.6 hand over, account deletion
set local role authenticated;
:as_A
select throws_ok(format($$ select public.hand_over_and_leave_group(%L, %L) $$, :'G1', :'E'), 'P0001', 'not_member',
  'new owner must be a member');
select lives_ok(format($$ select public.hand_over_and_leave_group(%L, %L) $$, :'G1', :'H'), 'owner hands over to Hugo');
reset role;
select is((select owner_id from public.groups where id = :'G1'), :'H'::uuid, 'Hugo owns the group');
select is((select count(*)::int from public.group_members where group_id = :'G1' and user_id = :'A'), 0, 'Anna left');
select is((select count(*)::int from public.notifications where kind = 'group_new_owner' and target_user_id = :'H'), 1,
  'new owner is told');

-- Account deletion passes the group to the longest-standing admin (B joined before D was made admin).
update public.group_members set is_admin = true where group_id = :'G1' and user_id = :'D';
delete from auth.users where id = :'H';
select is((select owner_id from public.groups where id = :'G1'), :'B'::uuid, 'deleting the owner passes the group to the earliest admin');
update public.group_members set is_admin = false where group_id = :'G1';
delete from auth.users where id = :'B';
select is((select owner_id from public.groups where id = :'G1'), :'D'::uuid, 'with no admin, the earliest member takes over');
delete from auth.users where id = :'D';
select is((select count(*)::int from public.groups where id = :'G1'), 0, 'a sole-member group is deleted with its owner');

select * from finish();
rollback;
