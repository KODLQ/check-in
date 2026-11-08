begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

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

select * from finish();
rollback;
