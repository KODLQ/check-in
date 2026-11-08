// notifications-worker: called every minute by pg_cron (and kicked immediately for urgent kinds) with
// the shared secret in `x-worker-secret`. verify_jwt is off; the secret is checked in constant time.
// See README.md in this folder for secrets and local setup.
import { createClient } from 'npm:@supabase/supabase-js@2';

import { emailTransportFromEnv } from '../_shared/email.ts';
import { expoPushClient } from '../_shared/push.ts';
import { runWorker, type DeliveryContext, type WorkerDb } from './worker.ts';

async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const secret = Deno.env.get('NOTIFICATIONS_WORKER_SECRET');
  if (!secret) return json({ error: 'not_configured' }, 500);
  if (!(await safeEqual(req.headers.get('x-worker-secret') ?? '', secret))) {
    return json({ error: 'unauthorized' }, 401);
  }

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data as T;
  };

  const db: WorkerDb = {
    fanOut: (limit) => rpc<number>('fan_out_due_notifications', { p_limit: limit }),
    claim: async (limit) => (await rpc<DeliveryContext[] | null>('claim_deliveries', { p_limit: limit })) ?? [],
    complete: async (id, outcome, providerId, error) => {
      await rpc('complete_delivery', { p_id: id, p_outcome: outcome, p_provider_id: providerId, p_error: error });
    },
    dueReceipts: async (limit) =>
      (await rpc<{ delivery_id: string; ticket_id: string }[] | null>('due_push_receipts', { p_limit: limit })) ?? [],
    recordReceipt: async (id, status, error) => {
      await rpc('record_push_receipt', { p_delivery_id: id, p_status: status, p_error: error });
    },
  };

  try {
    const stats = await runWorker({
      db,
      push: expoPushClient({ accessToken: Deno.env.get('EXPO_ACCESS_TOKEN') || undefined }),
      email: emailTransportFromEnv(Deno.env),
      config: {
        webBaseUrl: Deno.env.get('WEB_BASE_URL') ?? 'http://localhost:3000',
        emailFrom: Deno.env.get('EMAIL_FROM') ?? 'check-in <updates@checkin.test>',
        unsubscribeMailto: Deno.env.get('EMAIL_UNSUBSCRIBE_MAILTO') || null,
      },
      budgetMs: 50_000,
    });
    return json(stats);
  } catch (e) {
    console.error('notifications-worker failed', (e as Error).message);
    return json({ error: 'worker_failed' }, 500);
  }
});
