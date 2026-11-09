import {
  formatEventTime,
  formatOption,
  formatRelativeTime,
  formatTimeRange,
  getTheme,
  inviteUrl,
  mapsUrl,
  formatRepeatRule,
} from '@check-in/shared';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';

import { googleCalendarUrl } from '@/lib/calendar';
import { env } from '@/lib/env';
import { clientStrings, getLocale, makeT, pollStrings, wallStrings } from '@/lib/i18n';
import { getInvite, GUEST_COOKIE, hostedByLine } from '@/lib/invite';
import { avatarUrl, coverUrl } from '@/lib/supabase';
import { wallDb } from '@/lib/wall/deps';
import { loadFeed } from '@/lib/wall/handlers';
import { PollForm } from './poll-form';
import { RsvpForm } from './rsvp-form';
import { ShareInvite } from './share-invite';
import { Wall } from './wall';

type Props = PageProps<'/i/[token]'>;

async function load(token: string) {
  const guestToken = (await cookies()).get(GUEST_COOKIE)?.value;
  return getInvite(token, guestToken);
}

/**
 * First page of the event wall (add-event-wall), with photo URLs signed for at most an hour, so photos are
 * in the first HTML. Only for links get_invite accepted; never used by generateMetadata (no wall content in
 * link previews). Null when the wall is off for guests, the feature flag is off, or the link is unknown.
 */
async function loadWall(token: string) {
  if (!env.wallEnabled) return null;
  const guestToken = (await cookies()).get(GUEST_COOKIE)?.value ?? null;
  const feed = await loadFeed(wallDb(), { token, eventId: null, userId: null, guestToken });
  return feed.state === 'ok' ? feed : null;
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
  // A date poll shows "Date TBD — vote now" instead of a time, and never tallies or names.
  const when = e.starts_at ? formatEventTime(new Date(e.starts_at), locale, e.time_zone) : t('polls.date_tbd_vote');
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
  const wall = await loadWall(token);
  const wallSection = (timeZone: string) =>
    wall ? <Wall token={token} initial={wall} strings={wallStrings(t)} locale={locale} timeZone={timeZone} /> : null;

  if (invite.state === 'cancelled') {
    // The cancelled notice together with the existing wall, read-only (spec: event-wall "Posting window").
    if (!wall) return <NotFound title={invite.event.title} body={t('invite.cancelled_body')} />;
    return (
      <main className="page">
        <h1>{invite.event.title}</h1>
        <p className="card muted" data-testid="cancelled">{t('invite.cancelled_body')}</p>
        {wallSection('Europe/Stockholm')}
      </main>
    );
  }

  const e = invite.event;
  const theme = getTheme(e.theme);
  const cover = coverUrl(e.cover_path);
  const avatar = avatarUrl(invite.host.avatar_path);
  const url = inviteUrl(env.siteUrl, token);

  const share =
    invite.state === 'active' || invite.state === 'date_pending' ? (
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
    ) : null;

  const header = (
    <>
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
      {invite.series ? (
        <div className="series" data-testid="series-rule">
          <strong>{formatRepeatRule(invite.series.frequency, invite.series.anchor_local_date, locale)}</strong>
          {invite.series.next?.token ? (
            <>
              {' · '}
              <a href={`/i/${invite.series.next.token}`} data-testid="next-date">
                {t('series.next_date')}: {formatEventTime(new Date(invite.series.next.starts_at), locale, e.time_zone)}
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="meta">
        <div data-testid="when">
          🗓{' '}
          {e.starts_at
            ? formatTimeRange(new Date(e.starts_at), e.ends_at ? new Date(e.ends_at) : null, locale, e.time_zone)
            : t('polls.date_tbd')}
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
    </>
  );

  // Date poll (add-date-polls): the options with voting replace the date, RSVP, guest list and calendar.
  if (invite.state === 'date_pending') {
    const poll = invite.poll;
    const labels = Object.fromEntries(poll.options.map((o) => [o.id, formatOption(o, locale, e.time_zone)]));
    return (
      <main className="page">
        {header}
        <section className="card" aria-label={t('polls.title')}>
          <strong>{t('polls.title')}</strong>
          <p className="muted" style={{ margin: 0 }} data-testid="poll-status">
            {poll.expired
              ? t('polls.not_scheduled')
              : !poll.voting_open
                ? t('polls.voting_closed')
                : poll.closes_at
                  ? `${t('polls.intro')} ${t('polls.closes_at', { when: formatEventTime(new Date(poll.closes_at), locale, e.time_zone) })}`
                  : t('polls.intro')}
          </p>
        </section>
        <PollForm token={token} poll={poll} labels={labels} myVotes={invite.my_votes} strings={pollStrings(t)} />
        {poll.voting_open ? share : null}
        {wallSection(e.time_zone)}
      </main>
    );
  }

  const start = new Date(invite.event.starts_at);
  const end = e.ends_at ? new Date(e.ends_at) : null;
  const cal = { uid: token, title: e.title, description: e.description, location: e.location_text, start, end, url };
  const going = invite.counts.going;

  return (
    <main className="page">
      {header}

      {invite.state === 'past' ? (
        <p className="card muted" data-testid="past">{t('invite.past_body')}</p>
      ) : (
        <RsvpForm
          token={token}
          current={invite.my_rsvp}
          strings={clientStrings(t)}
          locale={locale}
          emailUpdates={env.emailUpdatesEnabled}
          plusOnes={e.allow_plus_ones ? { max: e.max_plus_ones } : null}
          full={invite.counts.full}
          wallPosts={wall?.has_own_posts ?? false}
        />
      )}

      <section className="card" aria-label={t('rsvp.guests')}>
        <strong data-testid="going-count">
          {going === 1 ? t('rsvp.people_going_one') : t('rsvp.people_going', { count: going })}
        </strong>
        {invite.counts.spots_left !== null || invite.counts.waitlist > 0 ? (
          <p className="muted" style={{ margin: 0 }} data-testid="capacity-line">
            {[
              invite.counts.full
                ? t('rsvp.full')
                : invite.counts.spots_left === 1
                  ? t('rsvp.spots_left_one')
                  : invite.counts.spots_left !== null
                    ? t('rsvp.spots_left', { count: invite.counts.spots_left })
                    : null,
              invite.counts.waitlist > 0 ? t('rsvp.waitlist_count', { count: invite.counts.waitlist }) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        ) : null}
        {invite.guests && invite.guests.length > 0 ? (
          <ul className="guests" data-testid="guest-list">
            {invite.guests.map((g, i) => (
              <li key={i}>
                {g.display_name}
                {g.status === 'going' && g.plus_ones > 0 ? <span className="badge"> +{g.plus_ones}</span> : null}
                {g.status === 'maybe' ? <span className="muted"> · {t('rsvp.maybe')}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {wallSection(e.time_zone)}

      {share}

      {invite.state === 'active' ? (
        <div className="actions">
          <a href={`/i/${token}/calendar.ics`} data-testid="ics">{t('invite.add_to_calendar')} (Apple/Outlook)</a>
          <a href={googleCalendarUrl(cal)} target="_blank" rel="noreferrer">Google Calendar</a>
        </div>
      ) : null}
    </main>
  );
}
