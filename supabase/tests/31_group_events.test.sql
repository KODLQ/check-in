-- Group events seen by members, group rules on events, and group notifications
-- (change: add-groups-and-recurring-events, tasks 6.1-6.4, 7.1-7.3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

\ir fixtures/groups.psql

-- Push tokens for everyone in the group (recipient resolution needs a device).
insert into public.push_tokens (user_id, token, platform) values
  (:'A', 'ExpoPushToken[group-a]', 'ios'), (:'B', 'ExpoPushToken[group-b]', 'ios'),
  (:'C', 'ExpoPushToken[group-c]', 'ios'), (:'D', 'ExpoPushToken[group-d]', 'ios');

-- ---------------------------------------------------------------------------------------------
-- 6.1 Group on one-off events
set local role authenticated;
:as_A
select lives_ok(format($$ update public.events set group_id = %L where id = %L $$, :'G1', :'E1'), 'owner invites the group to a party');
:as_B
select lives_ok(format($$ update public.events set group_id = %L where id = %L $$, :'G1', :'E2'), 'admin invites the group to own dinner');
reset role;
insert into public.events (id, host_id, title, starts_at, location_text)
values ('67000000-0000-0000-0000-0000000000e3', :'C', 'Cecilia brunch', now() + interval '5 days', 'Street 3');
insert into public.event_co_hosts (event_id, user_id) values (:'E1', :'D');
set local role authenticated;
:as_C
select throws_ok(format($$ update public.events set group_id = %L where id = '67000000-0000-0000-0000-0000000000e3' $$, :'G1'),
  'P0001', 'not_group_admin', 'a regular member cannot invite the group');
:as_D
select throws_ok(format($$ update public.events set group_id = null where id = %L $$, :'E1'), 'P0001', 'owner_only',
  'a co-host cannot change the invited group');
reset role;
delete from public.event_co_hosts where event_id = :'E1';
set local role authenticated;

:as_C
select is(public.get_my_invite(:'E1') ->> 'state', 'active', 'a member sees the group event without answering');
select is(public.get_my_invite(:'E1') -> 'my_rsvp', 'null'::jsonb, 'with no answer yet');
:as_E
select is(public.get_my_invite(:'E1') ->> 'state', 'not_found', 'a stranger sees nothing');

-- ---------------------------------------------------------------------------------------------
-- 6.3 Members answer in the app
:as_C
select is((select x -> 'my_rsvp' from jsonb_array_elements(public.list_my_invites()) x where x ->> 'id' = :'E1'), 'null'::jsonb,
  'the party is listed as not answered yet');
select is((select x -> 'group' ->> 'name' from jsonb_array_elements(public.list_my_invites()) x where x ->> 'id' = :'E1'), 'AW crew',
  'with the group name');
select is(public.set_my_rsvp(:'E1', 'going') ->> 'status', 'going', 'first answer from the app');
reset role;
select is((select display_name from public.rsvps where event_id = :'E1' and user_id = :'C'), 'Cecilia',
  'an account RSVP with the profile name is created');
set local role authenticated;
:as_C
select lives_ok(format($$ select public.remove_rsvp(%L) $$, (select id from public.rsvps where event_id = :'E1' and user_id = :'C')),
  'withdrawing from the app');
select is((select x -> 'my_rsvp' from jsonb_array_elements(public.list_my_invites()) x where x ->> 'id' = :'E1'), 'null'::jsonb,
  'the event is back to not answered');

-- Full event: the member is waitlisted
reset role;
update public.events set capacity = 1 where id = :'E1';
delete from public.rsvps where event_id = :'E1' and status = 'going' and user_id is null;
set local role authenticated;
:as_C
select is(public.set_my_rsvp(:'E1', 'going') ->> 'status', 'waitlisted', 'a member answering Going on a full event is waitlisted');
reset role;
update public.events set capacity = null where id = :'E1';

-- Leaving: answered events stay, unanswered ones go
set local role authenticated;
:as_C
select lives_ok(format($$ select public.leave_group(%L) $$, :'G1'), 'Cecilia leaves the group');
select is((select count(*)::int from jsonb_array_elements(public.list_my_invites()) x where x ->> 'id' = :'E1'), 1,
  'an answered group event stays after leaving');
select is((select count(*)::int from jsonb_array_elements(public.list_my_invites()) x where x ->> 'id' = :'E2'), 0,
  'an unanswered one disappears');
select is(public.get_my_invite(:'E2') ->> 'state', 'not_found', 'and its details are hidden');
select throws_ok(format($$ select public.set_my_rsvp(%L, 'going') $$, :'E2'), 'P0002', 'not_found', 'and it cannot be answered');

-- ---------------------------------------------------------------------------------------------
-- 6.2 Admin rights end
reset role;
select set_config('test.start',
  (((now() at time zone 'Europe/Stockholm')::date + 2 + time '17:00') at time zone 'Europe/Stockholm')::text, true);
set local role authenticated;
:as_B
select set_config('test.sid', (public.create_series(:'G1', jsonb_build_object(
  'title', 'AW', 'location_text', 'Bar', 'starts_at', current_setting('test.start')), 'weekly') ->> 'series_id'), true);
reset role;
insert into public.rsvps (event_id, user_id, display_name, status) values (:'E2', :'D', 'Doris', 'going');
set local role authenticated;
:as_A
select lives_ok(format($$ select public.set_group_admin(%L, %L, false) $$, :'G1', :'B'), 'owner demotes Erik');
reset role;
select is((select group_id from public.events where id = :'E2'), null, 'Erik''s one-off dinner no longer invites the group');
select is((select count(*)::int from public.rsvps where event_id = :'E2'), 2, 'answers to it are kept');
select ok((select bool_and(group_id = :'G1') from public.events where series_id = current_setting('test.sid')::uuid),
  'the group''s series dates keep the group');
select is((select group_id from public.events where id = :'E1'), :'G1'::uuid, 'the owner''s party keeps the group');
set local role authenticated;
:as_A
select throws_ok(format($$ update public.events set group_id = null where series_id = %L $$, current_setting('test.sid')),
  'P0001', 'series_group_fixed', 'a series date always invites its group');

-- ---------------------------------------------------------------------------------------------
-- 6.4 Not-answered count and member flag
reset role;
insert into auth.users (id, email)
select ('00000000-0000-0000-0000-0000000069' || lpad(i::text, 2, '0'))::uuid, 'm' || i || '@test.dev' from generate_series(1, 10) i;
update public.profiles set display_name = 'M' where id::text like '00000000-0000-0000-0000-0000000069%';
insert into public.group_members (group_id, user_id)
select :'G1', ('00000000-0000-0000-0000-0000000069' || lpad(i::text, 2, '0'))::uuid from generate_series(1, 10) i;
-- Group: A (host) + B + D + 10 = 13 members, 12 besides the host. 5 of them answer the party.
insert into public.group_members (group_id, user_id) values (:'G1', :'D');
delete from public.rsvps where event_id = :'E1' and user_id is not null;
insert into public.rsvps (event_id, user_id, display_name, status)
select :'E1', ('00000000-0000-0000-0000-0000000069' || lpad(i::text, 2, '0'))::uuid, 'M', 'going' from generate_series(1, 5) i;
set local role authenticated;
:as_A
select is((public.group_event_summary(:'E1') ->> 'not_answered')::int, 7, '12 members besides the host, 5 answered: 7 not answered');
select ok(not (public.group_event_summary(:'E1') -> 'member_user_ids') @> jsonb_build_array(:'F'),
  'an outside guest is not flagged as a member');
:as_C
select throws_ok(format($$ select public.group_event_summary(%L) $$, :'E1'), 'P0002', 'not_found', 'only managers get the summary');
reset role;
select is((select count(*)::int from public.group_members where group_id = :'G1' and user_id = :'F'), 0,
  'answering by link never makes someone a member');

-- ---------------------------------------------------------------------------------------------
-- 7.1 Recipients for group notices
select set_config('test.n', public.enqueue_notification(
  p_kind => 'group_date_open', p_event_id => :'E1', p_audience => 'group_unanswered',
  p_payload => jsonb_build_object('group_id', :'G1'))::text, true);
select is((select array_agg(user_id order by user_id) from public.notification_recipients(
  (select n from public.notifications n where id = current_setting('test.n')::uuid))),
  array[:'B'::uuid, :'D'::uuid], 'unanswered members with a device; not the host, not members who answered');
-- Doris answers while the notice waits for quiet hours to end
insert into public.rsvps (event_id, user_id, display_name, status) values (:'E1', :'D', 'Doris', 'maybe');
select is((select array_agg(user_id) from public.notification_recipients(
  (select n from public.notifications n where id = current_setting('test.n')::uuid))),
  array[:'B'::uuid], 'a member who answered before the send is dropped');
:as_A
update public.events set group_id = null where id = :'E1';
select is(public.notification_stale_reason((select n from public.notifications n where id = current_setting('test.n')::uuid), now()),
  'group_removed', 'a notice for an event that no longer invites the group is dropped');
update public.events set group_id = :'G1' where id = :'E1';

-- Two joins within five minutes give one owner notice
select set_config('test.link', public.generate_random_token(22), true);
insert into public.group_invite_links (token, group_id) values (current_setting('test.link'), :'G1');
set local role authenticated;
:as_E
select ok(public.join_group_by_link(current_setting('test.link')) is not null, 'Eva joins');
:as_G
select ok(public.join_group_by_link(current_setting('test.link')) is not null, 'Gustav joins');
reset role;
select is((select jsonb_array_length(payload -> 'user_ids') from public.notifications
           where kind = 'group_joined' and target_user_id = :'A' and state = 'pending'), 2,
  'one pending join notice naming both');

-- ---------------------------------------------------------------------------------------------
-- 7.2 New-date notice for one-off events with a group
select is((select count(*)::int from public.notifications where kind = 'group_date_open' and event_id = :'E1'), 2,
  'inviting the group to the party queued a notice (plus the manual one above)');
set local role authenticated;
:as_A
select lives_ok($$ insert into public.events (host_id, title, starts_at, location_text, group_id)
  values ('00000000-0000-0000-0000-0000000067a1', 'Quiz', now() + interval '10 hours', 'Pub', '67000000-0000-0000-0000-0000000000a1') $$,
  'owner creates an event for the group');
reset role;
select is((select count(*)::int from public.notifications n join public.events e on e.id = n.event_id
           where e.title = 'Quiz' and n.kind = 'group_date_open'), 1, 'it queues a new-date notice');

-- ---------------------------------------------------------------------------------------------
-- 7.3 Reminder for members who have not answered
:as_A
select is((select count(*)::int from public.notifications n join public.events e on e.id = n.event_id
           where e.title = 'Quiz' and n.kind = 'group_answer_reminder'), 0, 'short notice: no reminder');
select is((select not_before from public.notifications where kind = 'group_answer_reminder' and event_id = :'E1' and state = 'pending'),
  (select starts_at - interval '24 hours' from public.events where id = :'E1'), 'the party reminder is due 24 hours before');
update public.events set starts_at = starts_at + interval '1 day' where id = :'E1';
select is((select not_before from public.notifications where kind = 'group_answer_reminder' and event_id = :'E1' and state = 'pending'),
  (select starts_at - interval '24 hours' from public.events where id = :'E1'), 'moving the event moves the reminder');
select is((select count(*)::int from public.notifications where kind = 'group_answer_reminder' and event_id = :'E1' and state = 'pending'), 1,
  'still one reminder');
select is((select array_agg(user_id order by user_id) from public.notification_recipients(
  (select n from public.notifications n where kind = 'group_answer_reminder' and event_id = :'E1' and state = 'pending'))),
  array[:'B'::uuid], 'only members who still have not answered get it');
update public.events set cancelled_at = now() where id = :'E1';
select is(public.notification_stale_reason(
  (select n from public.notifications n where kind = 'group_answer_reminder' and event_id = :'E1'), now()),
  'event_cancelled', 'cancelling drops the reminder');

select * from finish();
rollback;
