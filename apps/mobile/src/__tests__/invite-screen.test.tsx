import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Linking } from 'react-native';

import InviteInApp from '@/app/i/[token]';
import { supabase } from '@/lib/supabase';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ token: 'DemoFredag01' }),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('@/components/cover', () => ({ Cover: () => null }));
let mockAuth: { session: unknown; profile: unknown } = { session: null, profile: null };
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
let mockManagedEventId: string | null = null;
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(() => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: mockManagedEventId ? { event_id: mockManagedEventId } : null, error: null });
      return b;
    }),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { session: null, profile: null };
  mockManagedEventId = null;
});

const fixture = (state: string, announcements?: unknown[]) => ({
  state,
  event: {
    title: 'Fredagshäng',
    starts_at: '2030-12-13T18:00:00Z',
    ends_at: null,
    time_zone: 'Europe/Stockholm',
    location_text: 'Hornsgatan 12',
  },
  host: { display_name: 'Demo Host' },
  counts: { going: 2, maybe: 1 },
  my_rsvp: null,
  announcements,
});

describe('in-app invite announcements', () => {
  it('shows announcements newest first', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({
      data: fixture('active', [
        { id: 'b', body: 'Bring a jacket', created_at: new Date().toISOString() },
        { id: 'a', body: 'Doors open 19:30', created_at: new Date(Date.now() - 86_400_000).toISOString() },
      ]),
    });
    await render(<InviteInApp />);
    expect(await screen.findByText('Updates from the host')).toBeTruthy();
    const items = screen.getAllByTestId('announcement');
    expect(items[0]).toHaveTextContent(/Bring a jacket/);
    expect(items[1]).toHaveTextContent(/Doors open 19:30.*yesterday/);
  });

  it('shows none for a cancelled invite', async () => {
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: { state: 'cancelled', event: { title: 'Fredagshäng' } } });
    await render(<InviteInApp />);
    expect(await screen.findByText('This event has been cancelled.')).toBeTruthy();
    expect(screen.queryByText('Updates from the host')).toBeNull();
  });
});

describe('in-app invite for hosts', () => {
  it('sends a host or co-host opening their own invite link to the host view', async () => {
    mockAuth = { session: { user: { id: 'host-1' } }, profile: { display_name: 'Demo Host' } };
    mockManagedEventId = 'ev-9';
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: fixture('active') });
    await render(<InviteInApp />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/events/ev-9'));
    expect(screen.queryByTestId('answer-going')).toBeNull();
  });

  it('shows the guest view to a signed-in guest', async () => {
    mockAuth = { session: { user: { id: 'guest-1' } }, profile: { display_name: 'Gina' } };
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: fixture('active') });
    await render(<InviteInApp />);
    expect(await screen.findByText('Fredagshäng')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('opens the location in maps', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: fixture('active') });
    await render(<InviteInApp />);
    await fireEvent.press(await screen.findByTestId('invite-location'));
    expect(open).toHaveBeenCalledWith(expect.stringContaining('Hornsgatan'));
  });
});
