import '@/lib/i18n';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, screen } from '@testing-library/react-native';

import Events from '@/app/index';
import { supabase } from '@/lib/supabase';
import { router } from 'expo-router';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), replace: jest.fn() },
    Stack: { Screen: () => null },
    Link: ({ children }: { children: unknown }) => children,
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('@/components/cover', () => {
  const { View } = jest.requireActual('react-native');
  return { Cover: ({ children }: { children: unknown }) => <View>{children as never}</View> };
});
jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();

const hostedEvent = (id: string, title: string, offsetDays: number, hostId = 'me') => ({
  id,
  host_id: hostId,
  title,
  starts_at: iso(offsetDays),
  ends_at: null,
  time_zone: 'Europe/Stockholm',
  cover_path: null,
  theme: 'sunset',
  cancelled_at: null,
  rsvps: [{ status: 'going' }, { status: 'maybe' }],
});
const invite = (
  id: string,
  title: string,
  offsetDays: number,
  status: string,
  state = 'active',
) => ({
  id,
  title,
  starts_at: iso(offsetDays),
  ends_at: null,
  time_zone: 'Europe/Stockholm',
  cover_path: null,
  theme: 'sunset',
  state,
  host: { display_name: 'Lina' },
  my_rsvp: { status, display_name: 'Sara B' },
});

function mockData(hosted: unknown[], invites: unknown[]) {
  const order = jest.fn().mockResolvedValue({ data: hosted, error: null });
  (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ order }) });
  (supabase.rpc as jest.Mock).mockResolvedValue({ data: invites, error: null });
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('home list', () => {
  it('renders hosted and invite cards together with answers and badges', async () => {
    mockData(
      [hostedEvent('h1', 'My dinner', 3)],
      [
        invite('i1', 'Lina birthday', 1, 'maybe'),
        invite('i2', 'Old party', -5, 'going', 'past'),
        invite('i3', 'Called off', 2, 'going', 'cancelled'),
      ],
    );
    await render(<Events />);
    expect(await screen.findByTestId('invite-i1')).toHaveTextContent(
      /Hosted by Lina · Your answer: Maybe/,
    );
    expect(screen.getByTestId('event-h1')).toHaveTextContent(/1 going · 1 maybe/);
    expect(screen.getByTestId('event-h1')).toHaveTextContent(/Hosting/);
    expect(screen.getByTestId('invite-i1')).toHaveTextContent(/Invite/);
    expect(screen.getByTestId('past-i2')).toBeTruthy();
    expect(screen.getByTestId('cancelled-i3')).toBeTruthy();
    expect(supabase.rpc).toHaveBeenCalledWith('list_my_invites');

    // Upcoming soonest first (invite, cancelled invite, hosted), then past.
    const order = screen.getAllByTestId(/^(event|invite)-/).map((n) => n.props.testID);
    expect(order).toEqual(['invite-i1', 'invite-i3', 'event-h1', 'invite-i2']);
    expect(screen.queryByTestId('plan-own-card')).toBeNull();

    await fireEvent.press(screen.getByTestId('invite-i1'));
    expect(router.push).toHaveBeenCalledWith('/invites/i1');
    await fireEvent.press(screen.getByTestId('event-h1'));
    expect(router.push).toHaveBeenCalledWith('/events/h1');
  });

  it('shows the empty state with a single create button and a note about invites', async () => {
    mockData([], []);
    await render(<Events />);
    expect(await screen.findByTestId('events-empty')).toBeTruthy();
    expect(screen.getByText('Invites you get show up here too.')).toBeTruthy();
    expect(screen.queryByTestId('empty-plan-own')).toBeNull();
    await fireEvent.press(screen.getByTestId('new-event'));
    expect(router.push).toHaveBeenCalledWith('/events/new');
  });

  it('shows the Plan your own card with invites but no upcoming hosted events, and dismissal hides it', async () => {
    mockData([hostedEvent('h0', 'Last month', -30)], [invite('i1', 'Lina birthday', 1, 'going')]);
    await render(<Events />);
    expect(await screen.findByTestId('plan-own-card')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('plan-own-cta'));
    expect(router.push).toHaveBeenCalledWith('/events/new');

    await fireEvent.press(screen.getByTestId('plan-own-dismiss'));
    expect(screen.queryByTestId('plan-own-card')).toBeNull();
    expect(await AsyncStorage.getItem('ci_plan_card_dismissed_at')).toBeTruthy();
  });

  it('keeps the card hidden within 7 days of dismissal', async () => {
    await AsyncStorage.setItem('ci_plan_card_dismissed_at', String(Date.now() - 2 * DAY));
    mockData([], [invite('i1', 'Lina birthday', 1, 'going')]);
    await render(<Events />);
    expect(await screen.findByTestId('invite-i1')).toBeTruthy();
    expect(screen.queryByTestId('plan-own-card')).toBeNull();
  });

  it('shows the card again after 7 days', async () => {
    await AsyncStorage.setItem('ci_plan_card_dismissed_at', String(Date.now() - 8 * DAY));
    mockData([], [invite('i1', 'Lina birthday', 1, 'going')]);
    await render(<Events />);
    expect(await screen.findByTestId('plan-own-card')).toBeTruthy();
  });

  it('does not show the card when the user hosts an upcoming event', async () => {
    mockData([hostedEvent('h1', 'My dinner', 3)], [invite('i1', 'Lina birthday', 1, 'going')]);
    await render(<Events />);
    expect(await screen.findByTestId('invite-i1')).toBeTruthy();
    expect(screen.queryByTestId('plan-own-card')).toBeNull();
  });

  it('labels co-hosted events "Co-host" among the hosted events, in start-time order', async () => {
    mockData(
      [hostedEvent('h1', 'My dinner', 3), hostedEvent('h2', 'Anna party', 2, 'anna')],
      [invite('h2', 'Anna party', 2, 'going')],
    );
    await render(<Events />);
    expect(await screen.findByTestId('event-h2')).toHaveTextContent(/Co-host/);
    expect(screen.getByTestId('cohost-h2')).toBeTruthy();
    expect(screen.getByTestId('event-h2')).toHaveTextContent(/1 going · 1 maybe/);
    expect(screen.getByTestId('event-h1')).toHaveTextContent(/Hosting/);
    expect(screen.queryByTestId('cohost-h1')).toBeNull();
    // Shown once, as hosted, never also as an invite.
    expect(screen.queryByTestId('invite-h2')).toBeNull();
    const order = screen.getAllByTestId(/^(event|invite)-/).map((n) => n.props.testID);
    expect(order).toEqual(['event-h2', 'event-h1']);
    await fireEvent.press(screen.getByTestId('event-h2'));
    expect(router.push).toHaveBeenCalledWith('/events/h2');
  });

  it('counts Going heads with plus-ones, against the capacity when set (add-guest-capacity)', async () => {
    const tenPlusFour = [
      ...Array.from({ length: 10 }, (_, i) => ({ status: 'going', plus_ones: i < 4 ? 1 : 0 })),
      { status: 'waitlisted', plus_ones: 2 },
      { status: 'maybe', plus_ones: 0 },
    ];
    mockData(
      [
        { ...hostedEvent('h1', 'Flat party', 3), capacity: 30, rsvps: tenPlusFour },
        { ...hostedEvent('h2', 'Open picnic', 4), capacity: null, rsvps: [{ status: 'going', plus_ones: 2 }] },
      ],
      [
        { ...invite('i1', 'Lina birthday', 1, 'going'), my_rsvp: { status: 'going', display_name: 'S', plus_ones: 2 } },
        invite('i2', 'Small dinner', 2, 'waitlisted'),
      ],
    );
    await render(<Events />);
    expect(await screen.findByTestId('event-h1')).toHaveTextContent(/14 \/ 30 going · 1 maybe/);
    expect(screen.getByTestId('event-h2')).toHaveTextContent(/3 going · 0 maybe/);
    expect(screen.getByTestId('invite-i1')).toHaveTextContent(/Your answer: Going \+2/);
    expect(screen.getByTestId('invite-i2')).toHaveTextContent(/Your answer: Waitlist/);
  });

  it('resumes a co-host link that was opened before signing in', async () => {
    const token = 'AbCdEfGhIjKlMnOpQrStUv';
    await AsyncStorage.setItem('ci_pending_co_host', JSON.stringify({ token, savedAt: Date.now() }));
    mockData([], []);
    await render(<Events />);
    await screen.findByTestId('events-empty');
    expect(router.push).toHaveBeenCalledWith(`/c/${token}`);
    expect(await AsyncStorage.getItem('ci_pending_co_host')).toBeNull();
  });
});

describe('series and group invites (add-groups-and-recurring-events, 9.3)', () => {
  const weekly = { frequency: 'weekly', anchor_local_date: '2026-11-13' };

  it('shows a managed series as its next date with the group and rule, opening all dates', async () => {
    mockData(
      [
        { ...hostedEvent('d1', 'AW', 1, 'anna'), series_id: 's1', event_series: weekly, groups: { name: 'AW crew' } },
        { ...hostedEvent('d2', 'AW', 8, 'anna'), series_id: 's1', event_series: weekly, groups: { name: 'AW crew' } },
      ],
      [],
    );
    await render(<Events />);
    expect(await screen.findByTestId('event-d1')).toBeTruthy();
    expect(screen.queryByTestId('event-d2')).toBeNull();
    expect(screen.getByTestId('series-line-d1')).toHaveTextContent('AW crew · Every Friday');
    await fireEvent.press(screen.getByTestId('event-d1'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/series/[id]', params: { id: 's1', kind: 'hosted' } });
  });

  it('marks a group invite as not answered and counts later unanswered dates', async () => {
    const groupInvite = (id: string, days: number, answered: boolean) => ({
      ...invite(id, 'AW', days, 'going'),
      my_rsvp: answered ? { status: 'going', display_name: 'Me' } : null,
      group: { id: 'g1', name: 'AW crew' },
      series: { id: 's1', ...weekly },
    });
    mockData([], [groupInvite('i1', 1, false), groupInvite('i2', 8, false), groupInvite('i3', 15, true)]);
    await render(<Events />);
    // The series line names the group, so the first line only carries the answer (it no longer gets cut off).
    expect(await screen.findByText('Your answer: Not answered yet')).toBeTruthy();
    expect(screen.getByTestId('series-line-i1')).toHaveTextContent('AW crew · Every Friday · 1 more date not answered');
    expect(screen.queryByTestId('invite-i2')).toBeNull();
  });
});
