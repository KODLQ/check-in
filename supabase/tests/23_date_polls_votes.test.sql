-- Date polls, part 4 (change: add-date-polls, task 3.1): guest and signed-in voting.
begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

\ir fixtures/date_polls.psql

select pg_temp.mk_poll('d0000000-0000-0000-0000-000000000041', 'PollVote0001', array[24, 48, 72]);

-- First vote, change, no duplicates
select is(pg_temp.vote('PollVote0001', 'Anna', array['if_needed', 'no']),
  jsonb_build_object('display_name', 'Anna', 'votes', jsonb_build_object(
    pg_temp.opt('d0000000-0000-0000-0000-000000000041', 1), 'if_needed',
    pg_temp.opt('d0000000-0000-0000-0000-000000000041', 2), 'no')),
  'a guest''s votes are saved and returned as their current votes (option 3 unanswered)');
select is(pg_temp.vote('PollVote0001', 'Anna', array['yes', null, 'yes']) -> 'votes' ->> pg_temp.opt('d0000000-0000-0000-0000-000000000041', 1)::text,
  'yes', 'a guest can change an answer');
select is((select count(*)::int from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000041'), 1,
  'changing votes does not add a voter');
select is((select count(*)::int from public.date_poll_votes v join public.date_poll_voters p on p.id = v.voter_id
           where p.event_id = 'd0000000-0000-0000-0000-000000000041'), 2, 'the ballot is replaced: one answer per option');
select is((select guest_token_hash from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000041'),
  public.hash_guest_token(pg_temp.guest_token('Anna')), 'only the hash of the guest token is stored');

-- Input errors
select throws_ok($$ select public.submit_votes('PollVote0001', pg_temp.guest_token('Nameless'), '  ',
                      pg_temp.ballot('d0000000-0000-0000-0000-000000000041', array['yes'])) $$,
  'P0001', 'name_required', 'a name is required');
select throws_ok($$ select pg_temp.vote('PollVote0001', 'Empty', array[]::text[]) $$,
  'P0001', 'no_votes', 'an empty ballot is rejected');
select throws_ok($$ select pg_temp.vote('PollVote0001', 'Odd', array['maybe']) $$,
  'P0001', 'invalid_choice', 'an unknown choice is rejected');
select throws_ok($$ select public.submit_votes('PollVote0001', pg_temp.guest_token('Odd'), 'Odd',
                      jsonb_build_array(jsonb_build_object('option_id', gen_random_uuid(), 'choice', 'yes'))) $$,
  'P0001', 'option_not_found', 'an option of another (or no) event is rejected');
select throws_ok($$ select public.submit_votes('NoSuchToken1', pg_temp.guest_token('Odd'), 'Odd', '[]'::jsonb) $$,
  'P0002', 'not_found', 'an unknown link is rejected');
select is((select count(*)::int from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000041'), 1,
  'rejected ballots save nothing');

-- Passed option
update public.date_poll_options set starts_at = now() - interval '1 minute'
where id = pg_temp.opt('d0000000-0000-0000-0000-000000000041', 1);
select throws_ok($$ select pg_temp.vote('PollVote0001', 'Bo', array['yes', 'yes']) $$,
  'P0001', 'option_passed', 'votes for an option whose time has passed are rejected (whole ballot)');
select lives_ok($$ select pg_temp.vote('PollVote0001', 'Bo', array[null, 'yes']) $$,
  'the other options still take votes');

-- Deadline
select set_config('checkin.poll_rpc', 'on', true);
update public.events set poll_closes_at = now() - interval '1 second' where id = 'd0000000-0000-0000-0000-000000000041';
select set_config('checkin.poll_rpc', '', true);
select throws_ok($$ select pg_temp.vote('PollVote0001', 'Bo', array[null, 'no']) $$,
  'P0001', 'poll_closed', 'votes after the deadline are rejected');
select set_config('checkin.poll_rpc', 'on', true);
update public.events set poll_closes_at = now() + interval '1 hour' where id = 'd0000000-0000-0000-0000-000000000041';
select set_config('checkin.poll_rpc', '', true);
select lives_ok($$ select pg_temp.vote('PollVote0001', 'Bo', array[null, 'no']) $$, 'an extended deadline reopens voting');

-- Withdraw
select ok(public.withdraw_votes('PollVote0001', pg_temp.guest_token('Bo')), 'a guest can withdraw');
select is((select count(*)::int from public.date_poll_voters where event_id = 'd0000000-0000-0000-0000-000000000041'
           and display_name = 'Bo'), 0, 'withdrawing deletes the name and all answers');

-- Signed-in users
:as_U
select is(public.vote_as_user('PollVote0001', pg_temp.ballot('d0000000-0000-0000-0000-000000000041', array[null, 'yes'])) ->> 'display_name',
  'Ulla', 'a signed-in user votes with their profile name');
select ok(public.withdraw_votes_as_user('PollVote0001'), 'a signed-in user can withdraw');
set local role anon;
:as_anon
select throws_ok($$ select public.vote_as_user('PollVote0001', '[]'::jsonb) $$, '42501', null, 'anon cannot call vote_as_user');
select throws_ok($$ select public.submit_votes('PollVote0001', 'x', 'x', '[]'::jsonb) $$, '42501', null,
  'anon cannot call submit_votes (service role only)');
set local role authenticated;
:as_U
select throws_ok($$ select public.withdraw_votes('PollVote0001', 'x') $$, '42501', null,
  'authenticated cannot call withdraw_votes (service role only)');
reset role;

-- Voter cap (same maximum as RSVPs)
insert into public.date_poll_voters (event_id, guest_token_hash, display_name)
select 'd0000000-0000-0000-0000-000000000041', public.hash_guest_token('cap-filler-' || g), 'Filler ' || g
from generate_series(1, public.max_rsvps_per_event() - 1) g;
select throws_ok($$ select pg_temp.vote('PollVote0001', 'Newbie', array[null, 'yes']) $$,
  'P0001', 'rate_limited', 'a new voter is rejected at the cap');
select lives_ok($$ select pg_temp.vote('PollVote0001', 'Anna', array[null, 'no']) $$,
  'existing voters can still change their votes at the cap');

-- Cancelled (by the owner)
:as_O
update public.events set cancelled_at = now() where id = 'd0000000-0000-0000-0000-000000000041';
select throws_ok($$ select pg_temp.vote('PollVote0001', 'Anna', array[null, 'yes']) $$,
  'P0001', 'event_closed', 'a cancelled poll takes no votes');
set local role anon;
:as_anon
select is(public.get_invite('PollVote0001'), '{"state":"cancelled","event":{"title":"Poll PollVote0001"}}'::jsonb,
  'a cancelled poll shows only its title (no options, tallies or controls)');

select * from finish();
rollback;
