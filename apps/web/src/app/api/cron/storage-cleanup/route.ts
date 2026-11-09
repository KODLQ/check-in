import { timingSafeEqual } from 'node:crypto';

import { env } from '@/lib/env';
import { runStorageCleanup } from '@/lib/wall/handlers';
import { wallDb } from '@/lib/wall/deps';

// Vercel Cron (vercel.json, every 10 minutes): deletes Storage objects queued by the database (deleted
// posts/events/accounts, expired uploads) and orphaned wall objects. Postgres can't delete Storage objects.
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response('Unauthorized', { status: 401 });
  return Response.json(await runStorageCleanup(wallDb()), { headers: { 'Cache-Control': 'no-store' } });
}
