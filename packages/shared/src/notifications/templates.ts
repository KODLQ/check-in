/**
 * Notification copy for every kind x channel x locale. Pure functions with no Node/DOM APIs so the
 * notifications-worker Edge Function (Deno) can import this file directly (see supabase/functions/deno.json).
 * Relative imports therefore use explicit .ts extensions and JSON import attributes.
 */
import { formatTimeRange } from '../dates.ts';
import en from '../i18n/en.json' with { type: 'json' };
import sv from '../i18n/sv.json' with { type: 'json' };
import { renderEmailLayout, type EmailMessage } from './email.ts';
import { NOTIFICATION_KINDS, type NotificationKind } from './kinds.ts';

export type NotificationLocale = 'en' | 'sv';
const STRINGS = { en, sv } as const;

export interface NotificationEvent {
  title: string;
  /** Null while a date poll is open (add-date-polls). */
  starts_at: string | null;
  ends_at?: string | null;
  time_zone: string;
  location_text: string;
  place_name?: string | null;
}

export interface RenderContext {
  /** Null for group membership kinds (group_invited, group_joined, group_new_owner). */
  event: NotificationEvent | null;
  group?: { id: string; name: string } | null;
  /** The member who acted (e.g. who sent a group invitation). */
  actorName?: string | null;
  /** group_joined: everyone who joined within the digest window. */
  joinedNames?: string[] | null;
  hostName?: string | null;
  payload?: { changed?: string[] } & Record<string, unknown>;
  announcement?: { body: string | null } | null;
  replies?: { display_name: string; status: 'going' | 'maybe' | 'declined' | 'waitlisted' }[] | null;
}

export interface PushContext extends RenderContext {
  /** In-app path opened on tap: /events/<id> for managers, /i/<token> for guests. */
  urlPath?: string | null;
}

export interface EmailContext extends RenderContext {
  /** The event's current invite page (spec: links survive regenerating the invite link). */
  inviteUrl?: string | null;
  /** Confirmation page shown from the footer link (GET never unsubscribes). */
  unsubscribeUrl: string;
  /** RFC 8058 one-click target (POST). */
  oneClickUrl: string;
  unsubscribeMailto?: string | null;
}

export interface PushMessage {
  title: string;
  body: string;
  data: { url?: string; kind: NotificationKind };
}

/** Push bodies are shortened; email always carries the full text. */
export const PUSH_BODY_MAX = 140;

export function normalizeLocale(locale: string | null | undefined): NotificationLocale {
  return locale === 'sv' ? 'sv' : 'en';
}

export function translate(
  locale: NotificationLocale,
  key: string,
  vars: Record<string, string | number> = {},
): string {
  let node: unknown = STRINGS[locale];
  for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
  if (typeof node !== 'string') throw new Error(`Missing ${locale} string ${key}`);
  return node.replace(/{{(\w+)}}/g, (_, k: string) => String(vars[k] ?? ''));
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function when(ctx: RenderContext, locale: NotificationLocale): string {
  const e = ctx.event;
  if (!e) return '';
  if (!e.starts_at) return translate(locale, 'polls.date_tbd');
  return formatTimeRange(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null, locale, e.time_zone);
}

function where(ctx: RenderContext): string {
  return ctx.event?.location_text ?? '';
}

function vars(ctx: RenderContext, locale: NotificationLocale) {
  return {
    title: ctx.event?.title ?? '',
    host: ctx.hostName ?? '',
    group: ctx.group?.name ?? '',
    actor: ctx.actorName ?? '',
    when: when(ctx, locale),
    where: where(ctx),
  };
}

function changeLines(ctx: RenderContext, locale: NotificationLocale): string[] {
  const changed = ctx.payload?.changed ?? ['time', 'location'];
  const v = vars(ctx, locale);
  const lines: string[] = [];
  if (changed.includes('time')) lines.push(translate(locale, 'notifications.event_changed.time', v));
  if (changed.includes('location')) lines.push(translate(locale, 'notifications.event_changed.location', v));
  return lines;
}

function joinedBody(ctx: RenderContext, locale: NotificationLocale): string {
  const names = ctx.joinedNames ?? [];
  if (names.length <= 1) return translate(locale, 'notifications.group_joined.one', { name: names[0] ?? '' });
  const shown = names.slice(0, 3).join(', ');
  const rest = names.length - 3;
  return translate(locale, 'notifications.group_joined.many', {
    count: names.length,
    names: rest > 0 ? `${shown} ${translate(locale, 'notifications.rsvp_digest.more', { count: rest })}` : shown,
  });
}

function digestBody(ctx: RenderContext, locale: NotificationLocale): string {
  const replies = ctx.replies ?? [];
  const status = (s: string) => translate(locale, `rsvp.${s}`);
  if (replies.length === 1) {
    const r = replies[0]!;
    return translate(locale, 'notifications.rsvp_digest.one', { name: r.display_name, status: status(r.status) });
  }
  const shown = replies.slice(0, 3).map((r) => `${r.display_name} (${status(r.status)})`);
  const rest = replies.length - shown.length;
  const names = rest > 0
    ? `${shown.join(', ')} ${translate(locale, 'notifications.rsvp_digest.more', { count: rest })}`
    : shown.join(', ');
  return translate(locale, 'notifications.rsvp_digest.many', { count: replies.length, names });
}

interface KindTemplate {
  push?: (ctx: RenderContext, l: NotificationLocale) => { title: string; body: string };
  email?: (ctx: RenderContext, l: NotificationLocale) => { subject: string; paragraphs: string[] };
}

/** Every kind must have a template for each of its channels (checked by templates.test.ts). */
export const TEMPLATES: Record<NotificationKind, KindTemplate> = {
  rsvp_email_confirmation: {
    email: (ctx, l) => ({
      subject: translate(l, 'notifications.rsvp_email_confirmation.subject', vars(ctx, l)),
      paragraphs: [
        translate(l, 'notifications.rsvp_email_confirmation.intro', vars(ctx, l)),
        `${when(ctx, l)} · ${where(ctx)}`,
        translate(l, 'notifications.rsvp_email_confirmation.privacy'),
      ],
    }),
  },
  event_changed: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.event_changed.title', vars(ctx, l)),
      body: changeLines(ctx, l).join('\n'),
    }),
    email: (ctx, l) => ({
      subject: translate(l, 'notifications.event_changed.subject', vars(ctx, l)),
      paragraphs: changeLines(ctx, l),
    }),
  },
  event_cancelled: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.event_cancelled.title', vars(ctx, l)),
      body: translate(l, 'notifications.event_cancelled.body', vars(ctx, l)),
    }),
    email: (ctx, l) => ({
      subject: translate(l, 'notifications.event_cancelled.subject', vars(ctx, l)),
      paragraphs: [translate(l, 'notifications.event_cancelled.body', vars(ctx, l))],
    }),
  },
  event_reminder: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.event_reminder.title', vars(ctx, l)),
      body: translate(l, 'notifications.event_reminder.body', vars(ctx, l)),
    }),
    email: (ctx, l) => ({
      subject: translate(l, 'notifications.event_reminder.subject', vars(ctx, l)),
      paragraphs: [translate(l, 'notifications.event_reminder.body', vars(ctx, l))],
    }),
  },
  announcement: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.announcement.title', vars(ctx, l)),
      body: translate(l, 'notifications.announcement.body', {
        ...vars(ctx, l),
        text: ctx.announcement?.body ?? '',
      }),
    }),
    email: (ctx, l) => ({
      subject: translate(l, 'notifications.announcement.subject', vars(ctx, l)),
      paragraphs: [
        translate(l, 'notifications.announcement.body', { ...vars(ctx, l), text: ctx.announcement?.body ?? '' }),
      ],
    }),
  },
  rsvp_digest: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.rsvp_digest.title', vars(ctx, l)),
      body: digestBody(ctx, l),
    }),
  },
  waitlist_promoted: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.waitlist_promoted.title', vars(ctx, l)),
      body: translate(l, 'notifications.waitlist_promoted.body', vars(ctx, l)),
    }),
    email: (ctx, l) => ({
      subject: translate(l, 'notifications.waitlist_promoted.subject', vars(ctx, l)),
      paragraphs: [translate(l, 'notifications.waitlist_promoted.body', vars(ctx, l))],
    }),
  },
  date_picked: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.date_picked.title', vars(ctx, l)),
      body: translate(l, 'notifications.date_picked.body', vars(ctx, l)),
    }),
  },
  // add-event-wall: a count only. Never post text, photos or poster names (spec: notifications "Host wall digest").
  wall_digest: {
    push: (ctx, l) => {
      const ids = ctx.payload?.post_ids;
      const count = Array.isArray(ids) ? ids.length : 1;
      return {
        title: translate(l, 'notifications.wall_digest.title', vars(ctx, l)),
        body: count > 1
          ? translate(l, 'notifications.wall_digest.many', { count })
          : translate(l, 'notifications.wall_digest.one'),
      };
    },
  },
  group_invited: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.group_invited.title', vars(ctx, l)),
      body: translate(l, 'notifications.group_invited.body', vars(ctx, l)),
    }),
  },
  group_joined: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.group_joined.title', vars(ctx, l)),
      body: joinedBody(ctx, l),
    }),
  },
  group_new_owner: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.group_new_owner.title', vars(ctx, l)),
      body: translate(l, 'notifications.group_new_owner.body', vars(ctx, l)),
    }),
  },
  group_date_open: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.group_date_open.title', vars(ctx, l)),
      body: translate(l, 'notifications.group_date_open.body', vars(ctx, l)),
    }),
  },
  group_answer_reminder: {
    push: (ctx, l) => ({
      title: translate(l, 'notifications.group_answer_reminder.title', vars(ctx, l)),
      body: translate(l, 'notifications.group_answer_reminder.body', vars(ctx, l)),
    }),
  },
};

export function renderPush(kind: NotificationKind, locale: string | null | undefined, ctx: PushContext): PushMessage {
  const template = TEMPLATES[kind]?.push;
  if (!template) throw new Error(`No push template for ${kind}`);
  const l = normalizeLocale(locale);
  const { title, body } = template(ctx, l);
  return {
    title: truncate(title, 80),
    body: truncate(body, PUSH_BODY_MAX),
    data: { kind, ...(ctx.urlPath ? { url: ctx.urlPath } : {}) },
  };
}

export function renderEmail(kind: NotificationKind, locale: string | null | undefined, ctx: EmailContext): EmailMessage {
  const template = TEMPLATES[kind]?.email;
  if (!template) throw new Error(`No email template for ${kind}`);
  const l = normalizeLocale(locale);
  const { subject, paragraphs } = template(ctx, l);
  return renderEmailLayout({
    subject,
    heading: ctx.event?.title ?? '',
    paragraphs,
    cta: ctx.inviteUrl ? { label: translate(l, 'notifications.email.view_invite'), url: ctx.inviteUrl } : null,
    footer: translate(l, 'notifications.email.footer'),
    unsubscribeLabel: translate(l, 'notifications.email.unsubscribe'),
    unsubscribeUrl: ctx.unsubscribeUrl,
    oneClickUrl: ctx.oneClickUrl,
    unsubscribeMailto: ctx.unsubscribeMailto ?? null,
    lang: l,
  });
}

export function channelsFor(kind: NotificationKind) {
  return NOTIFICATION_KINDS[kind].channels;
}
