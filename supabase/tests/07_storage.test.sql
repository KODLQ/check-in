begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.dev'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.dev');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);

select lives_ok($$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('covers', '00000000-0000-0000-0000-00000000000a/cover.jpg', '00000000-0000-0000-0000-00000000000a')
$$, 'user can upload a cover into their own folder');

select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('covers', '00000000-0000-0000-0000-00000000000b/evil.jpg', '00000000-0000-0000-0000-00000000000a')
$$, '42501', null, 'user cannot upload into another user''s folder');

select throws_ok($$
  insert into storage.objects (bucket_id, name, owner_id)
  values ('avatars', '00000000-0000-0000-0000-00000000000b/evil.jpg', '00000000-0000-0000-0000-00000000000a')
$$, '42501', null, 'user cannot overwrite another user''s avatar');


-- Event-folder covers (add-co-hosts): managers of the event may upload to covers/e/<event id>/.
reset role;
\ir fixtures/co_hosts.psql
set local role authenticated;
:as_A
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('covers', 'e/c0000000-0000-0000-0000-0000000000e1/owner.jpg', '00000000-0000-0000-0000-00000000c0a1') $$,
  'owner can upload to the event folder');
:as_B
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('covers', 'e/c0000000-0000-0000-0000-0000000000e1/cohost.jpg', '00000000-0000-0000-0000-00000000c0b1') $$,
  'co-host can upload to the event folder');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('covers', 'e/c0000000-0000-0000-0000-0000000000e1/nested/x.jpg', '00000000-0000-0000-0000-00000000c0b1') $$,
  '42501', null, 'nested paths in the event folder are rejected');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('avatars', 'e/c0000000-0000-0000-0000-0000000000e1/x.jpg', '00000000-0000-0000-0000-00000000c0b1') $$,
  '42501', null, 'event folders exist only in the covers bucket');
:as_C
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('covers', 'e/c0000000-0000-0000-0000-0000000000e1/evil.jpg', '00000000-0000-0000-0000-00000000c0c1') $$,
  '42501', null, 'a stranger cannot upload to the event folder');
:as_D
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('covers', 'e/c0000000-0000-0000-0000-0000000000e1/former.jpg', '00000000-0000-0000-0000-00000000c0d1') $$,
  '42501', null, 'a former co-host cannot upload to the event folder');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id)
  values ('covers', 'e/not-a-uuid/x.jpg', '00000000-0000-0000-0000-00000000c0d1') $$,
  '42501', null, 'a malformed event folder is rejected by the policy, not with an error');

select * from finish();
rollback;
