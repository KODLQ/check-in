-- Date polls, part 2 (change: add-date-polls, tasks 2.1, 2.2): create_poll_event and set_poll_options.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

\ir fixtures/date_polls.psql

create function pg_temp.opts(p_hours int[]) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('starts_at', now() + make_interval(hours => h)) order by i)
  from unnest(p_hours) with ordinality u(h, i)
$$;

create function pg_temp.ev(p_title text default 'Picnic') returns jsonb language sql as $$
  select jsonb_build_object('title', p_title, 'location_text', 'Tantolunden', 'capacity', 20, 'theme', 'forest')
$$;

-- ---------------------------------------------------------------------------------------------
-- 2.1 create_poll_event
set local role authenticated;
:as_O
create temp table created as select public.create_poll_event(pg_temp.ev(), pg_temp.opts(array[24, 48, 72])) as r;
select ok((select (r ->> 'token') ~ '^[A-Za-z0-9]{12}$' from created), 'the invite token is created with the poll event');
select is((select array[e.host_id::text, coalesce(e.starts_at::text, 'null'), e.title, e.capacity::text, e.theme]
           from public.events e where e.id = (select (r ->> 'event_id')::uuid from created)),
  array['00000000-0000-0000-0000-0000000d00a1', 'null', 'Picnic', '20', 'forest'],
  'the event is created date pending, owned by the caller, with the other fields');
select is((select count(*)::int from public.date_poll_options where event_id = (select (r ->> 'event_id')::uuid from created)), 3,
  'three options are created');
select is(public.get_invite((select r ->> 'token' from created)) ->> 'state', 'date_pending', 'its invite works immediately');

select throws_ok($$ select public.create_poll_event(pg_temp.ev(), pg_temp.opts(array[24])) $$,
  'P0001', 'poll_option_count', 'one option is rejected');
select throws_ok($$ select public.create_poll_event(pg_temp.ev(), pg_temp.opts(array[24, 48, 72, 96, 120])) $$,
  'P0001', 'poll_option_count', 'five options are rejected');
select throws_ok($$ select public.create_poll_event(pg_temp.ev(), pg_temp.opts(array[24, -1])) $$,
  'P0001', 'option_in_past', 'an option in the past is rejected');
select throws_ok($$ select public.create_poll_event(pg_temp.ev(), pg_temp.opts(array[24, 24])) $$,
  'P0001', 'option_duplicate', 'duplicate options are rejected');
select throws_ok($$ select public.create_poll_event(pg_temp.ev(),
                      jsonb_build_array(jsonb_build_object('starts_at', now() + interval '2 days', 'ends_at', now() + interval '1 day'),
                                        jsonb_build_object('starts_at', now() + interval '3 days'))) $$,
  'P0001', 'end_before_start', 'an option ending before it starts is rejected');
select throws_ok($$ select public.create_poll_event(pg_temp.ev(), pg_temp.opts(array[24, 48]), now() + interval '30 hours') $$,
  'P0001', 'deadline_invalid', 'a deadline after the earliest option is rejected');
select throws_ok($$ select public.create_poll_event(pg_temp.ev(), pg_temp.opts(array[24, 48]), now() - interval '1 hour') $$,
  'P0001', 'deadline_invalid', 'a deadline in the past is rejected');
select lives_ok($$ select public.create_poll_event(pg_temp.ev('With deadline'), pg_temp.opts(array[24, 48]), now() + interval '12 hours') $$,
  'a deadline before the earliest option is accepted');
select throws_ok($$ select public.create_poll_event(jsonb_build_object('title', '', 'location_text', 'X'), pg_temp.opts(array[24, 48])) $$,
  '23514', null, 'the event''s own checks still apply (empty title)');
select is((select count(*)::int from public.events where host_id = '00000000-0000-0000-0000-0000000d00a1'), 2,
  'rejected polls create nothing');

set local role anon;
:as_anon
select throws_ok($$ select public.create_poll_event(pg_temp.ev(), pg_temp.opts(array[24, 48])) $$,
  '42501', null, 'anon cannot create polls');

-- ---------------------------------------------------------------------------------------------
-- 2.2 set_poll_options
reset role;
select pg_temp.mk_poll('d0000000-0000-0000-0000-000000000021', 'PollOpts0001', array[24, 48, 72]);
select pg_temp.vote('PollOpts0001', 'Anna', array['yes', 'if_needed', 'no']);
select pg_temp.vote('PollOpts0001', 'Bo', array['no', 'yes', null]);
select pg_temp.vote('PollOpts0001', 'Cai', array[null, 'yes', 'yes']);

create function pg_temp.current(p_event uuid) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('id', id, 'starts_at', starts_at, 'ends_at', ends_at) order by starts_at)
  from public.date_poll_options where event_id = p_event
$$;
create function pg_temp.votes(p_event uuid) returns int language sql as $$
  select count(*)::int from public.date_poll_votes v join public.date_poll_options o on o.id = v.option_id
  where o.event_id = p_event
$$;

set local role authenticated;
:as_K
-- Adding a fourth option keeps every vote.
select is(public.set_poll_options('d0000000-0000-0000-0000-000000000021',
            pg_temp.current('d0000000-0000-0000-0000-000000000021') || pg_temp.opts(array[96])), 0,
  'adding an option deletes no votes (co-host)');
reset role;
select is(pg_temp.votes('d0000000-0000-0000-0000-000000000021'), 7, 'existing votes are kept');
select is((select count(*)::int from public.date_poll_options where event_id = 'd0000000-0000-0000-0000-000000000021'), 4,
  'the new option is added');

-- Removing option 2 (3 votes) returns 3.
set local role authenticated;
:as_O
select is(public.set_poll_options('d0000000-0000-0000-0000-000000000021',
            (select jsonb_agg(x) from jsonb_array_elements(pg_temp.current('d0000000-0000-0000-0000-000000000021')) with ordinality a(x, i)
             where i <> 2)), 3,
  'removing an option with 3 votes returns 3');
reset role;
select is(pg_temp.votes('d0000000-0000-0000-0000-000000000021'), 4, 'only that option''s votes are deleted');

-- Re-timing option 1 (Anna yes, Bo no) deletes its votes but keeps its id.
create temp table first_opt as select pg_temp.opt('d0000000-0000-0000-0000-000000000021', 1) as id;
set local role authenticated;
:as_O
select is(public.set_poll_options('d0000000-0000-0000-0000-000000000021',
            (select jsonb_agg(case when i = 1 then x || jsonb_build_object('starts_at', now() + interval '30 hours') else x end)
             from jsonb_array_elements(pg_temp.current('d0000000-0000-0000-0000-000000000021')) with ordinality a(x, i))), 2,
  'changing an option''s time deletes its 2 votes');
reset role;
select is((select count(*)::int from public.date_poll_votes where option_id = (select id from first_opt)), 0,
  'the re-timed option has no votes');
select is(pg_temp.votes('d0000000-0000-0000-0000-000000000021'), 2, 'the other options keep theirs');
select is((select array_agg(display_name order by display_name) from public.date_poll_voters
           where event_id = 'd0000000-0000-0000-0000-000000000021'), array['Anna', 'Cai'],
  'a voter left without any answer is removed (Bo)');

-- Rejections keep everything as it was.
set local role authenticated;
:as_O
select throws_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000021',
                      (select jsonb_agg(case when i = 1 then x || jsonb_build_object('starts_at', now() - interval '1 hour') else x end)
                       from jsonb_array_elements(pg_temp.current('d0000000-0000-0000-0000-000000000021')) with ordinality a(x, i))) $$,
  'P0001', 'option_in_past', 'changing an option to the past is rejected');
select throws_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000021',
                      (select jsonb_agg(x) from jsonb_array_elements(pg_temp.current('d0000000-0000-0000-0000-000000000021')) with ordinality a(x, i) where i = 1)) $$,
  'P0001', 'poll_option_count', 'fewer than 2 options are rejected');
reset role;
select is(pg_temp.votes('d0000000-0000-0000-0000-000000000021'), 2, 'rejected edits keep the votes');

-- Deadline: set, extend after it passed, remove.
set local role authenticated;
:as_O
select lives_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000021',
                     pg_temp.current('d0000000-0000-0000-0000-000000000021'), now() + interval '2 hours') $$,
  'the host can set a deadline');
reset role;
select set_config('checkin.poll_rpc', 'on', true);
update public.events set poll_closes_at = now() - interval '1 minute' where id = 'd0000000-0000-0000-0000-000000000021';
select set_config('checkin.poll_rpc', '', true);
set local role authenticated;
:as_O
select lives_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000021',
                     pg_temp.current('d0000000-0000-0000-0000-000000000021'),
                     (select poll_closes_at from public.events where id = 'd0000000-0000-0000-0000-000000000021')) $$,
  'an unchanged deadline that already passed is accepted');
select lives_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000021',
                     pg_temp.current('d0000000-0000-0000-0000-000000000021'), now() + interval '3 hours') $$,
  'a closed poll''s deadline can be extended');
select lives_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000021',
                     pg_temp.current('d0000000-0000-0000-0000-000000000021'), null) $$,
  'the deadline can be removed');

-- Non-managers, picked and cancelled polls.
:as_X
select throws_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000021',
                      pg_temp.current('d0000000-0000-0000-0000-000000000021')) $$,
  'P0002', 'not_found', 'a non-host cannot edit options');
:as_O
select public.pick_poll_option(pg_temp.opt('d0000000-0000-0000-0000-000000000021', 2));
select throws_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000021',
                      pg_temp.current('d0000000-0000-0000-0000-000000000021')) $$,
  'P0001', 'already_picked', 'a picked poll cannot be edited');
reset role;
select pg_temp.mk_poll('d0000000-0000-0000-0000-000000000022', 'PollOpts0002', array[24, 48]);
update public.events set cancelled_at = now() where id = 'd0000000-0000-0000-0000-000000000022';
set local role authenticated;
:as_O
select throws_ok($$ select public.set_poll_options('d0000000-0000-0000-0000-000000000022',
                      pg_temp.current('d0000000-0000-0000-0000-000000000022')) $$,
  'P0001', 'event_closed', 'a cancelled poll cannot be edited');

select * from finish();
rollback;
