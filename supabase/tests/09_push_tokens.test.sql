begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select lives_ok($$ select register_push_token('ExponentPushToken[device-1]', 'ios', 'sv') $$, 'user registers a device');
select lives_ok($$ select register_push_token('ExponentPushToken[device-2]', 'ios', 'en') $$, 'user registers a second device');
select lives_ok($$ select register_push_token('ExponentPushToken[device-1]', 'ios', 'en') $$, 're-registering refreshes the row');
select is((select count(*)::int from push_tokens), 2, 'owner sees their own devices, one row per token');
select is((select locale from push_tokens where token = 'ExponentPushToken[device-1]'), 'en', 're-registering updates the locale');
select throws_ok($$ insert into push_tokens (user_id, token, platform) values ('00000000-0000-0000-0000-00000000000a', 'ExponentPushToken[x]', 'ios') $$,
  '42501', null, 'no direct inserts');

-- Another user cannot see or delete A's tokens
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
select is((select count(*)::int from push_tokens), 0, 'other users see no tokens');
delete from push_tokens where token = 'ExponentPushToken[device-2]';
select ok(not unregister_push_token('ExponentPushToken[device-2]'), 'other users cannot unregister a token');

-- Account switch on device-1: B signs in on the same phone
select register_push_token('ExponentPushToken[device-1]', 'ios', 'sv');
reset role;
select is((select user_id from push_tokens where token = 'ExponentPushToken[device-1]'), '00000000-0000-0000-0000-00000000000b'::uuid,
  'token moves to the account now signed in on the device');
select is((select count(*)::int from push_tokens where user_id = '00000000-0000-0000-0000-00000000000a'), 1,
  'previous account keeps only its other device');

set local role anon;
select throws_ok($$ select register_push_token('ExponentPushToken[anon]', 'ios', 'en') $$, '42501', null, 'anon cannot register');
reset role;

delete from auth.users where id = '00000000-0000-0000-0000-00000000000a';
select is((select count(*)::int from push_tokens where token = 'ExponentPushToken[device-2]'), 0, 'account deletion removes its devices');

select * from finish();
rollback;
