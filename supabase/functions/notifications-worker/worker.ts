// Orchestration for the notifications worker (design §6). Stateless and thin: Postgres decides who gets
// what and when; this module renders with the shared templates, sends, and reports back.
import {
  isNotificationKind,
  renderEmail,
  renderPush,
  type NotificationKind,
} from '@check-in/shared/notifications';

import type { EmailTransport } from '../_shared/email.ts';
import type { ExpoMessage, PushClient } from '../_shared/push.ts';

/** One row returned by public.claim_deliveries. */
export interface DeliveryContext {
  delivery_id: string;
  notification_id: string;
  channel: 'push' | 'email';
  kind: string;
  attempts: number;
  locale: string;
  to: string;
  unsubscribe_token: string | null;
  invite_token: string | null;
  url_path: string | null;
  event: {
    id: string;
    title: string;
    starts_at: string;
    ends_at: string | null;
    time_zone: string;
    location_text: string;
    place_name: string | null;
  } | null;
  host_name: string | null;
  payload: Record<string, unknown> & { changed?: string[] };
  announcement: { body: string | null } | null;
  replies: { display_name: string; status: 'going' | 'maybe' | 'declined' }[] | null;
}

export type Outcome = 'sent' | 'temporary' | 'permanent';

export interface WorkerDb {
  fanOut(limit: number): Promise<number>;
  claim(limit: number): Promise<DeliveryContext[]>;
  complete(id: string, outcome: Outcome, providerId?: string | null, error?: string | null): Promise<void>;
  dueReceipts(limit: number): Promise<{ delivery_id: string; ticket_id: string }[]>;
  recordReceipt(id: string, status: 'ok' | 'error', error?: string | null): Promise<void>;
}

export interface WorkerConfig {
  /** Public web origin hosting /i/<token>, /u/<token> and /api/unsubscribe/<token>. */
  webBaseUrl: string;
  emailFrom: string;
  unsubscribeMailto?: string | null;
}

export interface WorkerDeps {
  db: WorkerDb;
  push: PushClient;
  email: EmailTransport;
  config: WorkerConfig;
  budgetMs?: number;
  now?: () => number;
  emailConcurrency?: number;
}

export interface WorkerStats {
  fannedOut: number;
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
  receipts: number;
}

const base = (url: string) => url.replace(/\/$/, '');

export function emailUrls(ctx: DeliveryContext, config: WorkerConfig) {
  const web = base(config.webBaseUrl);
  return {
    inviteUrl: ctx.invite_token ? `${web}/i/${ctx.invite_token}` : null,
    unsubscribeUrl: `${web}/u/${ctx.unsubscribe_token}`,
    oneClickUrl: `${web}/api/unsubscribe/${ctx.unsubscribe_token}`,
  };
}

function renderCtx(ctx: DeliveryContext) {
  if (!ctx.event) throw new Error('missing_event');
  return {
    event: ctx.event,
    hostName: ctx.host_name,
    payload: ctx.payload,
    announcement: ctx.announcement,
    replies: ctx.replies,
  };
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]!);
  });
  await Promise.all(workers);
}

export async function runWorker(deps: WorkerDeps): Promise<WorkerStats> {
  const now = deps.now ?? Date.now;
  const deadline = now() + (deps.budgetMs ?? 50_000);
  const stats: WorkerStats = { fannedOut: 0, claimed: 0, sent: 0, retry: 0, failed: 0, receipts: 0 };

  const complete = async (id: string, outcome: Outcome, providerId?: string | null, error?: string | null) => {
    await deps.db.complete(id, outcome, providerId ?? null, error ?? null);
    if (outcome === 'sent') stats.sent++;
    else if (outcome === 'temporary') stats.retry++;
    else stats.failed++;
  };

  for (let round = 0; round < 50 && now() < deadline; round++) {
    const fanned = await deps.db.fanOut(200);
    const batch = await deps.db.claim(100);
    stats.fannedOut += fanned;
    stats.claimed += batch.length;
    if (batch.length === 0 && fanned === 0) break;

    // Push: render, then one Expo request per 100 messages.
    const pushes: { ctx: DeliveryContext; message: ExpoMessage }[] = [];
    const emails: DeliveryContext[] = [];
    for (const ctx of batch) {
      if (!isNotificationKind(ctx.kind)) {
        await complete(ctx.delivery_id, 'permanent', null, 'unknown_kind');
        continue;
      }
      if (ctx.channel === 'email') {
        emails.push(ctx);
        continue;
      }
      try {
        const m = renderPush(ctx.kind as NotificationKind, ctx.locale, { ...renderCtx(ctx), urlPath: ctx.url_path });
        pushes.push({ ctx, message: { to: ctx.to, title: m.title, body: m.body, data: m.data, sound: 'default' } });
      } catch {
        await complete(ctx.delivery_id, 'permanent', null, 'render_error');
      }
    }

    if (pushes.length > 0) {
      let results;
      try {
        results = await deps.push.send(pushes.map((p) => p.message));
      } catch {
        results = null;
      }
      for (const [i, p] of pushes.entries()) {
        const r = results?.[i];
        if (!r) await complete(p.ctx.delivery_id, 'temporary', null, 'push_network_error');
        else if (r.ok) await complete(p.ctx.delivery_id, 'sent', r.ticketId);
        else await complete(p.ctx.delivery_id, r.temporary ? 'temporary' : 'permanent', null, r.error);
      }
    }

    await pool(emails, deps.emailConcurrency ?? 5, async (ctx) => {
      let message;
      try {
        message = renderEmail(ctx.kind as NotificationKind, ctx.locale, {
          ...renderCtx(ctx),
          ...emailUrls(ctx, deps.config),
          unsubscribeMailto: deps.config.unsubscribeMailto ?? null,
        });
      } catch {
        await complete(ctx.delivery_id, 'permanent', null, 'render_error');
        return;
      }
      try {
        const r = await deps.email.send({
          from: deps.config.emailFrom,
          to: ctx.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: message.headers,
          idempotencyKey: ctx.delivery_id,
        });
        if (r.ok) await complete(ctx.delivery_id, 'sent', r.id);
        else await complete(ctx.delivery_id, r.temporary ? 'temporary' : 'permanent', null, r.error);
      } catch {
        // Safe to retry: the provider idempotency key is the delivery id.
        await complete(ctx.delivery_id, 'temporary', null, 'email_network_error');
      }
    });
  }

  // Expo receipts (~15 minutes after sending): drop devices that are no longer registered.
  if (now() < deadline) {
    const due = await deps.db.dueReceipts(300);
    if (due.length > 0) {
      const receipts = await deps.push.receipts(due.map((d) => d.ticket_id));
      for (const d of due) {
        const r = receipts.get(d.ticket_id);
        if (!r) continue;
        await deps.db.recordReceipt(d.delivery_id, r.ok ? 'ok' : 'error', r.error ?? null);
        stats.receipts++;
      }
    }
  }
  return stats;
}
