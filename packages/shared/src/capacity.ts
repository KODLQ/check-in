import type { RsvpState } from './schemas';

/** The fields of a response that capacity looks at. */
export interface HeadCountable {
  status: RsvpState | string;
  plus_ones?: number | null;
}

/** Heads of one response: the guest plus their plus-ones. */
export function headsOf(r: HeadCountable): number {
  return 1 + Math.max(0, r.plus_ones ?? 0);
}

/**
 * Heads with the given status (default Going) - mirrors public.event_going_heads():
 * each Going guest counts as 1 + plus-ones; Maybe, Can't go and waitlisted never count.
 */
export function headCount(rsvps: readonly HeadCountable[], status: RsvpState = 'going'): number {
  return rsvps.reduce((n, r) => (r.status === status ? n + headsOf(r) : n), 0);
}

/** "14 / 30" when the event has a capacity, otherwise "14". */
export function formatHeads(heads: number, capacity: number | null | undefined): string {
  return capacity == null ? String(heads) : `${heads} / ${capacity}`;
}

/** Free spots, or null without a capacity. Never negative (capacity can be lowered below Going). */
export function spotsLeft(heads: number, capacity: number | null | undefined): number | null {
  return capacity == null ? null : Math.max(capacity - heads, 0);
}

/** Orders waitlisted responses like the database: by waitlisted_at, then id. */
export function sortWaitlist<T extends { id: string; waitlisted_at?: string | null }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const t = (a.waitlisted_at ?? '').localeCompare(b.waitlisted_at ?? '');
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}
