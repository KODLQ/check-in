import type { Metadata } from 'next';

import { getLocale, makeT } from '@/lib/i18n';

// Unsubscribe confirmation. Viewing this page never changes anything (link scanners just GET);
// the button POSTs to /api/unsubscribe/<token>. Shows no event details, and looks the same for
// unknown or already-used tokens.
export async function generateMetadata(): Promise<Metadata> {
  const t = makeT(await getLocale());
  return { title: t('unsubscribe.title'), robots: { index: false, follow: false } };
}

export default async function UnsubscribePage({ params, searchParams }: PageProps<'/u/[token]'>) {
  const [{ token }, { done }, locale] = await Promise.all([params, searchParams, getLocale()]);
  const t = makeT(locale);

  if (done) {
    return (
      <main className="page center">
        <h1>{t('unsubscribe.done_title')}</h1>
        <p className="muted" data-testid="unsubscribed">{t('unsubscribe.done_body')}</p>
      </main>
    );
  }

  return (
    <main className="page center">
      <h1>{t('unsubscribe.title')}</h1>
      <p className="muted">{t('unsubscribe.body')}</p>
      <form method="post" action={`/api/unsubscribe/${encodeURIComponent(token)}`}>
        <input type="hidden" name="source" value="page" />
        <button type="submit" className="btn primary" style={{ width: '100%' }}>
          {t('unsubscribe.button')}
        </button>
      </form>
    </main>
  );
}
