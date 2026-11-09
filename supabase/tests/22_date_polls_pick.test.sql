-- Date polls, part 3 (change: add-date-polls, task 2.3): picking an option and converting votes to RSVPs,
-- through the capacity-aware admission path (add-guest-capacity).
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

\ir fixtures/date_polls.psql

-- Capacity 2. Vote order: Anna, Bo, Cai, Dan, Eve, then signed-in Ulla and Vera.
select pg_temp.mk_poll('d0000000-0000-0000-0000-000000000031', 'PollPick0001', array[48, 72], 2);
select pg_temp.vote('PollPick0001', 'Anna', array['yes', 'no']);
select pg_temp.vote('PollPick0001', 'Bo', array['if_needed', 'yes']);
select pg_temp.vote('PollPick0001', 'Cai', array['yes', 'yes']);
select pg_temp.vote('PollPick0001', 'Dan', array['no', 'yes']);
select pg_temp.vote('PollPick0001', 'Eve', array[null, 'yes']);
-- (claims only: the ballot helper reads option ids, which voters can't select themselves)
:as_U
select public.vote_as_user('PollPick0001', pg_temp.ballot('d0000000-0000-0000-0000-000000000031', array['yes']));
:as_V
select public.vote_as_user('PollPick0001', pg_temp.ballot('d0000000-0000-0000-0000-000000000031', array['no', 'yes']));
-- An option whose time has passed (inserted directly; the RPCs never allow it).
insert into public.date_poll_options (event_id, starts_at) values ('d0000000-0000-0000-0000-000000000031', now() - interval '1 hour');

-- Rejections
set local role authenticated;
:as_X
select throws_ok($$ select public.pick_poll_option(pg_temp.opt('d0000000-0000-0000-0000-000000000031', 2)) $$,
  'P0002', 'not_found', 'a non-host cannot pick');
:as_U
select throws_ok($$ select public.pick_poll_option(pg_temp.opt('d0000000-0000-0000-0000-000000000031', 2)) $$,
  'P0002', 'not_found', 'a voter cannot pick');
:as_O
select throws_ok($$ select public.pick_poll_option(pg_temp.opt('d0000000-0000-0000-0000-000000000031', 1)) $$,
  'P0001', 'option_passed', 'an option in the past cannot be picked');
reset role;
select is((select starts_at from public.events where id = 'd0000000-0000-0000-0000-000000000031'), null,
  'after a rejected pick the poll stays open');
select throws_ok($$ select public.upsert_rsvp('PollPick0001', pg_temp.guest_token('Anna'), 'Anna', 'going') $$,
  'P0001', 'date_pending', 'no RSVPs before the pick');

-- The co-host picks option 2 (now the first option by time is the passed one, so option 2 = +48h).
create temp table picked as select pg_temp.opt('d0000000-0000-0000-0000-000000000031', 2) as id,
  (select starts_at from public.date_poll_options where id = pg_temp.opt('d0000000-0000-0000-0000-000000000031', 2)) as starts_at;
grant select on picked to authenticated;
set local role authenticated;
:as_K
select is(public.pick_poll_option((select id from picked)) - 'starts_at' - 'ends_at',
  '{"going": 2, "waitlisted": 1, "maybe": 1}'::jsonb,
  'a co-host picks: 2 Going (capacity), 1 waitlisted, 1 Maybe');
reset role;

select is((select array[(starts_at = (select starts_at from picked))::text, (date_picked_at is not null)::text,
                        coalesce(time_changed_at::text, 'null')]
           from public.events where id = 'd0000000-0000-0000-0000-000000000031'),
  array['true', 'true', 'null'], 'the event gets the option''s start, a pick time and no "time updated" mark');
select is(pg_temp.rsvp_status('d0000000-0000-0000-0000-000000000031', 'Anna'), 'going', 'first Yes voter becomes Going');
select is(pg_temp.rsvp_status('d0000000-0000-0000-0000-000000000031', 'Cai'), 'going', 'second Yes voter becomes Going');
select is(pg_temp.rsvp_status('d0000000-0000-0000-0000-000000000031', 'Ulla'), 'waitlisted',
  'a Yes voter who does not fit is waitlisted');
select is((select public.waitlist_position(id) from public.rsvps
           where event_id = 'd0000000-0000-0000-0000-000000000031' and display_name = 'Ulla'), 1, 'in voting order');
select is(pg_temp.rsvp_status('d0000000-0000-0000-0000-000000000031', 'Bo'), 'maybe', 'If needed becomes Maybe');
select is((select count(*)::int from public.rsvps where event_id = 'd0000000-0000-0000-0000-000000000031'
           and display_name in ('Dan', 'Eve', 'Vera')), 0, 'No and unanswered voters get no RSVP');
select is((select sum(plus_ones)::int from public.rsvps where event_id = 'd0000000-0000-0000-0000-000000000031'), 0,
  'converted answers carry no plus-ones');
select is((select user_id from public.rsvps where event_id = 'd0000000-0000-0000-0000-000000000031' and display_name = 'Ulla'),
  '00000000-0000-0000-0000-0000000d00d1'::uuid, 'a signed-in voter''s RSVP is on their account');

-- Same device identity
set local role anon;
:as_anon
select is(public.get_invite('PollPick0001', pg_temp.guest_token('Anna')) -> 'my_rsvp' ->> 'status', 'going',
  'the converted guest sees Going on the same device (same guest_token_hash)');
select is(public.get_invite('PollPick0001') ->> 'state', 'active', 'a picked event is a normal active invite');
reset role;

-- Votes are gone, tallies stay
select is((select count(*)::int from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000031'), 0,
  'voters (and their votes) are deleted');
select is((select array[final_yes, final_if_needed, final_no] from public.date_poll_options where id = (select id from picked)),
  array[3, 1, 2], 'final tallies of the picked option are kept');
select is((select array[final_yes, final_if_needed, final_no] from public.date_poll_options
           where event_id = 'd0000000-0000-0000-0000-000000000031' and starts_at > (select starts_at from picked)),
  array[5, 0, 1], 'final tallies of the other options are kept');

-- Notifications
select is((select array_agg(target_user_id::text order by target_user_id) from public.notifications
           where event_id = 'd0000000-0000-0000-0000-000000000031' and kind = 'date_picked'),
  array['00000000-0000-0000-0000-0000000d00d1', '00000000-0000-0000-0000-0000000d00e1'],
  'every signed-in voter gets a "date picked" push, whatever they answered');
select is((select count(*)::int from public.notifications
           where event_id = 'd0000000-0000-0000-0000-000000000031' and kind in ('rsvp_digest', 'event_changed')), 0,
  'the pick sends no reply digest and no "event changed"');
select is((select not_before from public.notifications
           where event_id = 'd0000000-0000-0000-0000-000000000031' and kind = 'event_reminder' and state = 'pending'),
  (select starts_at from picked) - interval '24 hours', 'the reminder is scheduled for the picked start');

-- After the pick
set local role authenticated;
:as_O
select throws_ok($$ select public.pick_poll_option(pg_temp.opt('d0000000-0000-0000-0000-000000000031', 3)) $$,
  'P0001', 'already_picked', 'a pick cannot be undone or repeated');
reset role;
select throws_ok($$ select pg_temp.vote('PollPick0001', 'Late', array[null, 'yes']) $$,
  'P0001', 'poll_closed', 'votes after the pick are rejected');
select is(public.upsert_rsvp('PollPick0001', pg_temp.guest_token('Dan'), 'Dan', 'maybe') ->> 'status', 'maybe',
  'a No voter can RSVP normally after the pick');

select * from finish();
rollback;
