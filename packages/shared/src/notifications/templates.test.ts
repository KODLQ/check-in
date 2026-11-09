import { describe, expect, it } from 'vitest';

import { translations } from '../i18n/index';
import { NOTIFICATION_KIND_NAMES, NOTIFICATION_KINDS, type NotificationKind } from './kinds.ts';
import { renderEmail, renderPush, TEMPLATES, type EmailContext } from './templates.ts';

const LOCALES = ['en', 'sv'] as const;

const ctx: EmailContext = {
  event: {
    title: 'Fredagshäng',
    starts_at: '2026-12-11T18:00:00Z', // 19:00 Stockholm
    ends_at: null,
    time_zone: 'Europe/Stockholm',
    location_text: 'Hornsgatan 12',
  },
  hostName: 'Demo Host',
  payload: { changed: ['time', 'location'] },
  announcement: { body: 'Doors open 19:30, ring Andersson' },
  replies: [
    { display_name: 'Alva', status: 'going' },
    { display_name: 'Elias', status: 'maybe' },
    { display_name: 'Maja', status: 'declined' },
    { display_name: 'Noah', status: 'going' },
    { display_name: 'Saga', status: 'going' },
  ],
  inviteUrl: 'https://checkin.example/i/DemoFredag01',
  unsubscribeUrl: 'https://checkin.example/u/tok123',
  oneClickUrl: 'https://checkin.example/api/unsubscribe/tok123',
};

describe('notification templates', () => {
  it.each(NOTIFICATION_KIND_NAMES.flatMap((k) => LOCALES.map((l) => [k, l] as const)))(
    '%s in %s has strings for every locale',
    (kind, locale) => {
      const strings = (translations[locale] as { notifications: Record<string, unknown> }).notifications;
      expect(strings[kind], `notifications.${kind} missing in ${locale}.json`).toBeTypeOf('object');
    },
  );

  it.each(NOTIFICATION_KIND_NAMES)('%s has a template for each of its channels', (kind) => {
    for (const channel of NOTIFICATION_KINDS[kind].channels) {
      expect(TEMPLATES[kind][channel], `${kind} lacks a ${channel} template`).toBeTypeOf('function');
    }
  });

  for (const kind of NOTIFICATION_KIND_NAMES) {
    for (const locale of LOCALES) {
      const channels = NOTIFICATION_KINDS[kind].channels as readonly string[];
      if (channels.includes('push')) {
        it(`push ${kind} ${locale}`, () => {
          expect(renderPush(kind, locale, { ...ctx, urlPath: '/i/DemoFredag01' })).toMatchSnapshot();
        });
      }
      if (channels.includes('email')) {
        it(`email ${kind} ${locale}`, () => {
          const m = renderEmail(kind, locale, ctx);
          expect({ subject: m.subject, text: m.text, headers: m.headers }).toMatchSnapshot();
        });
      }
    }
  }

  it('renders Swedish email with Stockholm time', () => {
    const m = renderEmail('event_reminder', 'sv', ctx);
    expect(m.subject).toBe('Påminnelse: Fredagshäng');
    expect(m.text).toContain('19:00');
  });

  it('falls back to English for unknown locales', () => {
    expect(renderPush('event_cancelled', 'de', ctx).title).toBe('Fredagshäng is cancelled');
  });

  it('names a guest who joined the waitlist in the host digest', () => {
    const replies = [{ display_name: 'Ida', status: 'waitlisted' as const }];
    expect(renderPush('rsvp_digest', 'en', { ...ctx, replies }).body).toBe('Ida: Waitlist');
    expect(renderPush('rsvp_digest', 'sv', { ...ctx, replies }).body).toBe('Ida: Väntelista');
  });

  it('tells a promoted guest they got a spot', () => {
    expect(renderPush('waitlist_promoted', 'en', ctx).title).toBe('You got a spot at Fredagshäng');
    expect(renderEmail('waitlist_promoted', 'sv', ctx).subject).toBe('Du fick en plats: Fredagshäng');
  });

  it('tells a voter the date is set (add-date-polls)', () => {
    const m = renderPush('date_picked', 'en', { ...ctx, urlPath: '/i/DemoFredag01' });
    expect(m.title).toBe('Date set: Fredagshäng');
    expect(m.body).toMatch(/Open the invite to see your answer\.$/);
    expect(m.data).toEqual({ kind: 'date_picked', url: '/i/DemoFredag01' });
    expect(renderPush('date_picked', 'sv', ctx).title).toBe('Datum klart: Fredagshäng');
  });

  it('says "Date TBD" instead of a time while a poll is open', () => {
    const pending = { ...ctx, event: { ...ctx.event, starts_at: null, ends_at: null } };
    expect(renderEmail('event_cancelled', 'en', pending).text).toContain('planned for Date TBD');
  });

  it('puts the deep link in push data', () => {
    expect(renderPush('rsvp_digest', 'en', { ...ctx, urlPath: '/events/abc' }).data).toEqual({
      kind: 'rsvp_digest',
      url: '/events/abc',
    });
  });

  it('shortens long announcements in push but not in email', () => {
    const long = { ...ctx, announcement: { body: 'x'.repeat(500) } };
    expect(renderPush('announcement', 'en', long).body.length).toBeLessThanOrEqual(140);
    expect(renderEmail('announcement', 'en', long).text).toContain('x'.repeat(500));
  });

  it('summarises a single reply and a burst of replies', () => {
    expect(renderPush('rsvp_digest', 'en', { ...ctx, replies: ctx.replies!.slice(0, 1) }).body).toBe('Alva: Going');
    expect(renderPush('rsvp_digest', 'en', ctx).body).toBe(
      '5 new replies: Alva (Going), Elias (Maybe), Maja (Can\'t go) +2 more',
    );
  });

  it('mentions only what changed', () => {
    const m = renderPush('event_changed', 'en', { ...ctx, payload: { changed: ['location'] } });
    expect(m.body).toBe('New place: Hornsgatan 12');
  });
});

describe('email layout', () => {
  const emailKinds = NOTIFICATION_KIND_NAMES.filter((k) =>
    (NOTIFICATION_KINDS[k].channels as readonly string[]).includes('email'),
  ) as NotificationKind[];

  it.each(emailKinds)('%s contains the unsubscribe link and one-click headers', (kind) => {
    for (const locale of LOCALES) {
      const m = renderEmail(kind, locale, ctx);
      expect(m.text).toContain(ctx.unsubscribeUrl);
      expect(m.html).toContain(`href="${ctx.unsubscribeUrl}"`);
      expect(m.headers['List-Unsubscribe']).toBe(`<${ctx.oneClickUrl}>`);
      expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(m.html).not.toMatch(/<img/i);
    }
  });

  it('adds a mailto target when configured', () => {
    const m = renderEmail('announcement', 'en', { ...ctx, unsubscribeMailto: 'mailto:unsubscribe@checkin.example' });
    expect(m.headers['List-Unsubscribe']).toBe(
      `<${ctx.oneClickUrl}>, <mailto:unsubscribe@checkin.example>`,
    );
  });

  it('HTML-escapes the announcement body', () => {
    const m = renderEmail('announcement', 'en', {
      ...ctx,
      announcement: { body: '<script>alert("x")</script> & <b>bold</b>' },
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>bold');
    expect(m.html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;');
  });
});
