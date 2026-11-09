// Browser-side guest identity, shared by the RSVP form and the date poll (client components only).
// The device token lives in a cookie (for server rendering) and localStorage (survives in-app browsers that
// drop cookies). Only its SHA-256 is stored server-side.

export const GUEST_COOKIE_NAME = 'ci_guest';
export const GUEST_STORAGE_KEY = 'ci_guest';
/** The name a guest last answered with, offered again on other invites from this browser. */
export const GUEST_NAME_KEY = 'ci_name';

export function readGuestCookie(): string | null {
  const m = document.cookie.match(/(?:^|; )ci_guest=([^;]+)/);
  return m?.[1] ?? null;
}

export function writeGuestCookie(value: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${GUEST_COOKIE_NAME}=${value}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

export function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Random 128-bit device token, base64url (22 chars). */
function newGuestToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function getGuestToken(): string {
  const existing = readGuestCookie() ?? safeStorage()?.getItem(GUEST_STORAGE_KEY);
  const token = existing ?? newGuestToken();
  writeGuestCookie(token);
  safeStorage()?.setItem(GUEST_STORAGE_KEY, token);
  return token;
}
