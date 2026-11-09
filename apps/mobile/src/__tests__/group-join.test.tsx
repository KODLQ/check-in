import '@/lib/i18n';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import JoinGroup from '@/app/g/[token]';
import { consumePendingGroupLink, PENDING_GROUP_KEY } from '@/lib/groups';
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

function mockRpc(preview: unknown, join?: unknown) {
  (supabase.rpc as jest.Mock).mockImplementation(async (fn: string) =>
    fn === 'get_group_link_preview' ? { data: preview, error: null } : join,
  );
}

const valid = { state: 'valid', group_id: null, name: 'AW crew', owner_name: 'Anna', member_count: 7, is_member: false };

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAuth = signedIn;
});

describe('group link screen (8.4)', () => {
  it('shows the group, owner, member count and name disclosure; joining opens the group', async () => {
    mockRpc(valid, { data: 'g1', error: null });
    await render(<JoinGroup />);
    expect(await screen.findByText('Join AW crew?')).toBeTruthy();
    expect(screen.getByText("Anna's group · 7 members")).toBeTruthy();
    expect(screen.getByText(/Members see your name \(Erik\)/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('join-group'));
    expect(supabase.rpc).toHaveBeenCalledWith('join_group_by_link', { p_token: TOKEN });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/groups/g1'));
  });

  it('opens the group straight away for a member', async () => {
    mockRpc({ ...valid, group_id: 'g1', is_member: true });
    await render(<JoinGroup />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/groups/g1'));
    expect(supabase.rpc).not.toHaveBeenCalledWith('join_group_by_link', expect.anything());
  });

  it('shows the invalid message for an unknown or turned-off link', async () => {
    mockRpc({ state: 'invalid' });
    await render(<JoinGroup />);
    expect(await screen.findByText("This group link doesn't work")).toBeTruthy();
    expect(screen.queryByTestId('join-group')).toBeNull();
  });

  it('shows a full group', async () => {
    mockRpc(valid, { data: null, error: { message: 'group_full' } });
    await render(<JoinGroup />);
    await fireEvent.press(await screen.findByTestId('join-group'));
    expect(await screen.findByTestId('join-error')).toHaveTextContent('The group is full (50 people)');
  });

  it('remembers the link through sign-in and resumes it once', async () => {
    mockAuth = { session: null, profile: null, loading: false };
    await render(<JoinGroup />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/sign-in'));
    expect(await AsyncStorage.getItem(PENDING_GROUP_KEY)).toContain(TOKEN);
    expect(await consumePendingGroupLink()).toBe(TOKEN);
    expect(await consumePendingGroupLink()).toBeNull();
  });
});
