import '@/lib/i18n';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import AcceptCoHost from '@/app/c/[token]';
import { supabase } from '@/lib/supabase';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ token: 'AbCdEfGhIjKlMnOpQrStUv' }),
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

let mockAuth: { session: unknown; profile: unknown; loading: boolean };
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));

const signedIn = { session: { user: { id: 'me' } }, profile: { display_name: 'Erik' }, loading: false };

function mockRpc(get: unknown, accept?: unknown) {
  (supabase.rpc as jest.Mock).mockImplementation(async (fn: string) =>
    fn === 'get_co_host_invite' ? { data: get, error: null } : accept,
  );
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAuth = signedIn;
});

describe('co-host accept screen', () => {
  it('shows the event, owner and name disclosure, and accepting opens the event', async () => {
    mockRpc({ state: 'valid', event: { title: 'Fredagshäng' }, owner: { display_name: 'Anna' } }, { data: 'e1', error: null });
    await render(<AcceptCoHost />);
    expect(await screen.findByText('Fredagshäng')).toBeTruthy();
    expect(screen.getByText('Anna invited you to co-host')).toBeTruthy();
    expect(screen.getByText(/Your name \(Erik\) will be shown to guests as a host/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('accept-co-host'));
    expect(supabase.rpc).toHaveBeenCalledWith('accept_co_host_invite', { p_token: TOKEN });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/events/e1'));
  });

  it('shows the generic invalid message', async () => {
    mockRpc({ state: 'invalid' });
    await render(<AcceptCoHost />);
    expect(await screen.findByText('Invite no longer valid')).toBeTruthy();
    expect(screen.queryByTestId('accept-co-host')).toBeNull();
  });

  it('tells the owner they already host it', async () => {
    mockRpc({ state: 'owner', event: { id: 'e1', title: 'Fredagshäng' }, owner: { display_name: 'Anna' } });
    await render(<AcceptCoHost />);
    expect(await screen.findByText('You already host this event, so this link stays unused.')).toBeTruthy();
    expect(screen.queryByTestId('accept-co-host')).toBeNull();
    await fireEvent.press(screen.getByTestId('open-event'));
    expect(router.replace).toHaveBeenCalledWith('/events/e1');
  });

  it('opens the event for an existing co-host without using the link', async () => {
    mockRpc({ state: 'already_co_host', event: { id: 'e1', title: 'Fredagshäng' }, owner: { display_name: 'Anna' } });
    await render(<AcceptCoHost />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/events/e1'));
    expect(supabase.rpc).not.toHaveBeenCalledWith('accept_co_host_invite', expect.anything());
  });

  it('shows the limit error when the event is full', async () => {
    mockRpc({ state: 'valid', event: { title: 'Fredagshäng' }, owner: { display_name: 'Anna' } }, { data: null, error: { message: 'co_host_limit' } });
    await render(<AcceptCoHost />);
    await fireEvent.press(await screen.findByTestId('accept-co-host'));
    expect(await screen.findByTestId('accept-error')).toHaveTextContent('This event already has the maximum of 5 co-hosts');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('switches to the invalid message when the link was used meanwhile', async () => {
    mockRpc({ state: 'valid', event: { title: 'Fredagshäng' }, owner: { display_name: 'Anna' } }, { data: null, error: { message: 'invalid_invite' } });
    await render(<AcceptCoHost />);
    await fireEvent.press(await screen.findByTestId('accept-co-host'));
    expect(await screen.findByText('Invite no longer valid')).toBeTruthy();
  });

  it('sends a signed-out user to sign in and keeps the link for later', async () => {
    mockAuth = { session: null, profile: null, loading: false };
    await render(<AcceptCoHost />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/sign-in'));
    expect(JSON.parse((await AsyncStorage.getItem('ci_pending_co_host'))!).token).toBe(TOKEN);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('sends a user without a display name to onboarding first', async () => {
    mockAuth = { session: { user: { id: 'me' } }, profile: { display_name: null }, loading: false };
    await render(<AcceptCoHost />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/onboarding'));
    expect(await AsyncStorage.getItem('ci_pending_co_host')).toBeTruthy();
  });
});
