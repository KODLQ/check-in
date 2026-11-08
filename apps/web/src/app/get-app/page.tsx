import type { Metadata } from 'next';

import { env } from '@/lib/env';
import { getLocale, makeT } from '@/lib/i18n';
import { GetApp } from './get-app';

export async function generateMetadata(): Promise<Metadata> {
  const t = makeT(await getLocale());
  // The page URL carries a claim ticket in its fragment: never index it, never send a Referer.
  return {
    title: t('get_app.title'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function GetAppPage() {
  const t = makeT(await getLocale());
  return (
    <main className="page center">
      <h1>{t('get_app.title')}</h1>
      <GetApp
        appStoreUrl={env.appStoreUrl}
        playStoreUrl={env.playStoreUrl}
        strings={{
          body: t('get_app.body'),
          openApp: t('get_app.open_app'),
          appStore: t('get_app.app_store'),
          playStore: t('get_app.play_store'),
          comeBack: t('get_app.come_back'),
          inAppBrowser: t('get_app.in_app_browser'),
          desktop: t('get_app.desktop'),
        }}
      />
    </main>
  );
}
