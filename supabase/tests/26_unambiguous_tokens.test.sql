-- Invite and co-host tokens avoid look-alike characters (0/O, 1/l/I); old tokens keep working.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

create temp table guest_tokens as select public.generate_invite_token() as token from generate_series(1, 2000);
create temp table co_host_tokens as select public.generate_random_token(22) as token from generate_series(1, 500);

select is((select count(*)::int from guest_tokens where token !~ '^[A-Za-z0-9]{12}$'), 0,
  'guest tokens still match the 12-char base62 format');
select is((select count(*)::int from co_host_tokens where token !~ '^[A-Za-z0-9]{22}$'), 0,
  'co-host tokens still match the 22-char base62 format');
select is((select count(*)::int from guest_tokens where token ~ '[0O1lI]'), 0,
  'guest tokens never contain 0, O, 1, l or I');
select is((select count(*)::int from co_host_tokens where token ~ '[0O1lI]'), 0,
  'co-host tokens never contain 0, O, 1, l or I');
select is((select count(distinct c)::int from guest_tokens, regexp_split_to_table(token, '') c), 57,
  'all 57 symbols of the unambiguous alphabet are used');
select is((select count(distinct token)::int from guest_tokens), 2000, 'tokens are random');

-- A link created before the change (with look-alike characters) still opens the invite.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'host@test.dev');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
insert into events (id, title, starts_at, location_text)
values ('10000000-0000-0000-0000-000000000001', 'Party', now() + interval '2 days', 'X');
reset role;
update public.event_invites set token = 'Il0O1lIl0O1l' where event_id = '10000000-0000-0000-0000-000000000001';

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(public.get_invite('Il0O1lIl0O1l') ->> 'state', 'active', 'an existing token with look-alikes still works');
select is(public.get_invite('I10O1lIl0O1l') ->> 'state', 'not_found', 'tokens are still matched exactly');
reset role;

select * from finish();
rollback;
