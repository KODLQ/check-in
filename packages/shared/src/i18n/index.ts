import en from './en.json';
import sv from './sv.json';

export const SUPPORTED_LOCALES = ['en', 'sv'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

export const translations = { en, sv } as const;
export type TranslationKeys = typeof en;

/** Picks the first supported locale from a preference list (e.g. ["sv-SE", "en"]). */
export function pickLocale(preferred: readonly (string | null | undefined)[]): Locale {
  for (const tag of preferred) {
    const base = tag?.toLowerCase().split(/[-_]/)[0];
    if (base && (SUPPORTED_LOCALES as readonly string[]).includes(base)) return base as Locale;
  }
  return DEFAULT_LOCALE;
}

/** Parses an HTTP Accept-Language header into tags ordered by quality. */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { tag: tag?.trim() ?? '', q: q ? Number(q.split('=')[1]) : 1 };
    })
    .filter((x) => x.tag)
    .sort((a, b) => b.q - a.q)
    .map((x) => x.tag);
}
