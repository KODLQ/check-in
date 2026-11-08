import { CLAIM_TICKET_PATTERN } from '@check-in/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from './supabase';

/** A claim ticket received through checkin://claim?t=…, waiting for the user to reach the app area. */
export const PENDING_CLAIM_KEY = 'ci_pending_claim';
/** Same lifetime as the ticket itself; older ones are dropped without calling the server. */
export const PENDING_CLAIM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

interface Stored {
  ticket: string;
  savedAt: number;
}

export type ClaimResult =
  | { kind: 'claimed'; count: number }
  | { kind: 'expired' }
  /** Network error, rate limit or not ready yet: the ticket is kept for the next attempt. */
  | { kind: 'retry' };

type Listener = () => void;
const savedListeners = new Set<Listener>();
const claimedListeners = new Set<Listener>();

/** Notified when a new ticket is saved (so a signed-in app redeems it straight away). */
export function onPendingClaimSaved(listener: Listener): () => void {
  savedListeners.add(listener);
  return () => savedListeners.delete(listener);
}

/** Notified after responses were linked to the account (so lists can refresh). */
export function onInvitesClaimed(listener: Listener): () => void {
  claimedListeners.add(listener);
  return () => claimedListeners.delete(listener);
}

export async function savePendingClaim(ticket: string, now = Date.now()): Promise<boolean> {
  if (!CLAIM_TICKET_PATTERN.test(ticket)) return false;
  await AsyncStorage.setItem(
    PENDING_CLAIM_KEY,
    JSON.stringify({ ticket, savedAt: now } satisfies Stored),
  );
  savedListeners.forEach((l) => l());
  return true;
}

export const clearPendingClaim = () => AsyncStorage.removeItem(PENDING_CLAIM_KEY);

/** The pending ticket, or null. Malformed and stale entries are removed. */
export async function readPendingClaim(now = Date.now()): Promise<string | null> {
  const raw = await AsyncStorage.getItem(PENDING_CLAIM_KEY);
  if (!raw) return null;
  try {
    const { ticket, savedAt } = JSON.parse(raw) as Stored;
    if (
      CLAIM_TICKET_PATTERN.test(ticket) &&
      now - savedAt < PENDING_CLAIM_MAX_AGE_MS &&
      savedAt <= now
    ) {
      return ticket;
    }
  } catch {
    // fall through
  }
  await clearPendingClaim();
  return null;
}

let inflight: Promise<ClaimResult | null> | null = null;

/** Redeems the pending ticket, if any. Concurrent calls share one request. */
export function redeemPendingClaim(now = Date.now()): Promise<ClaimResult | null> {
  inflight ??= (async () => {
    const ticket = await readPendingClaim(now);
    if (!ticket) return null;
    const { data, error } = await supabase.rpc('claim_guest_rsvps', { p_ticket: ticket });
    if (error) return { kind: 'retry' } as const;
    const result = data as { error?: string; claimed?: number; merged?: number } | null;
    await clearPendingClaim();
    if (result?.error === 'invalid_ticket') return { kind: 'expired' } as const;
    claimedListeners.forEach((l) => l());
    return { kind: 'claimed', count: (result?.claimed ?? 0) + (result?.merged ?? 0) } as const;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
