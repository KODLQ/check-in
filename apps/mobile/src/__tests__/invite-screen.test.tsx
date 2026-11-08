import '@/lib/i18n';

import { render, screen } from '@testing-library/react-native';

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
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: null, profile: null }) }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

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
