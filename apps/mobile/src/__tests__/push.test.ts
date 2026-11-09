import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { maybeAskForPush, registerForPush, signOut } from '@/lib/push';
import { supabase } from '@/lib/supabase';

jest.mock('expo-constants', () => ({ expoConfig: { extra: { eas: { projectId: 'test-project' } } } }));
jest.mock('expo-notifications', () => ({
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  AndroidImportance: { DEFAULT: 3 },
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  setNotificationHandler: jest.fn(),
}));
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: jest.fn(), auth: { signOut: jest.fn() } },
}));

const N = Notifications as jest.Mocked<typeof Notifications>;
const rpc = supabase.rpc as jest.Mock;
const authSignOut = supabase.auth.signOut as jest.Mock;

const undetermined = { granted: false, status: 'undetermined', ios: { status: 0 } };
const granted = { granted: true, status: 'granted', ios: { status: 2 } };
const denied = { granted: false, status: 'denied', ios: { status: 1 } };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  rpc.mockResolvedValue({ data: null, error: null });
  N.getExpoPushTokenAsync.mockResolvedValue({ type: 'expo', data: 'ExponentPushToken[abc]' });
});

describe('push permission timing', () => {
  it('never prompts at launch or sign-in (startup only registers when already allowed)', async () => {
    N.getPermissionsAsync.mockResolvedValue(undetermined as never);
    expect(await registerForPush()).toBeNull();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('registers on start when permission was granted earlier', async () => {
    N.getPermissionsAsync.mockResolvedValue(granted as never);
    expect(await registerForPush()).toBe('ExponentPushToken[abc]');
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project' });
    expect(rpc).toHaveBeenCalledWith('register_push_token', {
      p_token: 'ExponentPushToken[abc]',
      p_platform: 'ios',
      p_locale: 'en',
    });
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('explains, then shows the OS prompt after the first event, then registers', async () => {
    N.getPermissionsAsync.mockResolvedValueOnce(undetermined as never).mockResolvedValue(granted as never);
    N.requestPermissionsAsync.mockResolvedValue(granted as never);
    const explain = jest.fn().mockResolvedValue(true);
    expect(await maybeAskForPush('first_event', explain)).toBe(true);
    expect(explain).toHaveBeenCalledWith('first_event');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('register_push_token', expect.objectContaining({ p_token: 'ExponentPushToken[abc]' }));
  });

  it('does not show the OS prompt again on its own after a decline', async () => {
    N.getPermissionsAsync.mockResolvedValue(undetermined as never);
    const explain = jest.fn().mockResolvedValue(false); // "Not now" in our explainer
    expect(await maybeAskForPush('rsvp', explain)).toBe(false);
    expect(await maybeAskForPush('rsvp', explain)).toBe(false);
    expect(explain).toHaveBeenCalledTimes(1);
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not prompt when the system prompt was declined', async () => {
    N.getPermissionsAsync.mockResolvedValue(denied as never);
    const explain = jest.fn();
    expect(await maybeAskForPush('first_event', explain)).toBe(false);
    expect(explain).not.toHaveBeenCalled();
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});

describe('sign-out', () => {
  it('unregisters the device before ending the session', async () => {
    N.getPermissionsAsync.mockResolvedValue(granted as never);
    await registerForPush();
    rpc.mockClear();
    const order: string[] = [];
    rpc.mockImplementation(async (fn: string) => {
      order.push(fn);
      return { data: true, error: null };
    });
    authSignOut.mockImplementation(async () => {
      order.push('signOut');
      return { error: null };
    });
    await signOut();
    expect(order).toEqual(['unregister_push_token', 'signOut']);
    expect(rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: 'ExponentPushToken[abc]' });
  });

  it('still signs out when no device was registered', async () => {
    await signOut();
    expect(rpc).not.toHaveBeenCalled();
    expect(authSignOut).toHaveBeenCalled();
  });

  it('signs out only this device by default (other devices stay signed in)', async () => {
    await signOut();
    expect(authSignOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
