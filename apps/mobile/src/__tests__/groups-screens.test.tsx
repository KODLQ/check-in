import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import GroupScreen from '@/app/groups/[id]';
import Groups from '@/app/groups/index';
import { suggestedHeir, type GroupRole } from '@/lib/groups';
import { supabase } from '@/lib/supabase';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => ({ id: 'g1' }),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/components/toast', () => ({ Toast: () => null }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));

type Rpc = Record<string, { data?: unknown; error?: { message: string } | null }>;
function mockRpc(map: Rpc) {
  (supabase.rpc as jest.Mock).mockImplementation(async (fn: string) => map[fn] ?? { data: null, error: null });
}

const member = (user_id: string, display_name: string, role: GroupRole, joined_at: string) => ({
  user_id,
  display_name,
  role,
  joined_at,
});

function group(myRole: 'owner' | 'admin' | 'member', extra: Record<string, unknown> = {}) {
  return {
    id: 'g1',
    name: 'AW crew',
    owner_id: myRole === 'owner' ? 'me' : 'anna',
    owner_name: 'Anna',
    my_role: myRole,
    members: [
      member(myRole === 'owner' ? 'me' : 'anna', myRole === 'owner' ? 'Me' : 'Anna', 'owner', '2026-01-01'),
      member('erik', 'Erik', 'admin', '2026-01-02'),
      member('sara', 'Sara', 'admin', '2026-01-05'),
      member(myRole === 'owner' ? 'cecilia' : 'me', myRole === 'owner' ? 'Cecilia' : 'Me', myRole === 'owner' ? 'member' : myRole, '2026-01-03'),
    ],
    link: myRole === 'member' ? null : 'AbCdEfGhIjKlMnOpQrStUv',
    pending_invitations: myRole === 'member' ? null : 0,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('groups list (8.1)', () => {
  it('lists groups and pending invitations; accepting opens the group', async () => {
    mockRpc({
      list_my_groups: {
        data: {
          groups: [{ id: 'g1', name: 'AW crew', role: 'owner', member_count: 4 }],
          invitations: [{ group_id: 'g2', name: 'Padel', owner_name: 'Lina', invited_by_name: 'Lina', member_count: 6 }],
        },
      },
      respond_group_invitation: { data: null, error: null },
    });
    await render(<Groups />);
    expect(await screen.findByText('AW crew')).toBeTruthy();
    expect(screen.getByText('4 members')).toBeTruthy();
    expect(screen.getByText('Lina invited you · 6 members')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('accept-g2'));
    expect(supabase.rpc).toHaveBeenCalledWith('respond_group_invitation', { p_group_id: 'g2', p_accept: true });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/groups/g2'));
  });

  it('declines without opening the group', async () => {
    mockRpc({
      list_my_groups: {
        data: { groups: [], invitations: [{ group_id: 'g2', name: 'Padel', owner_name: 'Lina', invited_by_name: null, member_count: 6 }] },
      },
    });
    await render(<Groups />);
    await fireEvent.press(await screen.findByTestId('decline-g2'));
    expect(supabase.rpc).toHaveBeenCalledWith('respond_group_invitation', { p_group_id: 'g2', p_accept: false });
    expect(router.push).not.toHaveBeenCalled();
  });

  it('creates a group and opens it', async () => {
    mockRpc({ list_my_groups: { data: { groups: [], invitations: [] } }, create_group: { data: 'g9' } });
    await render(<Groups />);
    await fireEvent.press(await screen.findByTestId('new-group'));
    await fireEvent.changeText(screen.getByTestId('group-name'), '  Friday crew ');
    await fireEvent.press(screen.getByTestId('create-group'));
    expect(supabase.rpc).toHaveBeenCalledWith('create_group', { p_name: 'Friday crew' });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/groups/g9'));
  });
});

describe('group screen (8.2, 8.3, 9.5)', () => {
  it('hides admin actions from regular members', async () => {
    mockRpc({ get_group: { data: group('member') }, list_group_series: { data: [] } });
    await render(<GroupScreen />);
    expect(await screen.findByTestId('group-title')).toHaveTextContent('AW crew');
    expect(screen.queryByTestId('share-group-link')).toBeNull();
    expect(screen.queryByTestId('add-past-guests')).toBeNull();
    expect(screen.queryByTestId('new-series')).toBeNull();
    expect(screen.queryByTestId('delete-group')).toBeNull();
    expect(screen.getByTestId('leave-group')).toBeTruthy();
  });

  it('gives admins the link, past guests and series, but not delete', async () => {
    mockRpc({ get_group: { data: group('admin') }, list_group_series: { data: [] } });
    await render(<GroupScreen />);
    expect(await screen.findByTestId('share-group-link')).toBeTruthy();
    expect(screen.getByTestId('group-link')).toHaveTextContent('http://localhost:3000/g/AbCdEfGhIjKlMnOpQrStUv');
    expect(screen.getByTestId('add-past-guests')).toBeTruthy();
    expect(screen.getByTestId('new-series')).toBeTruthy();
    expect(screen.getByTestId('rename-group')).toBeTruthy();
    expect(screen.queryByTestId('delete-group')).toBeNull();
    expect(screen.getByTestId('role-Anna')).toHaveTextContent('Owner');
    expect(screen.getByTestId('role-Erik')).toHaveTextContent('Admin');
  });

  it('invites the picked past guests and shows a rate-limit error', async () => {
    mockRpc({
      get_group: { data: group('owner') },
      list_group_series: { data: [] },
      invitable_past_guests: { data: [{ user_id: 'f', display_name: 'Frida' }, { user_id: 'h', display_name: 'Hugo' }] },
      invite_to_group: { data: null, error: { message: 'rate_limited' } },
    });
    await render(<GroupScreen />);
    await fireEvent.press(await screen.findByTestId('add-past-guests'));
    await fireEvent.press(await screen.findByTestId('past-guest-Hugo'));
    await fireEvent.press(screen.getByTestId('invite-picked'));
    expect(supabase.rpc).toHaveBeenCalledWith('invite_to_group', { p_group_id: 'g1', p_user_ids: ['h'] });
    expect(await screen.findByTestId('group-error')).toHaveTextContent(/Too many attempts/);
  });

  it('makes the owner pick a new owner before leaving, suggesting the earliest admin', async () => {
    mockRpc({ get_group: { data: group('owner') }, list_group_series: { data: [] }, hand_over_and_leave_group: { data: null } });
    const alert = jest.spyOn(Alert, 'alert');
    await render(<GroupScreen />);
    await fireEvent.press(await screen.findByTestId('leave-group'));
    expect(screen.getByText('Pick a new owner')).toBeTruthy();
    expect(screen.getAllByText('Suggested')).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('heir-Erik'));
    const buttons = alert.mock.calls.at(-1)![2]!;
    await buttons[1]!.onPress!();
    expect(supabase.rpc).toHaveBeenCalledWith('hand_over_and_leave_group', { p_group_id: 'g1', p_new_owner: 'erik' });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/groups'));
  });

  it('lists the group\'s series and opens the next date', async () => {
    mockRpc({
      get_group: { data: group('member') },
      list_group_series: {
        data: [{ id: 's1', title: 'AW', frequency: 'weekly', anchor_local_date: '2026-11-13', ends_on: null,
          next: { event_id: 'e5', starts_at: '2026-11-20T16:00:00Z', cancelled: false } }],
      },
    });
    await render(<GroupScreen />);
    expect(await screen.findByText(/Every Friday/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('series-s1'));
    expect(router.push).toHaveBeenCalledWith('/invites/e5');
  });
});

describe('suggestedHeir', () => {
  it('prefers the longest-standing admin, then the longest-standing member', () => {
    const owner = member('o', 'O', 'owner', '2026-01-01');
    expect(suggestedHeir([owner, member('m', 'M', 'member', '2026-01-02'), member('a', 'A', 'admin', '2026-01-09')])?.user_id).toBe('a');
    expect(suggestedHeir([owner, member('m2', 'M2', 'member', '2026-01-05'), member('m1', 'M1', 'member', '2026-01-02')])?.user_id).toBe('m1');
    expect(suggestedHeir([owner])).toBeNull();
  });
});
