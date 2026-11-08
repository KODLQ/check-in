import 'server-only';

import { parseAcceptLanguage, pickLocale, translations, type Locale } from '@check-in/shared';
import { headers } from 'next/headers';

export async function getLocale(): Promise<Locale> {
  const h = await headers();
  return pickLocale(parseAcceptLanguage(h.get('accept-language')));
}

export type T = (key: string, vars?: Record<string, string | number>) => string;

export function makeT(locale: Locale): T {
  return (key, vars) => {
    let node: unknown = translations[locale];
    for (const part of key.split('.')) node = (node as Record<string, unknown> | undefined)?.[part];
    let str = typeof node === 'string' ? node : key;
    for (const [k, v] of Object.entries(vars ?? {})) str = str.replaceAll(`{{${k}}}`, String(v));
    return str;
  };
}

/** Subset of strings the client RSVP component needs. */
export function clientStrings(t: T) {
  return {
    going: t('rsvp.going'),
    maybe: t('rsvp.maybe'),
    declined: t('rsvp.declined'),
    nameLabel: t('rsvp.name_label'),
    namePlaceholder: t('profile.name_placeholder'),
    remove: t('rsvp.remove'),
    yourAnswer: t('rsvp.your_answer', { status: '{{status}}' }),
    nameRequired: t('errors.name_required'),
    rateLimited: t('errors.rate_limited'),
    eventClosed: t('errors.event_closed'),
    error: t('common.error'),
  };
}
export type ClientStrings = ReturnType<typeof clientStrings>;
