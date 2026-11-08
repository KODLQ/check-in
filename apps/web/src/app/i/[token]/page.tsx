import { formatEventTime, formatRelativeTime, formatTimeRange, getTheme, inviteUrl, mapsUrl } from '@check-in/shared';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { googleCalendarUrl } from '@/lib/calendar';
import { env } from '@/lib/env';
import { clientStrings, getLocale, makeT } from '@/lib/i18n';
import { getInvite, GUEST_COOKIE, hostedByLine } from '@/lib/invite';
import { avatarUrl, coverUrl } from '@/lib/supabase';
import { RsvpForm } from './rsvp-form';
import { ShareInvite } from './share-invite';

type Props = PageProps<'/i/[token]'>;

async function load(token: string) {
  const guestToken = (await cookies()).get(GUEST_COOKIE)?.value;
  return getInvite(token, guestToken);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const [invite, locale] = await Promise.all([getInvite(token), getLocale()]);
  const t = makeT(locale);
  // Private events must never be indexed.
  const robots = { index: false, follow: false };

  if (invite.state === 'not_found') return { title: t('invite.not_found_title'), robots };
  if (invite.state === 'cancelled') return { title: invite.event.title, description: t('invite.cancelled_body'), robots };

  const e = invite.event;
  const when = formatEventTime(new Date(e.starts_at), locale, e.time_zone);
  // Deliberately excludes the address and the guest list (spec: rich link previews).
  const description = `${when} · ${hostedByLine(invite, locale, t)}`;
  return {
    title: e.title,
    description,
    robots,
    openGraph: { title: e.title, description, type: 'website', siteName: 'check-in', url: inviteUrl(env.siteUrl, token) },
    twitter: { card: 'summary_large_image', title: e.title, description },
  };
}

function NotFound({ title, body }: { title: string; body: string }) {
  return (
    <main className="page center">
      <h1>{title}</h1>
      <p className="muted">{body}</p>
    </main>
  );
}

export default async function InvitePage({ params }: Props) {
  const { token } = await params;
  const [invite, locale] = await Promise.all([load(token), getLocale()]);
  const t = makeT(locale);

  if (invite.state === 'not_found') {
    return <NotFound title={t('invite.not_found_title')} body={t('invite.not_found_body')} />;
  }
  if (invite.state === 'cancelled') {
    return <NotFound title={invite.event.title} body={t('invite.cancelled_body')} />;
  }

  const e = invite.event;
  const start = new Date(e.starts_at);
  const end = e.ends_at ? new Date(e.ends_at) : null;
  const theme = getTheme(e.theme);
  const cover = coverUrl(e.cover_path);
  const avatar = avatarUrl(invite.host.avatar_path);
  const url = inviteUrl(env.siteUrl, token);
  const cal = { uid: token, title: e.title, description: e.description, location: e.location_text, start, end, url };
  const going = invite.counts.going;

  return (
    <main className="page">
      <div
        className="cover"
        style={{ background: `linear-gradient(135deg, ${theme.colors[0]}, ${theme.colors[1]})` }}
      >
        {cover ? <img src={cover} alt="" /> : null}
      </div>

      <h1>{e.title}</h1>
      <div className="host">
        {avatar ? <img className="avatar" src={avatar} alt="" /> : null}
        <span className="muted" data-testid="hosted-by">{hostedByLine(invite, locale, t)}</span>
      </div>

      <div className="meta">
        <div>
          🗓 {formatTimeRange(start, end, locale, e.time_zone)}
          {e.time_changed_at ? <span className="badge"> · {t('invite.time_updated')}</span> : null}
        </div>
        <div>
          📍{' '}
          <a href={mapsUrl({ latitude: e.latitude, longitude: e.longitude, query: e.location_text })} target="_blank" rel="noreferrer">
            {e.location_text}
          </a>
        </div>
      </div>

      {e.description ? <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{e.description}</p> : null}

      {invite.announcements?.length ? (
        <section className="card" aria-label={t('announcements.title')} data-testid="announcements">
          <strong>{t('announcements.title')}</strong>
          <ul className="announcements">
            {invite.announcements.map((a) => (
              <li key={a.id}>
                <p>{a.body}</p>
                <time dateTime={a.created_at} title={formatEventTime(new Date(a.created_at), locale, e.time_zone)}>
                  {formatRelativeTime(new Date(a.created_at), locale)}
                </time>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {invite.state === 'past' ? (
        <p className="card muted" data-testid="past">{t('invite.past_body')}</p>
      ) : (
        <RsvpForm
          token={token}
          current={invite.my_rsvp}
          strings={clientStrings(t)}
          locale={locale}
          emailUpdates={env.emailUpdatesEnabled}
        />
      )}

      <section className="card" aria-label={t('rsvp.guests')}>
        <strong data-testid="going-count">
          {going === 1 ? t('rsvp.people_going_one') : t('rsvp.people_going', { count: going })}
        </strong>
        {invite.guests && invite.guests.length > 0 ? (
          <ul className="guests" data-testid="guest-list">
            {invite.guests.map((g, i) => (
              <li key={i}>
                {g.display_name}
                {g.status === 'maybe' ? <span className="muted"> · {t('rsvp.maybe')}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {invite.state === 'active' ? (
        <ShareInvite
          token={token}
          url={url}
          strings={{
            share: t('story.share'),
            saveImage: t('story.save_image'),
            copyLink: t('story.copy_link'),
            copied: t('story.copied'),
            shareText: t('story.share_text', { title: e.title }),
          }}
        />
      ) : null}

      {invite.state === 'active' ? (
        <div className="actions">
          <a href={`/i/${token}/calendar.ics`} data-testid="ics">{t('invite.add_to_calendar')} (Apple/Outlook)</a>
          <a href={googleCalendarUrl(cal)} target="_blank" rel="noreferrer">Google Calendar</a>
        </div>
      ) : null}
    </main>
  );
}
