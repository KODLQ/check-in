import { INVITE_TOKEN_PATTERN } from '@check-in/shared';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * In-app route for a tapped notification's `data.url`: the host view `/events/<id>` for managers,
 * the invite `/i/<token>` for guests. Anything else is ignored.
 */
export function notificationRoute(data: unknown): `/events/${string}` | `/i/${string}` | null {
  const url = (data as { url?: unknown } | null | undefined)?.url;
  if (typeof url !== 'string') return null;
  const [, kind, id, ...rest] = url.split('/');
  if (rest.length > 0 || !id) return null;
  if (kind === 'events' && UUID.test(id)) return `/events/${id}`;
  if (kind === 'i' && INVITE_TOKEN_PATTERN.test(id)) return `/i/${id}`;
  return null;
}
