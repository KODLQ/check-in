import { hasEventEnded } from './dates';
import type { RsvpState } from './schemas';

/** Minimal timing fields shared by hosted events and invites. */
export interface EventTiming {
  id: string;
  starts_at: string;
  ends_at: string | null;
}

/** One item of `list_my_invites()` (an event the user answered through their account). */
export interface MyInvite extends EventTiming {
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
  /** Not yet ended, soonest first. Cancelled events stay here (flagged) until their time has passed. */
  upcoming: HomeItem<H, I>[];
  /** Ended, most recent first. */
  past: HomeItem<H, I>[];
}

const startMs = (i: { event: EventTiming }) => new Date(i.event.starts_at).getTime();

/**
 * Merges hosted events and invites into the home list (spec: my-invites). An event that is both hosted
 * and invited appears once, as hosted.
 */
export function buildHomeSections<
  H extends EventTiming & { cancelled_at: string | null },
  I extends EventTiming & { state: MyInvite['state'] },
>(hosted: readonly H[], invites: readonly I[], now: Date = new Date()): HomeSections<H, I> {
  const ended = (e: EventTiming) =>
    hasEventEnded(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null, now);
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
    upcoming: items.filter((i) => !i.past).sort((a, b) => startMs(a) - startMs(b)),
    past: items.filter((i) => i.past).sort((a, b) => startMs(b) - startMs(a)),
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
