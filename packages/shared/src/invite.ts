export const INVITE_PATH_PREFIX = '/i/';
export const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9]{12}$/;

export function inviteUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, '')}${INVITE_PATH_PREFIX}${token}`;
}

export function isValidInviteToken(token: string): boolean {
  return INVITE_TOKEN_PATTERN.test(token);
}

/** Google Maps search link that also opens Apple Maps / Google Maps apps. */
export function mapsUrl(opts: {
  latitude?: number | null;
  longitude?: number | null;
  query: string;
}): string {
  if (opts.latitude != null && opts.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${opts.latitude},${opts.longitude}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(opts.query)}`;
}

/** Invite URL for printing on images: no scheme, no trailing slash (e.g. "checkin.example/i/AbC123"). */
export function displayInviteUrl(baseUrl: string, token: string): string {
  return inviteUrl(baseUrl.trim().replace(/\/+$/, ''), token).replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
}
