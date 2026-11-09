import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import InviteInApp from '@/app/i/[token]';
import { supabase } from '@/lib/supabase';

// In-app RSVP with plus-ones and the waitlist (add-guest-capacity, task 5.4).
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ token: 'DemoFredag01' }),
}));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/lib/push', () => ({ maybeAskForPush: jest.fn() }));
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('@/components/cover', () => ({ Cover: () => null }));
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ session: { user: { id: 'u1' } }, profile: { display_name: 'Ulla' } }),
}));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));

const rpc = supabase.rpc as jest.Mock;

type My = { status: string; plus_ones: number; waitlist_position: number | null; promoted: boolean } | null;
const invite = (my: My, full: boolean) => ({
  state: 'active',
  event: {
    title: 'Fredagshäng',
    starts_at: '2030-12-13T18:00:00Z',
    ends_at: null,
    time_zone: 'Europe/Stockholm',
    location_text: 'Hornsgatan 12',
    allow_plus_ones: true,
    max_plus_ones: 2,
    capacity: 4,
  },
  host: { display_name: 'Demo Host' },
  counts: { going: 4, maybe: 0, waitlist: my?.status === 'waitlisted' ? 2 : 0, spots_left: full ? 0 : 1, full },
  my_rsvp: my,
  announcements: [],
});

beforeEach(() => jest.clearAllMocks());

it('a signed-in user on a full event joins the waitlist with plus-ones, then sees the promotion', async () => {
  let state: { my: My; full: boolean } = { my: null, full: true };
  rpc.mockImplementation(async (fn: string, args: { p_plus_ones?: number }) => {
    if (fn === 'rsvp_as_user') {
      state = { my: { status: 'waitlisted', plus_ones: args.p_plus_ones ?? 0, waitlist_position: 1, promoted: false }, full: true };
      return { data: {}, error: null };
    }
    return { data: invite(state.my, state.full), error: null };
  });
  const { rerender } = await render(<InviteInApp />);
  expect(await screen.findByTestId('answer-going')).toHaveTextContent('Full — join waitlist');
  expect(screen.getByTestId('counts')).toHaveTextContent('4 people going · Full');
  await fireEvent.press(screen.getByTestId('plus-ones-increase'));
  await fireEvent.press(screen.getByTestId('answer-going'));
  await waitFor(() => expect(screen.getByTestId('my-answer')).toHaveTextContent("You're on the waitlist — #1"));
  expect(rpc).toHaveBeenCalledWith('rsvp_as_user', { p_token: 'DemoFredag01', p_status: 'going', p_plus_ones: 1 });

  // The host raised capacity: the next load shows the promotion.
  state = { my: { status: 'going', plus_ones: 1, waitlist_position: null, promoted: true }, full: false };
  await rerender(<InviteInApp key="again" />);
  expect(await screen.findByTestId('got-a-spot')).toHaveTextContent('You got a spot!');
  expect(screen.getByTestId('my-answer')).toHaveTextContent('Your answer: Going +1');
  expect(screen.getByTestId('answer-going')).toHaveTextContent('Going');
});

it('shows the plus-one error from the server', async () => {
  rpc.mockImplementation(async (fn: string) =>
    fn === 'rsvp_as_user'
      ? { data: null, error: { message: 'plus_ones_not_allowed' } }
      : { data: invite(null, false), error: null },
  );
  await render(<InviteInApp />);
  await fireEvent.press(await screen.findByTestId('answer-maybe'));
  expect(await screen.findByText("The host isn't allowing plus-ones")).toBeTruthy();
});
