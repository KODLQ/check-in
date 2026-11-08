begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'other@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into events (id, title, starts_at, location_text)
values ('10000000-0000-0000-0000-000000000001', 'Party', now() + interval '2 days', 'X');

select is((select count(*)::int from event_invites where event_id = '10000000-0000-0000-0000-000000000001'),
  1, 'an invite link is created with the event');
select matches((select token from event_invites limit 1), '^[A-Za-z0-9]{12}$',
  'token is 12 base62 characters (~71 bits)');

create temp table old_token as select token from event_invites;
grant select on old_token to authenticated, anon;
select lives_ok($$ select regenerate_invite('10000000-0000-0000-0000-000000000001') $$, 'host can regenerate');

select isnt((select revoked_at from event_invites where token = (select token from old_token)),
  null, 'regenerating revokes the old link');
select is((select count(*)::int from event_invites where revoked_at is null), 1,
  'exactly one active link after regenerating');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select throws_ok($$ select regenerate_invite('10000000-0000-0000-0000-000000000001') $$,
  'P0002', 'not_found', 'other users cannot regenerate the link');

set local role anon;
select is((select count(*)::int from event_invites), 0, 'anon cannot list invites');

select * from finish();
rollback;
