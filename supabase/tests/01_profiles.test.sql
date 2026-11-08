begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev', '{"full_name":"Anna Apple"}'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev', '{}');

select is((select display_name from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'Anna Apple', 'profile is created on sign-up with provider name');
select is((select display_name from profiles where id = '00000000-0000-0000-0000-00000000000b'),
  null, 'display name is empty until onboarding');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select is((select count(*)::int from profiles), 1, 'user sees only their own profile');

update profiles set display_name = 'Hacked' where id = '00000000-0000-0000-0000-00000000000b';
update profiles set display_name = 'Anna' where id = '00000000-0000-0000-0000-00000000000a';

reset role;
select is((select display_name from profiles where id = '00000000-0000-0000-0000-00000000000b'),
  null, 'user cannot update another profile');
select is((select display_name from profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'Anna', 'user can update own profile');

set local role anon;
select is((select count(*)::int from profiles), 0, 'anon sees no profiles');

select * from finish();
rollback;
