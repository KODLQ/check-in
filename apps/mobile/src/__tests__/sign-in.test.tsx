import '@/lib/i18n';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

import SignIn, { RESEND_COOLDOWN_S } from '@/app/sign-in';
import { sendMagicLink } from '@/lib/auth-actions';

jest.mock('expo-apple-authentication', () => ({ isAvailableAsync: jest.fn(async () => false) }));
jest.mock('@/lib/auth-actions', () => ({
  sendMagicLink: jest.fn(async () => {}),
  signInWithApple: jest.fn(),
  signInWithGoogle: jest.fn(),
}));

const send = sendMagicLink as jest.Mock;

beforeEach(() => jest.clearAllMocks());

it('sends from the keyboard, resends after a cooldown and can switch email', async () => {
  jest.useFakeTimers();
  await render(<SignIn />);
  await fireEvent.changeText(screen.getByTestId('email'), 'demo@checkin.test');
  await fireEvent(screen.getByTestId('email'), 'submitEditing');
  await waitFor(() => expect(send).toHaveBeenCalledWith('demo@checkin.test'));
  expect(await screen.findByTestId('resend-link')).toBeDisabled();

  expect(screen.getByTestId('resend-link')).toHaveTextContent(`Send a new link (${RESEND_COOLDOWN_S} s)`);
  for (let i = 0; i < RESEND_COOLDOWN_S; i++) {
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
  }
  await waitFor(() => expect(screen.getByTestId('resend-link')).not.toBeDisabled());
  await fireEvent.press(screen.getByTestId('resend-link'));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(await screen.findByText('We sent a new link to demo@checkin.test.')).toBeTruthy();

  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  await fireEvent.press(screen.getByTestId('open-mail'));
  expect(open).toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('other-email'));
  expect(screen.getByTestId('email')).toBeTruthy();
  jest.useRealTimers();
});
