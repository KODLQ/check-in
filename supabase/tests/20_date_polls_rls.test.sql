-- Date polls, part 1 (change: add-date-polls, tasks 1.1, 1.2): schema, constraints, RLS and Realtime.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

\ir fixtures/date_polls.psql

-- ---------------------------------------------------------------------------------------------
-- 1.1 Schema
select col_is_null('public', 'events', 'starts_at', 'events.starts_at is nullable (null = date pending)');
select has_column('public', 'events', 'poll_closes_at', 'events.poll_closes_at exists');
select has_column('public', 'events', 'date_picked_at', 'events.date_picked_at exists');
select has_table('public', 'date_poll_options', 'date_poll_options exists');
select has_table('public', 'date_poll_voters', 'date_poll_voters exists');
select has_table('public', 'date_poll_votes', 'date_poll_votes exists');
select enum_has_labels('public', 'vote_choice', array['yes', 'if_needed', 'no'], 'vote_choice enum');

select pg_temp.mk_poll('d0000000-0000-0000-0000-000000000001', 'PollRls00001', array[24, 48]);

select set_config('checkin.poll_rpc', 'on', true); -- past the guard, to reach the constraint
select throws_ok($$ update public.events set ends_at = now() + interval '1 day'
                    where id = 'd0000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'a pending event cannot have an end without a start');
select set_config('checkin.poll_rpc', '', true);
select throws_ok($$ insert into public.date_poll_options (event_id, starts_at, ends_at)
                    values ('d0000000-0000-0000-0000-000000000001', now() + interval '3 days', now() + interval '2 days') $$,
  '23514', null, 'an option cannot end before it starts');
set constraints public.date_poll_options_unique_start immediate;
select throws_ok($$ insert into public.date_poll_options (event_id, starts_at)
                    select event_id, starts_at from public.date_poll_options
                    where event_id = 'd0000000-0000-0000-0000-000000000001' limit 1 $$,
  '23505', null, 'two options of one event cannot share a start');
set constraints public.date_poll_options_unique_start deferred;
select throws_ok($$ insert into public.date_poll_voters (event_id, display_name)
                    values ('d0000000-0000-0000-0000-000000000001', 'Nobody') $$,
  '23514', null, 'a voter needs exactly one identity');

-- Votes from a guest and from two signed-in users.
select pg_temp.vote('PollRls00001', 'Gina', array['yes', 'no']);
:as_U
select public.vote_as_user('PollRls00001', pg_temp.ballot('d0000000-0000-0000-0000-000000000001', array['if_needed']));
:as_V
select public.vote_as_user('PollRls00001', pg_temp.ballot('d0000000-0000-0000-0000-000000000001', array['yes', 'yes']));

-- ---------------------------------------------------------------------------------------------
-- 1.2 RLS: managers read everything
set local role authenticated;
:as_O
select is((select count(*)::int from public.date_poll_options where event_id = 'd0000000-0000-0000-0000-000000000001'), 2,
  'owner reads the options');
select is((select count(*)::int from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000001'), 3,
  'owner reads every voter');
select is((select count(*)::int from public.date_poll_votes v
           join public.date_poll_options o on o.id = v.option_id
           where o.event_id = 'd0000000-0000-0000-0000-000000000001'), 5, 'owner reads every vote, No answers included');
:as_K
select is((select count(*)::int from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000001'), 3,
  'co-host reads every voter');
select is((select count(*)::int from public.date_poll_votes v
           join public.date_poll_options o on o.id = v.option_id
           where o.event_id = 'd0000000-0000-0000-0000-000000000001'), 5, 'co-host reads every vote');

-- Signed-in voter: own row only
:as_U
select is((select array_agg(display_name) from public.date_poll_voters), array['Ulla'], 'a voter reads only their own voter row');
select is((select count(*)::int from public.date_poll_votes), 1, 'a voter reads only their own votes');
select is((select count(*)::int from public.date_poll_options), 0, 'a voter does not read options directly');

-- Strangers and anon
:as_X
select is((select count(*)::int from public.date_poll_voters), 0, 'a stranger reads no voters');
select is((select count(*)::int from public.date_poll_votes), 0, 'a stranger reads no votes');
select is((select count(*)::int from public.date_poll_options), 0, 'a stranger reads no options');
delete from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000001';
reset role;
select is((select count(*)::int from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000001'), 3,
  'a stranger cannot delete voters');
set local role anon;
:as_anon
select is((select count(*)::int from public.date_poll_voters), 0, 'anon reads no voters');
select is((select count(*)::int from public.date_poll_options), 0, 'anon reads no options');

-- No direct writes for anyone
set local role authenticated;
:as_O
select throws_ok($$ insert into public.date_poll_options (event_id, starts_at)
                    values ('d0000000-0000-0000-0000-000000000001', now() + interval '5 days') $$,
  '42501', null, 'the owner cannot insert options directly');
select throws_ok($$ insert into public.date_poll_voters (event_id, user_id, display_name)
                    values ('d0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000d00a1', 'Olga') $$,
  '42501', null, 'nobody can insert voters directly');
update public.date_poll_votes set choice = 'no';
update public.date_poll_options set starts_at = starts_at + interval '1 hour';
reset role;
select is((select count(*)::int from public.date_poll_votes v
           join public.date_poll_options o on o.id = v.option_id
           where o.event_id = 'd0000000-0000-0000-0000-000000000001' and v.choice = 'no'), 1,
  'nobody can update votes or options directly');

-- Deletes: a voter withdraws themselves, a manager removes anyone
set local role authenticated;
:as_U
delete from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000001';
reset role;
select is((select array_agg(display_name order by display_name) from public.date_poll_voters
           where event_id = 'd0000000-0000-0000-0000-000000000001'), array['Gina', 'Vera'],
  'a signed-in voter can delete only their own row');
set local role authenticated;
:as_K
delete from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000001' and display_name = 'Gina';
reset role;
select is((select array_agg(display_name) from public.date_poll_voters
           where event_id = 'd0000000-0000-0000-0000-000000000001'), array['Vera'], 'a co-host can remove a voter');
select is((select count(*)::int from public.date_poll_votes v
           join public.date_poll_options o on o.id = v.option_id
           where o.event_id = 'd0000000-0000-0000-0000-000000000001'), 2, 'removing a voter deletes their votes');

-- Realtime
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'date_poll_voters'),
  'voters are published to Realtime');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'date_poll_options'),
  'options are published to Realtime');

select * from finish();
rollback;
