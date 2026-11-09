-- Event series: schema, access, date maths, date creation and create_series
-- (change: add-groups-and-recurring-events, tasks 3.1-3.4).
begin;
create extension if not exists pgtap with schema extensions;
select plan(49);

\ir fixtures/groups.psql

-- Tomorrow 17:00 Stockholm, as the first date of the test series.
select set_config('test.start',
  (((now() at time zone 'Europe/Stockholm')::date + 1 + time '17:00') at time zone 'Europe/Stockholm')::text, true);

-- ---------------------------------------------------------------------------------------------
-- 3.2 Date maths (pure, table-driven)
create temp table cases (label text, frequency text, anchor date, anchor_index int, k int, expected_local timestamp);
insert into cases values
  ('weekly +1', 'weekly', '2026-11-13', 0, 1, '2026-11-20 17:00'),
  ('every 2 weeks +2', 'biweekly', '2026-11-13', 0, 2, '2026-12-11 17:00'),
  ('first Friday 6 Nov -> 4 Dec', 'monthly', '2026-11-06', 0, 1, '2026-12-04 17:00'),
  ('last Thursday 26 Nov -> 31 Dec', 'monthly', '2026-11-26', 0, 1, '2026-12-31 17:00'),
  ('last Thursday -> last Thursday of Feb', 'monthly', '2026-11-26', 0, 3, '2027-02-25 17:00'),
  ('third Wednesday 18 Nov -> 20 Jan', 'monthly', '2026-11-18', 0, 2, '2027-01-20 17:00'),
  ('re-anchored at index 5', 'weekly', '2026-11-13', 5, 6, '2026-11-20 17:00'),
  ('17:00 kept across October clock change', 'weekly', '2026-10-23', 0, 1, '2026-10-30 17:00'),
  ('17:00 kept across March clock change', 'weekly', '2027-03-26', 0, 1, '2027-04-02 17:00');

select is(
  public.series_date_start(jsonb_populate_record(null::public.event_series, jsonb_build_object(
    'frequency', c.frequency, 'anchor_local_date', c.anchor, 'anchor_index', c.anchor_index,
    'local_start_time', '17:00', 'time_zone', 'Europe/Stockholm')), c.k) at time zone 'Europe/Stockholm',
  c.expected_local, c.label)
from cases c;

-- ---------------------------------------------------------------------------------------------
-- 3.4 create_series
set local role authenticated;
:as_C
select throws_ok(format($$ select public.create_series(%L, jsonb_build_object('title', 'AW', 'location_text', 'Bar',
  'starts_at', %L), 'weekly') $$, :'G1', current_setting('test.start')), 'P0001', 'not_group_admin',
  'a regular member cannot create a series');
:as_B
select throws_ok(format($$ select public.create_series(%L, jsonb_build_object('title', 'AW', 'location_text', 'Bar',
  'starts_at', %L, 'poll_options', '[]'::jsonb), 'weekly') $$, :'G1', current_setting('test.start')), 'P0001', 'repeat_with_poll',
  'no repeat together with a date poll');
select throws_ok(format($$ select public.create_series(%L, jsonb_build_object('title', 'AW', 'location_text', 'Bar',
  'starts_at', %L), 'daily') $$, :'G1', current_setting('test.start')), '22023', 'invalid_frequency', 'unknown frequency rejected');

select set_config('test.created', public.create_series(:'G1', jsonb_build_object(
  'title', 'AW', 'location_text', 'Bar Central', 'starts_at', current_setting('test.start'),
  'ends_at', (current_setting('test.start')::timestamptz + interval '3 hours')::text, 'capacity', 20), 'weekly')::text, true);
select ok(current_setting('test.created')::jsonb ? 'event_id' and current_setting('test.created')::jsonb ->> 'token' ~ '^[A-Za-z0-9]{12}$',
  'admin gets the first date and its invite link');
select set_config('test.sid', current_setting('test.created')::jsonb ->> 'series_id', true);

reset role;
select is((select count(*)::int from public.events where series_id = current_setting('test.sid')::uuid), 4,
  'a new weekly series has four dates');
select is((select array_agg((starts_at at time zone 'Europe/Stockholm')::time order by occurrence_index)
           from public.events where series_id = current_setting('test.sid')::uuid),
  array['17:00', '17:00', '17:00', '17:00']::time[], 'every date at 17:00 local');
select is((select array_agg(((starts_at at time zone 'Europe/Stockholm')::date - (current_setting('test.start')::timestamptz at time zone 'Europe/Stockholm')::date) order by occurrence_index)
           from public.events where series_id = current_setting('test.sid')::uuid),
  array[0, 7, 14, 21], 'one week apart');
select ok((select bool_and(host_id = :'A' and group_id = :'G1' and capacity = 20 and ends_at - starts_at = interval '3 hours')
           from public.events where series_id = current_setting('test.sid')::uuid),
  'dates are owned by the group owner, invite the group and copy the template');
select is((select count(*)::int from public.notifications n join public.events e on e.id = n.event_id
           where e.series_id = current_setting('test.sid')::uuid and n.kind = 'group_date_open'), 1,
  'creating a series sends one new-date notice (first date only)');
select is((select count(*)::int from cron.job where jobname = 'series-dates'), 1, 'hourly date job is registered');

-- Series limit: 10 active per group
insert into public.event_series (group_id, frequency, anchor_local_date, local_start_time, title, location_text)
select :'G1', 'weekly', current_date + 30, '18:00', 'filler ' || i, 'x' from generate_series(1, 9) i;
set local role authenticated;
:as_B
select throws_ok(format($$ select public.create_series(%L, jsonb_build_object('title', 'AW', 'location_text', 'Bar',
  'starts_at', %L), 'weekly') $$, :'G1', current_setting('test.start')), 'P0001', 'series_limit', 'the 11th series in a group is rejected');
reset role;
delete from public.event_series where title like 'filler %';

-- ---------------------------------------------------------------------------------------------
-- 3.1 Schema and access
select has_table('public', 'event_series', 'event_series exists');
select is((select confdeltype::text from pg_constraint where conname = 'event_series_group_id_fkey'), 'c', 'series cascade with the group');
select is((select confdeltype::text from pg_constraint where conname = 'events_series_id_fkey'), 'n', 'dates keep existing without the series');
select is((select confdeltype::text from pg_constraint where conname = 'events_group_id_fkey'), 'n', 'events lose the group when it is deleted');
select throws_ok(format($$ insert into public.events (series_id, occurrence_index, host_id, title, starts_at, location_text)
  values (%L, 0, %L, 'x', now() + interval '1 day', 'y') $$, current_setting('test.sid'), :'A'), 'P0001', 'series_rpc_only',
  'dates are only created by the series functions');

set local role authenticated;
:as_A
select is((select count(*)::int from public.event_series where id = current_setting('test.sid')::uuid), 1, 'owner reads the series');
:as_B
select is((select count(*)::int from public.event_series where id = current_setting('test.sid')::uuid), 1, 'admin reads the series');
select is((select count(*)::int from public.events where series_id = current_setting('test.sid')::uuid), 4, 'admin reads the dates');
:as_C
select is((select count(*)::int from public.event_series where id = current_setting('test.sid')::uuid), 0, 'member cannot read the series');
select is((select count(*)::int from public.events where series_id = current_setting('test.sid')::uuid), 0, 'member cannot read dates as a manager');
select is(jsonb_array_length(public.list_group_series(:'G1')), 1, 'member sees the series on the group screen');
:as_E
select is((select count(*)::int from public.events where series_id = current_setting('test.sid')::uuid), 0, 'stranger reads nothing');
select throws_ok(format($$ select public.list_group_series(%L) $$, :'G1'), 'P0002', 'not_found', 'stranger cannot list series');
reset role;
:as_anon
set local role anon;
select throws_ok($$ select count(*) from public.event_series $$, '42501', null, 'anon cannot read series');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 3.3 ensure_series_dates
select is(public.ensure_series_dates(current_setting('test.sid')::uuid), 0, 'nothing to do with four upcoming dates');
select set_config('test.first', (select starts_at::text from public.events
  where series_id = current_setting('test.sid')::uuid and occurrence_index = 0), true);
select is(public.ensure_series_dates(current_setting('test.sid')::uuid, current_setting('test.first')::timestamptz + interval '13 hours'), 1,
  'when the first date ends, the next one is created');
select is((select ((starts_at at time zone 'Europe/Stockholm')::date - (current_setting('test.first')::timestamptz at time zone 'Europe/Stockholm')::date)
           from public.events where series_id = current_setting('test.sid')::uuid and occurrence_index = 4), 28,
  'the new date is four weeks after the first');
select is(public.ensure_series_dates(current_setting('test.sid')::uuid, current_setting('test.first')::timestamptz + interval '13 hours'), 0,
  'running again creates no duplicate');
update public.events set cancelled_at = now()
where series_id = current_setting('test.sid')::uuid and occurrence_index = 2;
select is(public.ensure_series_dates(current_setting('test.sid')::uuid, current_setting('test.first')::timestamptz + interval '13 hours'), 0,
  'a cancelled date still counts as upcoming');
select is(public.ensure_series_dates(current_setting('test.sid')::uuid, current_setting('test.first')::timestamptz + interval '15 days'), 2,
  'missed runs catch up (two more dates ended)');
select is((select max(occurrence_index) from public.events where series_id = current_setting('test.sid')::uuid), 6,
  'no index is reused or skipped while catching up');
select is((select count(*)::int from public.notifications n join public.events e on e.id = n.event_id
           where e.series_id = current_setting('test.sid')::uuid and n.kind = 'group_date_open'), 4,
  'each later date gets its own new-date notice');

-- Horizon and end date
update public.event_series set frequency = 'monthly', next_index = 9, anchor_index = 0,
  anchor_local_date = (current_setting('test.start')::timestamptz at time zone 'Europe/Stockholm')::date
where id = current_setting('test.sid')::uuid;
select is(public.ensure_series_dates(current_setting('test.sid')::uuid, current_setting('test.first')::timestamptz + interval '15 days'), 0,
  'no date is created more than 6 months ahead');
update public.event_series set frequency = 'weekly', next_index = 7, ends_on = current_date - 1
where id = current_setting('test.sid')::uuid;
select is(public.ensure_series_dates(current_setting('test.sid')::uuid, current_setting('test.first')::timestamptz + interval '15 days'), 0,
  'no date after the end date');
update public.event_series set ends_on = null, ended_at = now() where id = current_setting('test.sid')::uuid;
select is(public.ensure_series_dates(current_setting('test.sid')::uuid, current_setting('test.first')::timestamptz + interval '15 days'), 0,
  'an ended series creates nothing');
select is(public.run_series_dates(), 0, 'the hourly job skips ended series');

-- Deleting the group ends the series and keeps its dates as plain events
update public.event_series set ended_at = null where id = current_setting('test.sid')::uuid;
set local role authenticated;
:as_A
select lives_ok(format($$ select public.delete_group(%L) $$, :'G1'), 'owner deletes the group');
reset role;
select is((select count(*)::int from public.event_series where id = current_setting('test.sid')::uuid), 0, 'the series is gone');
select is((select count(*)::int from public.events e where e.title = 'AW' and e.host_id = :'A' and e.series_id is null
           and e.group_id is null and e.cancelled_at is not null), 7,
  'its upcoming dates are kept as cancelled plain events (guests are told)');

select * from finish();
rollback;
