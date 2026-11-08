import type { Locale } from './i18n';

type Name = string | null | undefined;

const CONJUNCTION: Record<Locale, string> = { en: ' & ', sv: ' och ' };

/** Non-empty, trimmed host names: owner first, then co-hosts in the order given (join order). */
export function hostNames(owner: Name, coHosts: readonly Name[] = []): string[] {
  return [owner, ...coHosts].map((n) => n?.trim() ?? '').filter((n) => n.length > 0);
}

/**
 * "Anna", "Anna & Erik", "Anna, Erik & Sara" (en) / "Anna och Erik", "Anna, Erik och Sara" (sv).
 * Owner first, then co-hosts in join order (spec: co-hosts / Host names shown to guests).
 */
export function formatHostNames(owner: Name, coHosts: readonly Name[], locale: Locale): string {
  const names = hostNames(owner, coHosts);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')}${CONJUNCTION[locale]}${names[names.length - 1]}`;
}

/** Translation key for the "Hosted by …" line: singular for one host, plural for several. */
export function hostedByKey(owner: Name, coHosts: readonly Name[] = []): 'hosted_by' | 'hosted_by_many' {
  return hostNames(owner, coHosts).length > 1 ? 'hosted_by_many' : 'hosted_by';
}

/** Co-host invite links: /c/<22-char base62 token>. Never matches the 12-char guest link format. */
export const CO_HOST_PATH_PREFIX = '/c/';
export const CO_HOST_TOKEN_PATTERN = /^[A-Za-z0-9]{22}$/;

export function coHostInviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}${CO_HOST_PATH_PREFIX}${token}`;
}

export function isValidCoHostToken(token: string): boolean {
  return CO_HOST_TOKEN_PATTERN.test(token);
}

/** Maximum co-hosts per event, not counting the owner (mirrors public.max_co_hosts()). */
export const MAX_CO_HOSTS = 5;
