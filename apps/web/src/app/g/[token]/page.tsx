import type { Metadata } from 'next';

import { env } from '@/lib/env';
import { getGroupLinkPreview } from '@/lib/group-link';
import { getLocale, makeT } from '@/lib/i18n';

type Props = PageProps<'/g/[token]'>;

// A group link lets anyone with the app join: never index it, never leak it in a Referer.
const robots = { index: false, follow: false };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const [preview, locale] = await Promise.all([getGroupLinkPreview(token), getLocale()]);
  const t = makeT(locale);
  if (preview.state !== 'valid') return { title: t('groups.invalid_title'), robots, referrer: 'no-referrer' };
  const title = t('groups.join_title', { group: preview.name });
  return { title, robots, referrer: 'no-referrer', openGraph: { title, type: 'website', siteName: 'check-in' } };
}

/**
 * Landing page for group links opened in a browser (spec: groups "Join with the group link"). Joining
 * needs the app, so this page only offers it. Unknown and turned-off links render the same invalid page.
 */
export default async function GroupLanding({ params }: Props) {
  const { token } = await params;
  const [preview, locale] = await Promise.all([getGroupLinkPreview(token), getLocale()]);
  const t = makeT(locale);

  if (preview.state !== 'valid') {
    return (
      <main className="page center" data-testid="group-invalid">
        <h1>{t('groups.invalid_title')}</h1>
        <p className="muted">{t('groups.web_invalid_body')}</p>
      </main>
    );
  }

  // The universal link (this page's URL) opens the app directly when it is installed.
  const openUrl = `checkin://g/${encodeURIComponent(token)}`;
  return (
    <main className="page center" data-testid="group-landing">
      <h1>{t('groups.join_title', { group: preview.name })}</h1>
      <p className="muted" data-testid="group-summary">
        {t(preview.member_count === 1 ? 'groups.web_body_one' : 'groups.web_body', {
          owner: preview.owner_name ?? '',
          count: String(preview.member_count),
        })}
      </p>
      <a
        className="btn primary"
        href={openUrl}
        data-testid="open-app"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
      >
        {t('groups.web_open_app')}
      </a>
      <div className="store-links">
        <a className="btn" href={env.appStoreUrl} rel="noreferrer" data-testid="app-store">
          {t('get_app.app_store')}
        </a>
        <a className="btn" href={env.playStoreUrl} rel="noreferrer" data-testid="play-store">
          {t('get_app.play_store')}
        </a>
      </div>
    </main>
  );
}
