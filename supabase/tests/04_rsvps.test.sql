begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'host@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'other@test.dev'),
  ('00000000-0000-0000-0000-00000000000c', 'guest@test.dev');
update profiles set display_name = 'Gus' where id = '00000000-0000-0000-0000-00000000000c';

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into events (id, title, starts_at, location_text)
values ('10000000-0000-0000-0000-000000000001', 'Party', now() + interval '2 days', 'X');
reset role;

insert into rsvps (event_id, guest_token_hash, display_name, status)
values ('10000000-0000-0000-0000-000000000001', hash_guest_token('guest-token-aaaaaaaaaaaaaaa'), 'Anon', 'going');
insert into rsvps (event_id, user_id, display_name, status)
values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 'Gus', 'maybe');

set local role authenticated;
select is((select count(*)::int from rsvps), 2, 'host sees all responses to their event');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from rsvps), 0, 'other users see no responses');
select throws_ok($$
  insert into rsvps (event_id, user_id, display_name, status)
  values ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'B', 'going')
$$, '42501', null, 'users cannot insert responses directly');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select is((select count(*)::int from rsvps), 1, 'a signed-in guest sees only their own response');

set local role anon;
select is((select count(*)::int from rsvps), 0, 'anon cannot read responses');
select throws_ok($$
  insert into rsvps (event_id, guest_token_hash, display_name, status)
  values ('10000000-0000-0000-0000-000000000001', repeat('a', 64), 'Spam', 'going')
$$, '42501', null, 'anon cannot insert responses directly');

-- Host removes a guest
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
delete from rsvps where display_name = 'Anon';
select is((select count(*)::int from rsvps), 1, 'host can remove a guest');

select * from finish();
rollback;
