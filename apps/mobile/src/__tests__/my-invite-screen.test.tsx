import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import MyInviteScreen from '@/app/invites/[eventId]';
import { supabase } from '@/lib/supabase';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
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
  it('sends the host or a co-host to the host view instead of the guest view', async () => {
    (supabase.from as jest.Mock).mockReturnValueOnce({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'ev-1' }, error: null }) }) }),
    });
    await render(<MyInviteScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/events/ev-1'));
    expect(rpc).not.toHaveBeenCalledWith('get_my_invite', expect.anything());
  });

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

  it('withdraws through remove_rsvp (so a freed spot goes to the waitlist) and navigates back', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'remove_rsvp' ? { data: true, error: null } : { data: detail('active'), error: null },
    );
    const eqUser = jest.fn(() => ({ maybeSingle: async () => ({ data: { id: 'r-1' }, error: null }) }));
    const eqEvent = jest.fn(() => ({ eq: eqUser }));
    (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ eq: eqEvent }) });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      void buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });

    await render(<MyInviteScreen />);
    await fireEvent.press(await screen.findByTestId('withdraw'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(supabase.from).toHaveBeenCalledWith('rsvps');
    expect(eqEvent).toHaveBeenCalledWith('event_id', 'ev-1');
    expect(eqUser).toHaveBeenCalledWith('user_id', 'user-1');
    expect(rpc).toHaveBeenCalledWith('remove_rsvp', { p_rsvp_id: 'r-1' });
    alert.mockRestore();
  });

  it('Going on a full event joins the waitlist and shows the position (add-guest-capacity)', async () => {
    let status = 'maybe';
    rpc.mockImplementation(async (fn: string, args: { p_status?: string }) => {
      if (fn === 'set_my_rsvp') status = args.p_status === 'going' ? 'waitlisted' : args.p_status!;
      const d = detail('active', status);
      return {
        data:
          fn === 'get_my_invite'
            ? {
                ...d,
                counts: { going: 4, maybe: 1, waitlist: status === 'waitlisted' ? 1 : 0, spots_left: 0, full: true },
                my_rsvp: { status, display_name: 'Sara B', plus_ones: 0, waitlist_position: status === 'waitlisted' ? 1 : null, promoted: false },
              }
            : { status },
        error: null,
      };
    });
    await render(<MyInviteScreen />);
    expect(await screen.findByTestId('answer-going')).toHaveTextContent('Full — join waitlist');
    expect(screen.getByTestId('counts')).toHaveTextContent('4 people going · Full');
    await fireEvent.press(screen.getByTestId('answer-going'));
    await waitFor(() => expect(screen.getByTestId('my-answer')).toHaveTextContent("You're on the waitlist — #1"));
    expect(screen.getByTestId('counts')).toHaveTextContent('4 people going · Full · 1 on the waitlist');
  });

  it('sends plus-ones with Going, shows "Going +2" and "You got a spot!"', async () => {
    let plus = 0;
    rpc.mockImplementation(async (fn: string, args: { p_plus_ones?: number }) => {
      if (fn === 'set_my_rsvp') plus = args.p_plus_ones ?? plus;
      const d = detail('active', 'going');
      return {
        data:
          fn === 'get_my_invite'
            ? {
                ...d,
                event: { ...d.event, allow_plus_ones: true, max_plus_ones: 2 },
                my_rsvp: { status: 'going', display_name: 'Sara B', plus_ones: plus, waitlist_position: null, promoted: plus === 0 },
              }
            : {},
        error: null,
      };
    });
    await render(<MyInviteScreen />);
    expect(await screen.findByTestId('got-a-spot')).toHaveTextContent('You got a spot!');
    await fireEvent.press(screen.getByTestId('plus-ones-increase'));
    await fireEvent.press(screen.getByTestId('plus-ones-increase'));
    expect(screen.getByTestId('plus-ones-increase')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('answer-going'));
    await waitFor(() => expect(screen.getByTestId('my-answer')).toHaveTextContent('Your answer: Going +2'));
    expect(rpc).toHaveBeenCalledWith('set_my_rsvp', { p_event_id: 'ev-1', p_status: 'going', p_plus_ones: 2 });
    expect(screen.queryByTestId('got-a-spot')).toBeNull();
  });

  it('shows how many spots are left when more plus-ones do not fit', async () => {
    rpc.mockImplementation(async (fn: string) => {
      const d = detail('active', 'going');
      if (fn === 'set_my_rsvp') return { data: null, error: { message: 'capacity_exceeded', details: '1' } };
      return {
        data: { ...d, event: { ...d.event, allow_plus_ones: true, max_plus_ones: 3 }, my_rsvp: { status: 'going', display_name: 'S', plus_ones: 0 } },
        error: null,
      };
    });
    await render(<MyInviteScreen />);
    await fireEvent.press(await screen.findByTestId('plus-ones-increase'));
    await fireEvent.press(screen.getByTestId('plus-ones-increase'));
    await fireEvent.press(screen.getByTestId('answer-going'));
    expect(await screen.findByText("Only 1 spot left. Your answer wasn't changed.")).toBeTruthy();
  });

  it('shows not found for an event the user has not answered', async () => {
    rpc.mockResolvedValue({ data: { state: 'not_found' }, error: null });
    await render(<MyInviteScreen />);
    expect(await screen.findByText('Invite not found')).toBeTruthy();
  });
});

describe('group invites (add-groups-and-recurring-events, 9.4)', () => {
  const notManager = () =>
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
    });
  const groupDetail = (answered: boolean) => ({
    ...detail('active', 'going'),
    my_rsvp: answered ? { status: 'going', display_name: 'Sara B' } : null,
    group: { name: 'AW crew' },
    series: {
      frequency: 'weekly',
      anchor_local_date: '2030-12-13',
      next: { event_id: 'ev-2', starts_at: '2030-12-20T18:00:00Z', token: 'NextDate0001' },
    },
  });

  it('shows a series date not answered yet, with the group as host and the rule, and gives a first answer', async () => {
    notManager();
    let answered = false;
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'set_my_rsvp') answered = true;
      return { data: fn === 'get_my_invite' ? groupDetail(answered) : { status: 'going' }, error: null };
    });
    await render(<MyInviteScreen />);
    expect(await screen.findByTestId('not-answered')).toHaveTextContent('Not answered yet');
    expect(screen.getByText(/AW crew · Lina/)).toBeTruthy();
    expect(screen.getByTestId('invite-series-rule')).toHaveTextContent('Every Friday');
    expect(screen.queryByTestId('withdraw')).toBeNull();
    await fireEvent.press(screen.getByTestId('answer-going'));
    expect(rpc).toHaveBeenCalledWith('set_my_rsvp', { p_event_id: 'ev-1', p_status: 'going' });
    await waitFor(() => expect(screen.queryByTestId('not-answered')).toBeNull());
    expect(screen.getByTestId('withdraw')).toBeTruthy();
  });

  it('withdrawing goes back so the date shows as not answered again', async () => {
    notManager();
    rpc.mockImplementation(async (fn: string) =>
      fn === 'remove_rsvp' ? { data: true, error: null } : { data: groupDetail(true), error: null },
    );
    (supabase.from as jest.Mock).mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null, error: null }),
          eq: () => ({ maybeSingle: async () => ({ data: { id: 'r1' }, error: null }) }),
        }),
      }),
    });
    const alert = jest.spyOn(Alert, 'alert');
    await render(<MyInviteScreen />);
    await fireEvent.press(await screen.findByTestId('withdraw'));
    await alert.mock.calls.at(-1)![2]!.at(-1)!.onPress!();
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('remove_rsvp', { p_rsvp_id: 'r1' }));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('links to the next date', async () => {
    notManager();
    rpc.mockResolvedValue({ data: groupDetail(true), error: null });
    await render(<MyInviteScreen />);
    await fireEvent.press(await screen.findByTestId('next-date'));
    expect(router.push).toHaveBeenCalledWith('/i/NextDate0001');
  });
});
