// Expo Push Service client (design §6, §8). https://docs.expo.dev/push-notifications/sending-notifications/
import { classifyHttpStatus } from './email.ts';

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
}

export type PushResult =
  | { ok: true; ticketId: string | null }
  | { ok: false; temporary: boolean; error: string };

const BATCH = 100;
const RECEIPT_BATCH = 300;
/** Ticket/receipt errors worth retrying. Everything else is permanent. */
const TEMPORARY_ERRORS = new Set(['MessageRateExceeded']);

export interface PushClient {
  send(messages: ExpoMessage[]): Promise<PushResult[]>;
  receipts(ticketIds: string[]): Promise<Map<string, { ok: boolean; error?: string }>>;
}

export function expoPushClient(opts: { accessToken?: string; fetch?: typeof fetch; baseUrl?: string } = {}): PushClient {
  const doFetch = opts.fetch ?? fetch;
  const baseUrl = opts.baseUrl ?? 'https://exp.host/--/api/v2/push';
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(opts.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
  };

  return {
    async send(messages) {
      const results: PushResult[] = [];
      for (let i = 0; i < messages.length; i += BATCH) {
        const batch = messages.slice(i, i + BATCH);
        const res = await doFetch(`${baseUrl}/send`, { method: 'POST', headers, body: JSON.stringify(batch) });
        const kind = classifyHttpStatus(res.status);
        if (kind !== 'ok') {
          // Whole request rejected: nothing was accepted, so retrying cannot duplicate.
          for (const _ of batch) results.push({ ok: false, temporary: kind === 'temporary', error: `expo_${res.status}` });
          continue;
        }
        const body = (await res.json()) as {
          data?: { status: 'ok' | 'error'; id?: string; message?: string; details?: { error?: string } }[];
        };
        batch.forEach((_, j) => {
          const ticket = body.data?.[j];
          if (ticket?.status === 'ok') results.push({ ok: true, ticketId: ticket.id ?? null });
          else {
            const error = ticket?.details?.error ?? 'expo_ticket_error';
            results.push({ ok: false, temporary: TEMPORARY_ERRORS.has(error), error });
          }
        });
      }
      return results;
    },

    async receipts(ticketIds) {
      const out = new Map<string, { ok: boolean; error?: string }>();
      for (let i = 0; i < ticketIds.length; i += RECEIPT_BATCH) {
        const ids = ticketIds.slice(i, i + RECEIPT_BATCH);
        const res = await doFetch(`${baseUrl}/getReceipts`, { method: 'POST', headers, body: JSON.stringify({ ids }) });
        if (!res.ok) continue; // try again next run
        const body = (await res.json()) as {
          data?: Record<string, { status: 'ok' | 'error'; details?: { error?: string } }>;
        };
        for (const [id, r] of Object.entries(body.data ?? {})) {
          out.set(id, r.status === 'ok' ? { ok: true } : { ok: false, error: r.details?.error ?? 'receipt_error' });
        }
      }
      return out;
    },
  };
}
