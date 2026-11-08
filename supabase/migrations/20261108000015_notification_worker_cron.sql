-- Runs the notifications-worker Edge Function every minute, plus an immediate "kick" for urgent kinds
-- (design §6). The function URL and shared secret live in Supabase Vault:
--   select vault.create_secret('<https://<ref>.supabase.co/functions/v1/notifications-worker>', 'notifications_worker_url');
--   select vault.create_secret('<NOTIFICATIONS_WORKER_SECRET>', 'notifications_worker_secret');
-- Locally: node supabase/scripts/configure-worker.mjs (reads supabase/functions/.env).
-- Without both secrets the kick is a no-op and enqueued rows simply wait.
create extension if not exists pg_net with schema extensions;

create or replace function public.kick_notifications_worker()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  fn_url text;
  fn_secret text;
begin
  select decrypted_secret into fn_url from vault.decrypted_secrets where name = 'notifications_worker_url';
  select decrypted_secret into fn_secret from vault.decrypted_secrets where name = 'notifications_worker_secret';
  if fn_url is null or fn_secret is null then
    return null;
  end if;
  return net.http_post(
    url := fn_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', fn_secret,
      -- Run the function next to the database (Stockholm).
      'x-region', 'eu-north-1'
    ),
    timeout_milliseconds := 55000
  );
end;
$$;

revoke execute on function public.kick_notifications_worker() from public, anon, authenticated;
grant execute on function public.kick_notifications_worker() to service_role;

select cron.schedule('notifications-worker', '* * * * *', $$select public.kick_notifications_worker()$$);
