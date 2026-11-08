export const DEFAULT_TIME_ZONE = 'Europe/Stockholm';
/** Events without an end time are considered over this long after they start. */
export const DEFAULT_EVENT_DURATION_MS = 12 * 60 * 60 * 1000;

export function eventEndsAt(startsAt: Date, endsAt?: Date | null): Date {
  return endsAt ?? new Date(startsAt.getTime() + DEFAULT_EVENT_DURATION_MS);
}

export function hasEventEnded(startsAt: Date, endsAt?: Date | null, now = new Date()): boolean {
  return eventEndsAt(startsAt, endsAt).getTime() < now.getTime();
}

/** e.g. "Sat 14 Dec, 20:00" (en) / "lör 14 dec. 20:00" (sv) */
export function formatEventTime(
  date: Date,
  locale: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  return new Intl.DateTimeFormat(locale === 'sv' ? 'sv-SE' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(date);
}

export function formatTimeRange(
  startsAt: Date,
  endsAt: Date | null | undefined,
  locale: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const start = formatEventTime(startsAt, locale, timeZone);
  if (!endsAt) return start;
  const sameDay =
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(startsAt) ===
    new Intl.DateTimeFormat('en-CA', { timeZone, dateStyle: 'short' }).format(endsAt);
  const end = sameDay
    ? new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone }).format(
        endsAt,
      )
    : formatEventTime(endsAt, locale, timeZone);
  return `${start} – ${end}`;
}
