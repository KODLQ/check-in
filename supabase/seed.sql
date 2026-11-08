-- Local development seed. Sign in as demo@checkin.test with a magic link
-- (open Mailpit at http://127.0.0.1:54324 to click it).
insert into auth.users (
  instance_id, id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  '00000000-0000-0000-0000-000000000000', 'd0000000-0000-0000-0000-000000000001', 'authenticated',
  'authenticated', 'demo@checkin.test', now(), '{"provider":"email","providers":["email"]}',
  '{"full_name":"Demo Host"}', now(), now(), '', '', '', ''
);

insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values (
  'd0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
  '{"sub":"d0000000-0000-0000-0000-000000000001","email":"demo@checkin.test"}', 'email', now(), now(), now()
);

insert into public.events (id, host_id, title, description, starts_at, ends_at, location_text, place_name, latitude, longitude, theme)
values
  ('e0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001',
   'Fredagshäng på Söder', 'Ta med något att dricka. Portkod 1234.',
   date_trunc('day', now()) + interval '3 days 19 hours', null,
   'Hornsgatan 12, Stockholm', 'Hornsgatan 12', 59.3196, 18.0646, 'sunset'),
  ('e0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000001',
   'Picnic i Tantolunden', null,
   date_trunc('day', now()) + interval '10 days 13 hours', date_trunc('day', now()) + interval '10 days 17 hours',
   'Tantolunden', 'Tantolunden', 59.3133, 18.0503, 'meadow');

-- Fixed, readable invite tokens for local testing: http://localhost:3000/i/DemoFredag01
update public.event_invites set token = 'DemoFredag01' where event_id = 'e0000000-0000-0000-0000-000000000001';
update public.event_invites set token = 'DemoPicnic01' where event_id = 'e0000000-0000-0000-0000-000000000002';

insert into public.rsvps (event_id, guest_token_hash, display_name, status) values
  ('e0000000-0000-0000-0000-000000000001', public.hash_guest_token('seed-guest-0000000000001'), 'Alva', 'going'),
  ('e0000000-0000-0000-0000-000000000001', public.hash_guest_token('seed-guest-0000000000002'), 'Elias', 'going'),
  ('e0000000-0000-0000-0000-000000000001', public.hash_guest_token('seed-guest-0000000000003'), 'Maja', 'maybe'),
  ('e0000000-0000-0000-0000-000000000001', public.hash_guest_token('seed-guest-0000000000004'), 'Noah', 'declined'),
  ('e0000000-0000-0000-0000-000000000002', public.hash_guest_token('seed-guest-0000000000001'), 'Alva', 'maybe');
