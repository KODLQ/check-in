import { hasEventEnded } from './dates';
import type { RsvpState } from './schemas';

/** Minimal timing fields shared by hosted events and invites. `starts_at` is null while a date poll is open. */
export interface EventTiming {
  id: string;
  starts_at: string | null;
  ends_at: string | null;
}

/** One item of `list_my_invites()` (an event the user answered through their account). */
export interface MyInvite extends EventTiming {
  /** Invites always have a date: RSVPs are only possible once a poll's date is picked. */
  starts_at: string;
  title: string;
  time_zone: string;
  cover_path: string | null;
  theme: string;
  state: 'active' | 'past' | 'cancelled';
  host: { display_name: string | null };
  my_rsvp: { status: RsvpState; display_name: string; plus_ones?: number };
}

export type HomeItem<H, I> =
  | { kind: 'hosted'; id: string; event: H; past: boolean; cancelled: boolean }
  | { kind: 'invite'; id: string; event: I; past: boolean; cancelled: boolean };

export interface HomeSections<H, I> {
  /**
   * Not yet ended: date-pending events first (add-date-polls), then soonest first. Cancelled events stay
   * here (flagged) until their time has passed.
   */
  upcoming: HomeItem<H, I>[];
  /** Ended, most recent first. */
  past: HomeItem<H, I>[];
}

/** Ascending by start; a pending event (null start) sorts before every date. */
const byStart = (a: { event: EventTiming }, b: { event: EventTiming }) => {
  if (a.event.starts_at === null || b.event.starts_at === null) {
    return (a.event.starts_at === null ? 0 : 1) - (b.event.starts_at === null ? 0 : 1);
  }
  return new Date(a.event.starts_at).getTime() - new Date(b.event.starts_at).getTime();
};

/**
 * Merges hosted events and invites into the home list (spec: my-invites). An event that is both hosted
 * and invited appears once, as hosted.
 */
export function buildHomeSections<
  H extends EventTiming & { cancelled_at: string | null },
  I extends EventTiming & { state: MyInvite['state'] },
>(hosted: readonly H[], invites: readonly I[], now: Date = new Date()): HomeSections<H, I> {
  const ended = (e: EventTiming) =>
    hasEventEnded(e.starts_at ? new Date(e.starts_at) : null, e.ends_at ? new Date(e.ends_at) : null, now);
  const hostedIds = new Set(hosted.map((e) => e.id));
  const items: HomeItem<H, I>[] = [
    ...hosted.map((event) => ({
      kind: 'hosted' as const,
      id: event.id,
      event,
      past: ended(event),
      cancelled: event.cancelled_at !== null,
    })),
    ...invites
      .filter((event) => !hostedIds.has(event.id))
      .map((event) => ({
        kind: 'invite' as const,
        id: event.id,
        event,
        past: ended(event),
        cancelled: event.state === 'cancelled',
      })),
  ];
  return {
    upcoming: items.filter((i) => !i.past).sort(byStart),
    // Pending events are never past, so only dated events land here.
    past: items.filter((i) => i.past).sort((a, b) => byStart(b, a)),
  };
}

/** Which create-your-own nudge the home screen shows. */
export function hostingNudge(sections: HomeSections<unknown, unknown>): 'empty' | 'card' | null {
  if (sections.upcoming.length === 0 && sections.past.length === 0) return 'empty';
  const upcoming = sections.upcoming.filter((i) => !i.cancelled);
  if (upcoming.some((i) => i.kind === 'invite') && !upcoming.some((i) => i.kind === 'hosted'))
    return 'card';
  return null;
}
