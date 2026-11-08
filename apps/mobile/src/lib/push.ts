// Push notifications (spec: push permission timing, push registration lifecycle; design §8).
// - The OS prompt is only ever shown from maybeAskForPush, which is called after the host's first event
//   is created and after a successful in-app RSVP. Never at launch or sign-in.
// - Our explainer is shown at most once; after a decline we never prompt again on our own.
// - When permission is granted, every app start re-registers the token (refreshes last_seen_at/locale).
// - Sign-out unregisters the token BEFORE the session ends (the RPC needs the user's JWT).
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';

import i18n, { locale } from './i18n';
import { supabase } from './supabase';

export type PushReason = 'first_event' | 'rsvp';

const EXPLAINER_SHOWN_KEY = 'push:explainer-shown';
const TOKEN_KEY = 'push:token';

/** Foreground presentation (SDK 58 shows foreground notifications by default; be explicit). */
export function configureNotificationHandler() {
  if (Platform.OS === 'web') return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** EAS project id: app.json extra.eas.projectId (set by `eas init`) or EXPO_PUBLIC_EAS_PROJECT_ID. */
export function easProjectId(): string | undefined {
  return (
    (Constants.expoConfig?.extra?.eas?.projectId as string | undefined) ??
    Constants.easConfig?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ??
    undefined
  );
}

export async function permissionState(): Promise<'granted' | 'undetermined' | 'denied'> {
  const p = await Notifications.getPermissionsAsync();
  if (p.granted || p.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return 'granted';
  if (p.ios ? p.ios.status === Notifications.IosAuthorizationStatus.NOT_DETERMINED : p.status === 'undetermined') {
    return 'undetermined';
  }
  return 'denied';
}

/** Short in-app explainer before the system prompt. Resolves true for "Turn on". */
export function showExplainer(reason: PushReason): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      i18n.t('push.explainer_title'),
      i18n.t(reason === 'first_event' ? 'push.explainer_host' : 'push.explainer_guest'),
      [
        { text: i18n.t('push.not_now'), style: 'cancel', onPress: () => resolve(false) },
        { text: i18n.t('push.allow'), onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  // Must exist before requesting permission / a token on Android 13+.
  await Notifications.setNotificationChannelAsync('default', {
    name: 'check-in',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Registers this device's Expo push token for the signed-in user, if notifications are allowed.
 * Never prompts. Safe to call on every app start.
 */
export async function registerForPush(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if ((await permissionState()) !== 'granted') return null;
  const projectId = easProjectId();
  if (!projectId) {
    console.warn('push: no EAS projectId configured (run `eas init`); skipping token registration');
    return null;
  }
  try {
    await ensureAndroidChannel();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
      p_locale: locale,
    });
    if (error) throw error;
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return token;
  } catch (e) {
    console.warn('push: registration failed', (e as Error).message);
    return null;
  }
}

/**
 * Asks for notification permission at a meaningful moment. Only when the OS has never been asked,
 * and only once from our side (a decline is remembered).
 */
export async function maybeAskForPush(
  reason: PushReason,
  explain: (reason: PushReason) => Promise<boolean> = showExplainer,
): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const state = await permissionState();
  if (state === 'granted') {
    await registerForPush();
    return true;
  }
  if (state === 'denied') return false;
  if (await AsyncStorage.getItem(EXPLAINER_SHOWN_KEY)) return false;
  await AsyncStorage.setItem(EXPLAINER_SHOWN_KEY, new Date().toISOString());

  if (!(await explain(reason))) return false;
  await ensureAndroidChannel();
  const result = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  if (!result.granted) return false;
  await registerForPush();
  return true;
}

/** Stops push to this device for the current account. Call while still signed in. */
export async function unregisterPush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (!token) return;
  try {
    await supabase.rpc('unregister_push_token', { p_token: token });
  } catch {
    // Offline: the server drops the token on DeviceNotRegistered / after 180 days unseen.
  }
  await AsyncStorage.removeItem(TOKEN_KEY);
}

/** Sign out: unregister the device first (needs the session), then end the session. */
export async function signOut(scope: 'global' | 'local' = 'global'): Promise<void> {
  await unregisterPush();
  await supabase.auth.signOut({ scope });
}

/** Account deleted: server rows are gone already (cascade); just forget the token locally. */
export async function forgetLocalPushToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}
