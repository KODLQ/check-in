export const DEFAULT_TIME_ZONE = 'Europe/Stockholm';
/** Events without an end time are considered over this long after they start. */
export const DEFAULT_EVENT_DURATION_MS = 12 * 60 * 60 * 1000;

export function eventEndsAt(startsAt: Date, endsAt?: Date | null): Date {
  return endsAt ?? new Date(startsAt.getTime() + DEFAULT_EVENT_DURATION_MS);
}

/** A date-pending event (null start) never ends (mirrors public.event_ended_at()). */
export function hasEventEnded(startsAt: Date | null, endsAt?: Date | null, now = new Date()): boolean {
  if (!startsAt) return false;
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

/** A date-poll option, e.g. "Fri 12 Dec, 19:00 – 23:00" (Europe/Stockholm by default). */
export function formatOption(
  option: { starts_at: string | Date; ends_at?: string | Date | null },
  locale: string,
  timeZone: string = DEFAULT_TIME_ZONE,
): string {
  const start = new Date(option.starts_at);
  const end = option.ends_at ? new Date(option.ends_at) : null;
  return formatTimeRange(start, end, locale, timeZone);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "5 minutes ago" / "för 5 minuter sedan"; under a minute is "now" / "nu". */
export function formatRelativeTime(date: Date, locale: string, now: Date = new Date()): string {
  if (typeof Intl.RelativeTimeFormat !== 'function') return relativeFallback(date, locale, now);
  const fmt = new Intl.RelativeTimeFormat(locale === 'sv' ? 'sv' : 'en', { numeric: 'auto' });
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return fmt.format(Math.trunc(seconds / size), unit);
  }
  return fmt.format(0, 'second');
}

/** For runtimes without Intl.RelativeTimeFormat (Hermes): minutes/hours/yesterday, then the date. */
function relativeFallback(date: Date, locale: string, now: Date): string {
  const sv = locale === 'sv';
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return sv ? 'nu' : 'now';
  if (minutes < 60) return sv ? `för ${minutes} min sedan` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return sv ? `för ${hours} tim sedan` : `${hours} h ago`;
  if (hours < 48) return sv ? 'i går' : 'yesterday';
  return formatEventTime(date, locale);
}
