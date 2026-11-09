import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert, Share } from 'react-native';

import EventDetail from '@/app/events/[id]';
import { supabase } from '@/lib/supabase';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'e1' }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/components/cover', () => ({ Cover: () => null }));
jest.mock('@/components/toast', () => ({ Toast: () => null }));
jest.mock('@/components/story-share-button', () => ({ StoryShareButton: () => null }));
jest.mock('@/lib/action-sheet', () => ({ showActionSheet: jest.fn() }));
jest.mock('@/lib/events', () => ({
  ...jest.requireActual('@/lib/events'),
  fetchActiveInvite: jest.fn(async () => 'AbC123def456'),
}));

let mockUserId = 'owner';
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: mockUserId } } }) }));

let mockEvent: Record<string, unknown> | null;
let mockSeries: Record<string, unknown> | null = null;
let mockLinks: unknown[] = [];
let mockRsvps: unknown[] = [];
jest.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result = () =>
      table === 'events'
        ? { data: mockEvent, error: null }
        : table === 'event_series'
          ? { data: mockSeries, error: null }
        : { data: table === 'co_host_invites' ? mockLinks : table === 'rsvps' ? mockRsvps : [], error: null };
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'update', 'is', 'gt']) b[m] = () => b;
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: builder, channel: () => channel, removeChannel: jest.fn(), rpc: jest.fn() } };
});

const HOSTS = [
  { user_id: 'owner', display_name: 'Anna', role: 'owner', added_at: '2026-11-01T10:00:00Z' },
  { user_id: 'cohost', display_name: 'Erik', role: 'co_host', added_at: '2026-11-02T10:00:00Z' },
];

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const baseEvent = {
  id: 'e1',
  host_id: 'owner',
  title: 'Fredagshäng',
  starts_at: inDays(2),
  ends_at: null,
  time_zone: 'Europe/Stockholm',
  location_text: 'Hornsgatan 12',
  latitude: null,
  longitude: null,
  description: null,
  cover_path: null,
  theme: 'sunset',
  cancelled_at: null,
  guest_list_visible: true,
};

function mockRpc(overrides: Record<string, unknown> = {}) {
  (supabase.rpc as jest.Mock).mockImplementation(async (fn: string) => {
    if (fn in overrides) return overrides[fn];
    if (fn === 'list_event_hosts') return { data: HOSTS, error: null };
    return { data: null, error: null };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEvent = { ...baseEvent };
  mockLinks = [];
  mockRsvps = [];
  mockSeries = null;
  mockUserId = 'owner';
  mockRpc();
});

describe('event detail for the owner', () => {
  it('offers cancel and co-host management, not leave', async () => {
    mockLinks = [{ token: 'AbCdEfGhIjKlMnOpQrStUv', expires_at: inDays(6) }];
    await render(<EventDetail />);
    expect(await screen.findByTestId('host-owner-Anna')).toHaveTextContent(/Anna \(you\).*Owner/);
    expect(screen.getByTestId('host-co_host-Erik')).toHaveTextContent(/Erik.*Co-host/);
    expect(screen.getByTestId('cancel-event')).toBeTruthy();
    expect(screen.getByTestId('invite-co-host')).toBeTruthy();
    expect(screen.getByTestId('remove-co-host-Erik')).toBeTruthy();
    expect(await screen.findByTestId('pending-co-host-link')).toHaveTextContent(/Unused link/);
    expect(screen.queryByTestId('leave-co-host')).toBeNull();
  });

  it('shares a new co-host link', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    mockRpc({ create_co_host_invite: { data: 'AbCdEfGhIjKlMnOpQrStUv', error: null } });
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('invite-co-host'));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(share.mock.calls[0]![0]).toMatchObject({ url: 'http://localhost:3000/c/AbCdEfGhIjKlMnOpQrStUv' });
    expect(supabase.rpc).toHaveBeenCalledWith('create_co_host_invite', { p_event_id: 'e1' });
  });

  it('tells the owner when the co-host limit is reached', async () => {
    const share = jest.spyOn(Share, 'share');
    mockRpc({ create_co_host_invite: { data: null, error: { message: 'co_host_limit' } } });
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('invite-co-host'));
    expect(await screen.findByTestId('co-host-error')).toHaveTextContent('This event already has the maximum of 5 co-hosts');
    expect(share).not.toHaveBeenCalled();
  });
});

describe('event detail for a co-host', () => {
  beforeEach(() => {
    mockUserId = 'cohost';
  });

  it('hides cancel and co-host management but keeps the shared host tools', async () => {
    await render(<EventDetail />);
    expect(await screen.findByTestId('host-co_host-Erik')).toHaveTextContent(/Erik \(you\)/);
    expect(screen.getByTestId('host-owner-Anna')).toHaveTextContent(/Owner/);
    expect(screen.queryByTestId('cancel-event')).toBeNull();
    expect(screen.queryByTestId('invite-co-host')).toBeNull();
    expect(screen.queryByTestId('remove-co-host-Erik')).toBeNull();
    expect(screen.getByTestId('share')).toBeTruthy();
    expect(screen.getByText('Reset invite link')).toBeTruthy();
    expect(screen.getByTestId('leave-co-host')).toBeTruthy();
  });

  it('leaves after confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('leave-co-host'));
    const buttons = alert.mock.calls[0]![2]!;
    await buttons.find((b) => b.text === 'Leave as co-host')!.onPress!();
    expect(supabase.rpc).toHaveBeenCalledWith('leave_event', { p_event_id: 'e1' });
    expect(router.back).toHaveBeenCalled();
  });

  it('tells a removed co-host and goes back when the event no longer loads', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    mockEvent = null;
    await render(<EventDetail />);
    expect(await screen.findByText("You're no longer a co-host of this event.")).toBeTruthy();
    await waitFor(() => expect(alert).toHaveBeenCalledWith("You're no longer a co-host of this event.", undefined, expect.any(Array)));
    alert.mock.calls[0]![2]![0]!.onPress!();
    expect(router.back).toHaveBeenCalled();
  });
});

describe('event detail layout', () => {
  const rsvp = (id: string, name: string, status: string, plus_ones = 0) => ({
    id,
    event_id: 'e1',
    display_name: name,
    status,
    plus_ones,
    waitlisted_at: status === 'waitlisted' ? inDays(-1) : null,
    created_at: inDays(-2),
  });

  it('shows a compact going/maybe/waitlist summary near the top', async () => {
    mockEvent = { ...baseEvent, capacity: 3 };
    mockRsvps = [rsvp('1', 'Anna', 'going', 2), rsvp('2', 'Bo', 'maybe'), rsvp('3', 'Cai', 'waitlisted', 1)];
    await render(<EventDetail />);
    expect(await screen.findByTestId('guest-summary')).toHaveTextContent(/^3 \/ 3 going · 1 maybe · 2 waitlisted/);
  });

  it('asks clearly before removing a guest and mentions the waitlist', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    mockEvent = { ...baseEvent, capacity: 1 };
    mockRsvps = [rsvp('1', 'Anna', 'going'), rsvp('2', 'Bo', 'waitlisted')];
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('remove-Anna'));
    expect(alert).toHaveBeenCalledWith(
      'Remove Anna?',
      'Anna will be taken off the guest list. A waitlisted guest will be promoted to the free spot.',
      expect.any(Array),
    );
  });
});

describe('series date managed by a group admin (add-groups-and-recurring-events, 9.2, 9.3)', () => {
  const { showActionSheet } = jest.requireMock('@/lib/action-sheet') as { showActionSheet: jest.Mock };

  beforeEach(() => {
    mockEvent = { ...baseEvent, series_id: 's1', group_id: 'g1' };
    mockSeries = { frequency: 'weekly', anchor_local_date: '2026-11-13', ends_on: null };
    mockRsvps = [
      { id: 'r1', display_name: 'Frida', status: 'going', plus_ones: 0, user_id: 'frida', waitlisted_at: null },
      { id: 'r2', display_name: 'Wendy', status: 'going', plus_ones: 0, user_id: null, waitlisted_at: null },
    ];
    mockUserId = 'admin';
  });

  it('gives a group admin owner actions and the series actions, with the group line and not-answered count', async () => {
    mockRpc({
      is_event_owner: { data: true, error: null },
      is_series_admin: { data: true, error: null },
      group_event_summary: { data: { group_name: 'AW crew', not_answered: 7, member_user_ids: ['frida', 'admin'] }, error: null },
    });
    await render(<EventDetail />);
    expect(await screen.findByTestId('event-group-line')).toHaveTextContent('AW crew · Every Friday');
    expect(screen.getByTestId('guest-summary')).toHaveTextContent(/7 not answered/);
    expect(screen.getByTestId('repeat-settings')).toBeTruthy();
    expect(screen.getByTestId('end-series')).toBeTruthy();
    expect(screen.getByTestId('cancel-event')).toBeTruthy();
    expect(screen.queryByTestId('leave-co-host')).toBeNull();
    expect(screen.getByTestId('outside-Wendy')).toHaveTextContent('Guest');
    expect(screen.queryByTestId('outside-Frida')).toBeNull();
  });

  it('ends the series, cancelling planned dates, with end_series', async () => {
    mockRpc({ is_event_owner: { data: true, error: null }, is_series_admin: { data: true, error: null } });
    showActionSheet.mockResolvedValue(1);
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('end-series'));
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('end_series', { p_series_id: 's1', p_cancel_upcoming: true }));
  });

  it('changes the repeat rule with update_series_rule', async () => {
    mockRpc({ is_event_owner: { data: true, error: null }, is_series_admin: { data: true, error: null } });
    showActionSheet.mockResolvedValue(1);
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('repeat-settings'));
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('update_series_rule', { p_series_id: 's1', p_frequency: 'biweekly', p_ends_on: null }),
    );
  });

  it('shows a co-host of only this date neither series actions nor owner actions', async () => {
    mockUserId = 'cohost';
    await render(<EventDetail />);
    expect(await screen.findByTestId('leave-co-host')).toBeTruthy();
    expect(screen.queryByTestId('repeat-settings')).toBeNull();
    expect(screen.queryByTestId('end-series')).toBeNull();
    expect(screen.queryByTestId('cancel-event')).toBeNull();
  });
});
