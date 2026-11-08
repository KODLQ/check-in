#!/usr/bin/env node
// Stores the notifications-worker URL and shared secret in the LOCAL database's Vault so pg_cron
// (and the urgent "kick") can call the worker. Reads NOTIFICATIONS_WORKER_SECRET from
// supabase/functions/.env (copy .env.example). Production: see supabase/functions/notifications-worker/README.md.
//
//   node supabase/scripts/configure-worker.mjs
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const envFile = new URL('../functions/.env', import.meta.url);
const env = Object.fromEntries(
  readFileSync(envFile, 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
);
const secret = env.NOTIFICATIONS_WORKER_SECRET;
if (!secret) throw new Error('NOTIFICATIONS_WORKER_SECRET missing in supabase/functions/.env');
// From inside the database container the API gateway is reachable as "kong".
const url = process.env.WORKER_URL ?? 'http://kong:8000/functions/v1/notifications-worker';

const sql = postgres(process.env.DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1 });
for (const [name, value] of [
  ['notifications_worker_url', url],
  ['notifications_worker_secret', secret],
]) {
  const [existing] = await sql`select id from vault.secrets where name = ${name}`;
  if (existing) await sql`select vault.update_secret(${existing.id}, ${value})`;
  else await sql`select vault.create_secret(${value}, ${name})`;
}
console.log(`Vault configured: worker at ${url}`);
await sql.end();
