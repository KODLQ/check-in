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
  /** Null for an event that invites one of the user's groups and has not been answered yet. */
  my_rsvp: { status: RsvpState; display_name: string; plus_ones?: number } | null;
  /** add-groups-and-recurring-events */
  group?: { id: string; name: string } | null;
  series?: { id: string; frequency: 'weekly' | 'biweekly' | 'monthly'; anchor_local_date: string } | null;
}

/** For a series shown as one item: how many later upcoming dates are folded into it. */
export interface SeriesFold {
  id: string;
  laterCount: number;
  /** Later dates the user (as a guest) has not answered. */
  laterUnanswered: number;
}

export type HomeItem<H, I> =
  | { kind: 'hosted'; id: string; event: H; past: boolean; cancelled: boolean; series?: SeriesFold }
  | { kind: 'invite'; id: string; event: I; past: boolean; cancelled: boolean; series?: SeriesFold };

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
  H extends EventTiming & { cancelled_at: string | null; series_id?: string | null },
  I extends EventTiming & { state: MyInvite['state']; series?: { id: string } | null; my_rsvp?: unknown },
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
    upcoming: foldSeries(items.filter((i) => !i.past).sort(byStart)),
    // Pending events are never past, so only dated events land here.
    past: items.filter((i) => i.past).sort((a, b) => byStart(b, a)),
  };
}

function seriesIdOf(item: HomeItem<{ series_id?: string | null }, { series?: { id: string } | null }>): string | null {
  return item.kind === 'hosted' ? (item.event.series_id ?? null) : (item.event.series?.id ?? null);
}

/**
 * Upcoming dates of one series show as a single item (spec: private-events "Series in the host list",
 * my-invites "Series invites grouped in the list"): the next date that is not cancelled (or the next one
 * if all are), with how many later dates it stands for and how many of those are not answered yet.
 */
function foldSeries<
  T extends HomeItem<EventTiming & { series_id?: string | null }, EventTiming & { series?: { id: string } | null; my_rsvp?: unknown }>,
>(
  upcoming: T[],
): T[] {
  const bySeries = new Map<string, T[]>();
  for (const item of upcoming) {
    const sid = seriesIdOf(item);
    if (!sid) continue;
    const key = `${item.kind}:${sid}`;
    bySeries.set(key, [...(bySeries.get(key) ?? []), item]);
  }
  const shown = new Map<string, T>();
  for (const [key, dates] of bySeries) {
    const lead = dates.find((d) => !d.cancelled) ?? dates[0]!;
    const later = dates.filter((d) => d !== lead && byStart(d, lead) >= 0);
    shown.set(key, {
      ...lead,
      series: {
        id: key.slice(key.indexOf(':') + 1),
        laterCount: later.length,
        laterUnanswered: later.filter((d) => d.kind === 'invite' && !d.cancelled && d.event.my_rsvp == null).length,
      },
    });
  }
  return upcoming.flatMap((item) => {
    const sid = seriesIdOf(item);
    if (!sid) return [item];
    const lead = shown.get(`${item.kind}:${sid}`)!;
    return lead.id === item.id ? [lead] : [];
  });
}

/** Which create-your-own nudge the home screen shows. */
export function hostingNudge(sections: HomeSections<unknown, unknown>): 'empty' | 'card' | null {
  if (sections.upcoming.length === 0 && sections.past.length === 0) return 'empty';
  const upcoming = sections.upcoming.filter((i) => !i.cancelled);
  if (upcoming.some((i) => i.kind === 'invite') && !upcoming.some((i) => i.kind === 'hosted'))
    return 'card';
  return null;
}
