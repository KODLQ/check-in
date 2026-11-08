import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import MyInviteScreen from '@/app/invites/[eventId]';
import { supabase } from '@/lib/supabase';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), back: jest.fn() },
    useLocalSearchParams: () => ({ eventId: 'ev-1' }),
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('@/components/cover', () => ({ Cover: () => null }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'user-1' } } }) }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));

const rpc = supabase.rpc as jest.Mock;

const detail = (state: string, status = 'maybe') => ({
  state,
  event: {
    title: 'Lina birthday',
    starts_at: '2030-12-13T18:00:00Z',
    ends_at: null,
    time_zone: 'Europe/Stockholm',
    location_text: 'Hornsgatan 12',
  },
  host: { display_name: 'Lina' },
  counts: { going: 2, maybe: 1 },
  guests: [{ display_name: 'Sara B', status }],
  my_rsvp: { status, display_name: 'Sara B' },
  announcements: [],
});

beforeEach(() => jest.clearAllMocks());

describe('my invite screen', () => {
  it('shows the own answer and changes it with set_my_rsvp', async () => {
    let status = 'maybe';
    rpc.mockImplementation(async (fn: string, args: { p_status?: string }) => {
      if (fn === 'set_my_rsvp') status = args.p_status!;
      return { data: fn === 'get_my_invite' ? detail('active', status) : { status }, error: null };
    });
    await render(<MyInviteScreen />);
    expect(await screen.findByTestId('my-answer')).toHaveTextContent('Your answer: Maybe');
    expect(screen.getByText('📍 Hornsgatan 12')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('answer-going'));
    await waitFor(() =>
      expect(screen.getByTestId('my-answer')).toHaveTextContent('Your answer: Going'),
    );
    expect(rpc).toHaveBeenCalledWith('set_my_rsvp', { p_event_id: 'ev-1', p_status: 'going' });
  });

  it.each(['cancelled', 'past'])('hides the answer buttons when the event is %s', async (state) => {
    rpc.mockResolvedValue({ data: detail(state, 'going'), error: null });
    await render(<MyInviteScreen />);
    expect(await screen.findByTestId('my-answer')).toHaveTextContent('Your answer: Going');
    expect(screen.queryByTestId('answer-going')).toBeNull();
    expect(screen.queryByTestId('withdraw')).toBeNull();
  });

  it('withdraws through a self-delete and navigates back', async () => {
    rpc.mockResolvedValue({ data: detail('active'), error: null });
    const eqUser = jest.fn().mockResolvedValue({ error: null });
    const eqEvent = jest.fn(() => ({ eq: eqUser }));
    (supabase.from as jest.Mock).mockReturnValue({ delete: () => ({ eq: eqEvent }) });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      void buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });

    await render(<MyInviteScreen />);
    await fireEvent.press(await screen.findByTestId('withdraw'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(supabase.from).toHaveBeenCalledWith('rsvps');
    expect(eqEvent).toHaveBeenCalledWith('event_id', 'ev-1');
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-1');
    alert.mockRestore();
  });

  it('shows not found for an event the user has not answered', async () => {
    rpc.mockResolvedValue({ data: { state: 'not_found' }, error: null });
    await render(<MyInviteScreen />);
    expect(await screen.findByText('Invite not found')).toBeTruthy();
  });
});
