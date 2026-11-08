import { isValidCoHostToken } from '@check-in/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** A co-host link opened while signed out or before onboarding; resumed once the user reaches home. */
export const PENDING_CO_HOST_KEY = 'ci_pending_co_host';
/** Links expire after 7 days, so older entries are dropped without calling the server. */
export const PENDING_CO_HOST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function savePendingCoHostInvite(token: string, now = Date.now()): Promise<boolean> {
  if (!isValidCoHostToken(token)) return false;
  await AsyncStorage.setItem(PENDING_CO_HOST_KEY, JSON.stringify({ token, savedAt: now }));
  return true;
}

/** Returns and removes the pending token, if any and still fresh. */
export async function consumePendingCoHostInvite(now = Date.now()): Promise<string | null> {
  const raw = await AsyncStorage.getItem(PENDING_CO_HOST_KEY);
  if (!raw) return null;
  await AsyncStorage.removeItem(PENDING_CO_HOST_KEY);
  try {
    const { token, savedAt } = JSON.parse(raw) as { token: string; savedAt: number };
    if (isValidCoHostToken(token) && savedAt <= now && now - savedAt < PENDING_CO_HOST_MAX_AGE_MS) return token;
  } catch {
    // malformed: dropped
  }
  return null;
}
