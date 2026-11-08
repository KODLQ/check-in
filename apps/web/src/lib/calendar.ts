import { eventEndsAt } from '@check-in/shared';

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

export interface CalendarEvent {
  uid: string;
  title: string;
  description?: string | null;
  location: string;
  start: Date;
  end?: Date | null;
  url: string;
}

/** RFC 5545 calendar file. Times are UTC so every calendar app converts correctly. */
export function toIcs(e: CalendarEvent, now = new Date()): string {
  const end = eventEndsAt(e.start, e.end ?? null);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//check-in//invite//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${e.uid}@check-in`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(e.start)}`,
    `DTEND:${icsDate(e.end ?? new Date(Math.min(end.getTime(), e.start.getTime() + 3 * 3600_000)))}`,
    `SUMMARY:${escape(e.title)}`,
    `LOCATION:${escape(e.location)}`,
    `DESCRIPTION:${escape([e.description, e.url].filter(Boolean).join('\n\n'))}`,
    `URL:${e.url}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function googleCalendarUrl(e: CalendarEvent): string {
  const end = e.end ?? new Date(e.start.getTime() + 3 * 3600_000);
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: e.title,
    dates: `${icsDate(e.start)}/${icsDate(end)}`,
    location: e.location,
    details: [e.description, e.url].filter(Boolean).join('\n\n'),
  });
  return `https://calendar.google.com/calendar/render?${p}`;
}
