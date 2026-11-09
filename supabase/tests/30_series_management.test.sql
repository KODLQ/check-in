-- Series editing, rule changes, ending, group-admin rights on dates and handover
-- (change: add-groups-and-recurring-events, tasks 4.1-4.2, 5.1-5.3).
begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

\ir fixtures/groups.psql

select set_config('test.start',
  (((now() at time zone 'Europe/Stockholm')::date + 1 + time '17:00') at time zone 'Europe/Stockholm')::text, true);

set local role authenticated;
:as_B
select set_config('test.sid', (public.create_series(:'G1', jsonb_build_object(
  'title', 'AW', 'location_text', 'Bar Central', 'starts_at', current_setting('test.start')), 'weekly') ->> 'series_id'), true);
reset role;
create temp table d as
select occurrence_index as k, id from public.events where series_id = current_setting('test.sid')::uuid;
grant select on d to authenticated;
-- Guests on dates 1 and 2; E co-hosts only date 1.
insert into public.rsvps (event_id, user_id, display_name, status)
select id, :'F', 'Frida', 'going' from d where k in (1, 2);
insert into public.event_co_hosts (event_id, user_id) select id, :'E' from d where k = 1;
delete from public.notifications where event_id in (select id from d);

-- ---------------------------------------------------------------------------------------------
-- 4.1 This and following
set local role authenticated;
:as_E
select throws_ok(format($$ select public.update_series_from(%L, '{"location_text":"Elsewhere"}') $$, (select id from d where k = 1)),
  'P0001', 'not_group_admin', 'a co-host of one date cannot edit following dates');
select lives_ok(format($$ update public.events set description = 'Only this one' where id = %L $$, (select id from d where k = 1)),
  'but can still edit that date');
:as_C
select throws_ok(format($$ select public.update_series_from(%L, '{"location_text":"Elsewhere"}') $$, (select id from d where k = 1)),
  'P0002', 'not_found', 'a regular member cannot edit the series');
:as_B
select is(public.update_series_from((select id from d where k = 1), jsonb_build_object('location_text', 'Bar Norr',
  'starts_at', (current_setting('test.start')::timestamptz + interval '7 days 1 hour')::text)), 3,
  'admin updates the chosen date and the following ones');
reset role;
select is((select array_agg(location_text order by k) from d join public.events e using (id)),
  array['Bar Central', 'Bar Norr', 'Bar Norr', 'Bar Norr'], 'earlier dates keep the old location');
select is((select array_agg((e.starts_at at time zone 'Europe/Stockholm')::time order by k) from d join public.events e using (id)),
  array['17:00', '18:00', '18:00', '18:00']::time[], 'the new time of day applies from the chosen date on');
select is((select array_agg((e.starts_at at time zone 'Europe/Stockholm')::date - (current_setting('test.start')::timestamptz at time zone 'Europe/Stockholm')::date order by k)
           from d join public.events e using (id)), array[0, 7, 14, 21], 'each date keeps its day');
select is((select location_text from public.event_series where id = current_setting('test.sid')::uuid), 'Bar Norr',
  'the series template is updated for future dates');
select is((select count(*)::int from public.notifications where kind = 'event_changed' and event_id in (select id from d)), 3,
  'one debounced change notice per changed date');
set local role authenticated;
:as_B
select throws_ok(format($$ select public.update_series_from(%L, jsonb_build_object('starts_at', %L)) $$,
  (select id from d where k = 2), (current_setting('test.start')::timestamptz + interval '15 days')::text),
  'P0001', 'day_change_this_date_only', 'moving to another day is a single-date change');

-- ---------------------------------------------------------------------------------------------
-- 4.2 Repeat rule and ending
:as_C
select throws_ok(format($$ select public.update_series_rule(%L, 'biweekly', null) $$, current_setting('test.sid')),
  'P0001', 'not_group_admin', 'a regular member cannot change the rule');
:as_E
select throws_ok(format($$ select public.update_series_rule(%L, 'biweekly', null) $$, current_setting('test.sid')),
  'P0002', 'not_found', 'a date co-host outside the group cannot see the series');
:as_B
select lives_ok(format($$ select public.update_series_rule(%L, 'biweekly', null) $$, current_setting('test.sid')),
  'admin switches to every 2 weeks');
reset role;
select is((select count(*)::int from public.events where series_id = current_setting('test.sid')::uuid), 4, 'existing dates are kept');
select is(public.ensure_series_dates(current_setting('test.sid')::uuid, current_setting('test.start')::timestamptz + interval '13 hours'), 1,
  'when a date ends the next one is created');
select is((select (e.starts_at at time zone 'Europe/Stockholm')::date - (current_setting('test.start')::timestamptz at time zone 'Europe/Stockholm')::date
           from public.events e where e.series_id = current_setting('test.sid')::uuid and e.occurrence_index = 4), 35,
  'two weeks after the last existing date');

-- ---------------------------------------------------------------------------------------------
-- 5.1 Group admins manage dates
set local role authenticated;
:as_B
select is((select count(*)::int from public.rsvps where event_id = (select id from d where k = 2)), 1, 'admin sees the full guest list');
select lives_ok(format($$ update public.events set cancelled_at = now() where id = %L $$, (select id from d where k = 3)),
  'admin cancels a date');
delete from public.events where id = (select id from d where k = 2);
select is((select count(*)::int from public.events where id = (select id from d where k = 2)), 1, 'admin cannot delete a date');
select ok(public.is_event_owner((select id from d where k = 2)), 'admin has owner rights on a series date');
select ok(not public.is_event_owner(:'E1'), 'but not on a one-off event of the owner');
select matches(public.create_co_host_invite((select id from d where k = 2)), '^[A-Za-z0-9]{22}$', 'admin invites a co-host to a date');
:as_C
select is((select count(*)::int from public.events where id = (select id from d where k = 2)), 0, 'a member has no manager access');
select throws_ok(format($$ select public.end_series(%L, false) $$, current_setting('test.sid')), 'P0001', 'not_group_admin',
  'a regular member cannot end the series');

reset role;
select is((select count(*)::int from public.notifications where kind = 'event_cancelled' and event_id = (select id from d where k = 3)),
  1, 'guests of the cancelled date are told');
set local role authenticated;
:as_A
select lives_ok(format($$ select public.set_group_admin(%L, %L, false) $$, :'G1', :'B'), 'owner demotes the admin');
:as_B
select is((select count(*)::int from public.events where series_id = current_setting('test.sid')::uuid), 0,
  'a demoted admin loses manager access at once');
select ok(not public.is_event_owner((select id from d where k = 2)), 'and owner rights');
:as_A
select is((select array[public.is_event_manager(:'E1'), public.is_event_owner(:'E1')]), array[true, true], 'one-off event: owner unchanged');
:as_B
select is((select array[public.is_event_manager(:'E1'), public.is_event_owner(:'E1')]), array[false, false], 'one-off event: others unchanged');

-- End the series and cancel upcoming dates
:as_A
select lives_ok(format($$ select public.end_series(%L, true) $$, current_setting('test.sid')), 'owner ends the series, cancelling upcoming');
reset role;
select is((select count(*)::int from public.events where series_id = current_setting('test.sid')::uuid and cancelled_at is null), 0,
  'every upcoming date is cancelled');
select is((select count(*)::int from public.notifications where kind = 'event_cancelled' and event_id = (select id from d where k = 1)),
  1, 'and its guests are told');
select is(public.ensure_series_dates(current_setting('test.sid')::uuid), 0, 'no new dates after ending');

-- End and keep
set local role authenticated;
:as_A
select set_config('test.sid2', (public.create_series(:'G1', jsonb_build_object(
  'title', 'Padel', 'location_text', 'Court', 'starts_at', current_setting('test.start')), 'monthly') ->> 'series_id'), true);
select lives_ok(format($$ select public.end_series(%L, false) $$, current_setting('test.sid2')), 'owner ends a series, keeping dates');
reset role;
select is((select count(*)::int from public.events where series_id = current_setting('test.sid2')::uuid and cancelled_at is null), 4,
  'the upcoming dates still happen');

-- ---------------------------------------------------------------------------------------------
-- 5.2 Handover moves every date
delete from public.notifications where event_id in (select id from public.events where series_id = current_setting('test.sid2')::uuid);
set local role authenticated;
:as_A
select lives_ok(format($$ select public.hand_over_and_leave_group(%L, %L) $$, :'G1', :'C'), 'owner hands over to Cecilia');
reset role;
select ok((select bool_and(host_id = :'C') from public.events where series_id in (current_setting('test.sid')::uuid, current_setting('test.sid2')::uuid)),
  'every date of the group''s series now belongs to the new owner');
select is((select count(*)::int from public.rsvps where event_id in (select id from d)), 2, 'answers are kept');
select is((select count(*)::int from public.notifications where kind = 'event_changed'
           and event_id in (select id from public.events where series_id = current_setting('test.sid2')::uuid)), 0,
  'moving dates sends no change notice');
set local role authenticated;
:as_C
select throws_ok(format($$ update public.events set host_id = %L where id = %L $$, :'A',
  (select id from public.events where series_id = current_setting('test.sid2')::uuid and occurrence_index = 1)),
  'P0001', 'host_immutable', 'an ordinary update still cannot move an event');

-- ---------------------------------------------------------------------------------------------
-- 5.3 Group shown as host
reset role;
select set_config('test.tok', (select token from public.event_invites where event_id =
  (select id from public.events where series_id = current_setting('test.sid2')::uuid and occurrence_index = 1) and revoked_at is null), true);
select set_config('test.tok1', (select token from public.event_invites where event_id = :'E1' and revoked_at is null), true);
:as_anon
set local role anon;
select is(public.get_invite(current_setting('test.tok')) -> 'group' ->> 'name', 'AW crew', 'a series date shows the group as host');
select is(public.get_invite(current_setting('test.tok')) -> 'host' ->> 'display_name', 'Cecilia', 'with the group owner''s name');
select ok(public.get_invite(current_setting('test.tok')) -> 'series' -> 'next' ->> 'token' ~ '^[A-Za-z0-9]{12}$',
  'and links to the next date');
select ok(not (public.get_invite(current_setting('test.tok1')) ? 'group'), 'a one-off event shows no group');

select * from finish();
rollback;
