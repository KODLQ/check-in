import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';

import Settings from '@/app/settings';
import { signOut } from '@/lib/push';
import { supabase } from '@/lib/supabase';

jest.mock('@/lib/push', () => ({ signOut: jest.fn(async () => {}), forgetLocalPushToken: jest.fn() }));
jest.mock('@/components/toast', () => ({ Toast: () => null }));
const mockRefresh = jest.fn(async () => {});
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    session: { user: { id: 'u1', email: 'demo@checkin.test' } },
    profile: { display_name: 'Demo', wall_default_enabled: true },
    refreshProfile: mockRefresh,
  }),
}));
const mockEq = jest.fn(async () => ({ error: null }));
const mockUpdate = jest.fn(() => ({ eq: mockEq }));
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn(() => ({ update: mockUpdate })) } }));

beforeEach(() => jest.clearAllMocks());

describe('settings', () => {
  it('asks before signing out, and signs out only after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<Settings />);
    await fireEvent.press(screen.getByTestId('sign-out'));
    expect(alert).toHaveBeenCalledWith('Sign out?', "You'll stay signed in on your other devices.", expect.any(Array));
    expect(signOut).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2]!;
    buttons.find((b) => b.text === 'Sign out')!.onPress!();
    expect(signOut).toHaveBeenCalled();
  });

  it('edits the display name with the onboarding rules', async () => {
    await render(<Settings />);
    await fireEvent.press(screen.getByTestId('settings-edit-name'));
    await fireEvent.changeText(screen.getByTestId('settings-name'), '   ');
    await fireEvent.press(screen.getByTestId('settings-save-name'));
    expect(await screen.findByTestId('settings-name-error')).toBeTruthy();
    expect(mockUpdate).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('settings-name'), ' Anna ');
    await fireEvent.press(screen.getByTestId('settings-save-name'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith({ display_name: 'Anna' }));
    expect(supabase.from).toHaveBeenCalledWith('profiles');
    expect(mockRefresh).toHaveBeenCalled();
  });
});
