-- Groups: tables, cascades, helpers and read policies (change: add-groups-and-recurring-events, tasks 1.1-1.2).
begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

\ir fixtures/groups.psql

-- 1.2 Fixture loads
select is((select count(*)::int from public.group_members where group_id = :'G1'), 3, 'fixture: three members');
select is((select count(*)::int from public.group_invitations where group_id = :'G1'), 1, 'fixture: one pending invitation');

-- 1.1 Tables and keys
select has_table('public', 'groups', 'groups exists');
select has_table('public', 'group_members', 'group_members exists');
select has_table('public', 'group_invitations', 'group_invitations exists');
select has_table('public', 'group_invite_links', 'group_invite_links exists');
select col_is_pk('public', 'group_members', array['group_id', 'user_id'], 'membership PK is (group_id, user_id)');
select col_is_pk('public', 'group_invitations', array['group_id', 'user_id'], 'invitation PK is (group_id, user_id)');
select is((select confdeltype::text from pg_constraint where conname = 'groups_owner_id_fkey'), 'a',
  'owner FK has no cascade (groups are handed over first)');
select is((select confdeltype::text from pg_constraint where conname = 'group_members_group_id_fkey'), 'c', 'members cascade with the group');
select is((select confdeltype::text from pg_constraint where conname = 'group_members_user_id_fkey'), 'c', 'members cascade with the profile');
select is((select confdeltype::text from pg_constraint where conname = 'group_invite_links_group_id_fkey'), 'c', 'links cascade with the group');
select ok((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.groups'::regclass, 'public.group_members'::regclass, 'public.group_invitations'::regclass,
  'public.group_invite_links'::regclass)), 'RLS on every group table');

insert into public.group_invite_links (group_id) values (:'G1');
select throws_ok(
  $$ insert into public.group_invite_links (group_id) values ('67000000-0000-0000-0000-0000000000a1') $$,
  '23505', null, 'only one active link per group');
update public.group_invite_links set revoked_at = now() where group_id = :'G1';
select lives_ok(
  $$ insert into public.group_invite_links (group_id) values ('67000000-0000-0000-0000-0000000000a1') $$,
  'a new link once the old one is revoked');
select throws_ok(
  $$ delete from public.group_members where group_id = '67000000-0000-0000-0000-0000000000a1'
       and user_id = '00000000-0000-0000-0000-0000000067a1' $$,
  'P0001', 'owner_must_hand_over', 'the owner cannot be removed while owning the group');

-- Helpers: [member, admin]
set local role authenticated;
:as_A
select is(array[public.is_group_member(:'G1'), public.is_group_admin(:'G1')], array[true, true], 'owner A: member and admin');
:as_B
select is(array[public.is_group_member(:'G1'), public.is_group_admin(:'G1')], array[true, true], 'admin B: member and admin');
:as_C
select is(array[public.is_group_member(:'G1'), public.is_group_admin(:'G1')], array[true, false], 'member C: member only');
:as_E
select is(array[public.is_group_member(:'G1'), public.is_group_admin(:'G1')], array[false, false], 'stranger E: neither');

-- Read policies
:as_A
select is((select count(*)::int from public.groups where id = :'G1'), 1, 'owner reads the group');
select is((select count(*)::int from public.group_invitations where group_id = :'G1'), 1, 'owner reads invitations');
select is((select count(*)::int from public.group_invite_links where group_id = :'G1'), 2, 'owner reads links');
:as_B
select is((select count(*)::int from public.group_invite_links where group_id = :'G1'), 2, 'admin reads links');
select is((select count(*)::int from public.group_invitations where group_id = :'G1'), 1, 'admin reads invitations');
:as_C
select is((select count(*)::int from public.group_members where group_id = :'G1'), 3, 'member reads all members');
select is((select count(*)::int from public.group_invite_links where group_id = :'G1'), 0, 'member cannot read links');
select is((select count(*)::int from public.group_invitations where group_id = :'G1'), 0, 'member cannot read invitations');
:as_D
select is((select count(*)::int from public.groups where id = :'G1'), 0, 'invited user cannot read the group yet');
select is((select count(*)::int from public.group_invitations where group_id = :'G1'), 1, 'invited user reads own invitation');
:as_E
select is((select count(*)::int from public.group_members where group_id = :'G1'), 0, 'stranger reads no members');
select throws_ok($$ insert into public.groups (owner_id, name) values (auth.uid(), 'x') $$, '42501', null,
  'no direct inserts');

-- Former member
reset role;
delete from public.group_members where group_id = :'G1' and user_id = :'C';
set local role authenticated;
:as_C
select is((select count(*)::int from public.groups where id = :'G1'), 0, 'former member reads nothing');

reset role;
:as_anon
set local role anon;
select throws_ok($$ select count(*) from public.groups $$, '42501', null, 'anon cannot read groups');
select throws_ok($$ select public.is_group_member('67000000-0000-0000-0000-0000000000a1') $$, '42501', null,
  'anon cannot call is_group_member');

-- Group deletion cascades
reset role;
delete from public.groups where id = :'G1';
select is((select count(*)::int from public.group_members where group_id = :'G1'), 0, 'members gone with the group');
select is((select count(*)::int from public.group_invitations where group_id = :'G1'), 0, 'invitations gone with the group');

select * from finish();
rollback;
