import type { Metadata } from 'next';

import { getCoHostPreview } from '@/lib/co-host';
import { env } from '@/lib/env';
import { getLocale, makeT } from '@/lib/i18n';

type Props = PageProps<'/c/[token]'>;

// A co-host link grants write access to an event: never index it, never leak it in a Referer.
const robots = { index: false, follow: false };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const [preview, locale] = await Promise.all([getCoHostPreview(token), getLocale()]);
  const t = makeT(locale);
  if (preview.state !== 'valid') return { title: t('co_hosts.invalid_title'), robots, referrer: 'no-referrer' };
  const title = t('co_hosts.web_title', { owner: preview.owner.display_name ?? '', title: preview.event.title });
  return { title, robots, referrer: 'no-referrer', openGraph: { title, type: 'website', siteName: 'check-in' } };
}

/**
 * Landing page for co-host links opened in a browser (spec: co-hosts / Link opened in a browser).
 * Offers the app only: accepting happens in the app. Shows the title and owner's name and nothing else;
 * unknown, expired, revoked, used, cancelled and ended links all render the same invalid page.
 */
export default async function CoHostLanding({ params }: Props) {
  const { token } = await params;
  const [preview, locale] = await Promise.all([getCoHostPreview(token), getLocale()]);
  const t = makeT(locale);

  if (preview.state !== 'valid') {
    return (
      <main className="page center" data-testid="co-host-invalid">
        <h1>{t('co_hosts.invalid_title')}</h1>
        <p className="muted">{t('co_hosts.web_invalid_body')}</p>
      </main>
    );
  }

  // A custom-scheme URL never reaches a server; the universal link (this page's URL) opens the app
  // directly when it is installed.
  const openUrl = `checkin://c/${encodeURIComponent(token)}`;
  return (
    <main className="page center" data-testid="co-host-landing">
      <h1>{t('co_hosts.web_title', { owner: preview.owner.display_name ?? '', title: preview.event.title })}</h1>
      <p className="muted">{t('co_hosts.web_body')}</p>
      <a
        className="btn primary"
        href={openUrl}
        data-testid="open-app"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textDecoration: 'none' }}
      >
        {t('co_hosts.web_open_app')}
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
