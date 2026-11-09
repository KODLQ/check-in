/**
 * Notification kinds registry, mirrored by the `public.notification_kinds` table.
 *
 * To add a kind (other changes):
 *  1. Insert it into `public.notification_kinds` in your own migration.
 *  2. Add it here, add `notifications.<kind>` strings to i18n/en.json and i18n/sv.json,
 *     and a template in templates.ts (Vitest fails if a template or locale string is missing).
 *  3. Add it to the expected list in supabase/tests/08_notifications_core.test.sql
 *     (pgTAP compares the DB registry to that list; kinds.test.ts compares that list to this one).
 */
export type NotificationChannel = 'push' | 'email';

export interface NotificationKindConfig {
  /** Bypasses quiet hours and per-recipient rate limits. */
  urgent: boolean;
  channels: readonly NotificationChannel[];
  /** Dropped instead of sent when the event has started by send time. */
  staleAfterStart: boolean;
}

export const NOTIFICATION_KINDS = {
  rsvp_email_confirmation: { urgent: true, channels: ['email'], staleAfterStart: false },
  event_changed: { urgent: false, channels: ['push', 'email'], staleAfterStart: false },
  event_cancelled: { urgent: true, channels: ['push', 'email'], staleAfterStart: false },
  event_reminder: { urgent: false, channels: ['push', 'email'], staleAfterStart: true },
  announcement: { urgent: false, channels: ['push', 'email'], staleAfterStart: true },
  rsvp_digest: { urgent: false, channels: ['push'], staleAfterStart: false },
  waitlist_promoted: { urgent: false, channels: ['push', 'email'], staleAfterStart: true },
  // add-date-polls: to signed-in voters when a poll's date is picked (web voters gave no email).
  date_picked: { urgent: false, channels: ['push'], staleAfterStart: true },
} as const satisfies Record<string, NotificationKindConfig>;

export type NotificationKind = keyof typeof NOTIFICATION_KINDS;

export const NOTIFICATION_KIND_NAMES = Object.keys(NOTIFICATION_KINDS) as NotificationKind[];

export function isNotificationKind(kind: string): kind is NotificationKind {
  return Object.prototype.hasOwnProperty.call(NOTIFICATION_KINDS, kind);
}
