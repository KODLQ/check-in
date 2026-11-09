import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Alert } from 'react-native';

import EventDetail from '@/app/events/[id]';
import EditPoll from '@/app/events/[id]/poll';
import InviteInApp from '@/app/i/[token]';
import Events from '@/app/index';
import { supabase } from '@/lib/supabase';

// Date-poll screens (change: add-date-polls, tasks 6.2-6.5) against a table-aware Supabase mock.

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  Stack: { Screen: () => null },
  Link: ({ children }: { children: unknown }) => children,
  useLocalSearchParams: () => ({ id: 'e1', token: 'PollTok12345' }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('@/lib/push', () => ({ maybeAskForPush: jest.fn() }));
jest.mock('@/components/cover', () => {
  const { View } = jest.requireActual('react-native');
  return { Cover: ({ children }: { children: unknown }) => <View>{children as never}</View> };
});
jest.mock('@/components/toast', () => ({ Toast: ({ message }: { message: string | null }) => {
  const { Text } = jest.requireActual('react-native');
  return message ? <Text testID="toast">{message}</Text> : null;
} }));
jest.mock('@/components/story-share-button', () => ({ StoryShareButton: () => null }));
jest.mock('@/components/hosts-card', () => ({ HostsCard: () => null }));
jest.mock('@/lib/events', () => ({
  ...jest.requireActual('@/lib/events'),
  fetchActiveInvite: jest.fn(async () => 'PollTok12345'),
}));
let mockSignedIn = true;
jest.mock('@/lib/auth', () => ({
  useAuth: () =>
    mockSignedIn
      ? { session: { user: { id: 'owner' } }, profile: { display_name: 'Ulla' } }
      : { session: null, profile: null },
}));

let mockTables: Record<string, unknown> = {};
jest.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const result = () => ({ data: mockTables[table] ?? [], error: null });
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'update', 'is', 'gt', 'delete']) b[m] = jest.fn(() => b);
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: jest.fn(builder), channel: () => channel, removeChannel: jest.fn(), rpc: jest.fn() } };
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const pendingEvent = {
  id: 'e1',
  host_id: 'owner',
  title: 'Picnic',
  starts_at: null,
  ends_at: null,
  time_zone: 'Europe/Stockholm',
  location_text: 'Tantolunden',
  latitude: null,
  longitude: null,
  description: null,
  cover_path: null,
  theme: 'sunset',
  cancelled_at: null,
  guest_list_visible: true,
  capacity: 2,
  poll_closes_at: null,
};
const options = [
  { id: 'o1', starts_at: inDays(3), ends_at: null },
  { id: 'o2', starts_at: inDays(4), ends_at: null },
  { id: 'o3', starts_at: inDays(5), ends_at: null },
];
const voters = [
  { id: 'v1', display_name: 'Anna', user_id: null, created_at: inDays(-1),
    date_poll_votes: [{ option_id: 'o1', choice: 'yes' }, { option_id: 'o3', choice: 'yes' }] },
  { id: 'v2', display_name: 'Bo', user_id: null, created_at: inDays(-1),
    date_poll_votes: [{ option_id: 'o1', choice: 'yes' }, { option_id: 'o3', choice: 'no' }] },
  { id: 'v3', display_name: 'Cai', user_id: null, created_at: inDays(-1),
    date_poll_votes: [{ option_id: 'o1', choice: 'yes' }, { option_id: 'o2', choice: 'if_needed' }, { option_id: 'o3', choice: 'yes' }] },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockSignedIn = true;
  mockTables = { events: pendingEvent, date_poll_options: options, date_poll_voters: voters, rsvps: [], event_announcements: [] };
});

describe('host event detail (6.2, 6.3)', () => {
  it('shows "Date TBD", the poll results and no guest list', async () => {
    await render(<EventDetail />);
    expect(await screen.findByTestId('poll-tallies-0')).toHaveTextContent('3 yes · 0 if needed · 0 no');
    expect(screen.getByText('Date TBD')).toBeTruthy();
    expect(screen.getByTestId('poll-leading-0')).toBeTruthy();
    expect(screen.queryByText('Waitlist')).toBeNull();
  });

  it('confirms a pick with the Going / waitlist / Maybe outcome, then calls pick_poll_option', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: { going: 2, waitlisted: 1, maybe: 0 }, error: null });
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('pick-0'));
    const [title, body, buttons] = alert.mock.calls[0]!;
    expect(title).toMatch(/^Pick .+\?$/);
    // Capacity 2: of 3 Yes voters 2 become Going and 1 is waitlisted.
    expect(body).toBe("2 will be Going, 1 on the waitlist and 0 Maybe. Others can still RSVP. This can't be undone.");
    await (buttons as { onPress?: () => Promise<void> }[])[1]!.onPress!();
    expect(supabase.rpc).toHaveBeenCalledWith('pick_poll_option', { p_option_id: 'o1' });
  });

  it('explains a rejected pick', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: null, error: { message: 'already_picked' } });
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('pick-1'));
    await (alert.mock.calls[0]![2] as { onPress?: () => Promise<void> }[])[1]!.onPress!();
    expect(await screen.findByTestId('toast')).toHaveTextContent('A date has already been picked');
  });
});

describe('Edit times (6.3)', () => {
  it('warns how many votes will be deleted before saving', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 2, error: null });
    await render(<EditPoll />);
    // Removing option 3 deletes its 3 votes (Anna yes, Bo no, Cai yes).
    await fireEvent.press(await screen.findByTestId('option-2-remove'));
    await fireEvent.press(screen.getByTestId('save-poll'));
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(alert.mock.calls[0]![0]).toBe('Delete 3 votes?');
    expect(supabase.rpc).not.toHaveBeenCalled();
    await (alert.mock.calls[0]![2] as { onPress?: () => Promise<void> }[])[1]!.onPress!();
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('set_poll_options', expect.objectContaining({ p_event_id: 'e1' })));
    const sent = (supabase.rpc as jest.Mock).mock.calls[0]![1].p_options as { id: string | null }[];
    expect(sent.map((o) => o.id)).toEqual(['o1', 'o2']);
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('saves without a warning when no votes are lost (adding a time)', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: 0, error: null });
    await render(<EditPoll />);
    await fireEvent.press(await screen.findByTestId('add-option'));
    await fireEvent.press(screen.getByTestId('save-poll'));
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('set_poll_options', expect.anything()));
    expect(alert).not.toHaveBeenCalled();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });
});

describe('home list (6.4)', () => {
  const hosted = (over: Record<string, unknown>) => ({
    ...pendingEvent,
    rsvps: [],
    date_poll_voters: [{ count: 0 }],
    date_poll_options: options.map((o) => ({ starts_at: o.starts_at })),
    ...over,
  });

  it('lists a pending event first as "Date TBD · N voted", and marks one that needs a pick', async () => {
    mockTables.events = [
      hosted({ id: 'dated', title: 'Dinner', starts_at: inDays(1), date_poll_voters: [{ count: 0 }], date_poll_options: [] }),
      hosted({ id: 'poll', date_poll_voters: [{ count: 3 }] }),
      hosted({ id: 'closed', title: 'Closed poll', poll_closes_at: inDays(-0.5), date_poll_voters: [{ count: 1 }] }),
    ];
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });
    await render(<Events />);
    expect(await screen.findByTestId('when-poll')).toHaveTextContent('Date TBD');
    expect(screen.getByTestId('event-poll')).toHaveTextContent(/3 voted/);
    const order = screen.getAllByTestId(/^event-/).map((n) => n.props.testID);
    expect(order.indexOf('event-dated')).toBe(2);
    expect(screen.queryByTestId('needs-pick-poll')).toBeNull();
    expect(screen.getByTestId('needs-pick-closed')).toHaveTextContent('Pick a date');
  });
});

describe('in-app invite (6.5)', () => {
  const pendingInvite = (myVotes: unknown = null) => ({
    state: 'date_pending',
    event: { ...pendingEvent, starts_at: null },
    host: { display_name: 'Olga' },
    co_hosts: [],
    poll: {
      closes_at: null,
      expired: false,
      voting_open: true,
      voter_count: 1,
      options: options.slice(0, 2).map((o, i) => ({
        ...o,
        passed: false,
        tallies: { yes: i === 0 ? 1 : 0, if_needed: 0, no: 0 },
        voters: i === 0 ? [{ display_name: 'Anna', choice: 'yes' }] : [],
      })),
    },
    my_votes: myVotes,
    announcements: [],
  });

  it('lets a signed-in user vote with vote_as_user and shows their profile name back', async () => {
    (supabase.rpc as jest.Mock).mockImplementation(async (fn: string) =>
      fn === 'get_invite'
        ? { data: pendingInvite((supabase.rpc as jest.Mock).mock.calls.some(([f]) => f === 'vote_as_user')
            ? { display_name: 'Ulla', votes: { o2: 'yes' } } : null), error: null }
        : { data: { display_name: 'Ulla', votes: { o2: 'yes' } }, error: null },
    );
    await render(<InviteInApp />);
    expect(await screen.findByTestId('poll-tallies-0')).toHaveTextContent('1 yes · 0 if needed · 0 no');
    expect(screen.getByText('Anna')).toBeTruthy();
    expect(screen.queryByTestId('answer-going')).toBeNull();
    await fireEvent.press(screen.getByTestId('vote-1-yes'));
    await fireEvent.press(screen.getByTestId('save-votes'));
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('vote_as_user', {
        p_token: 'PollTok12345',
        p_votes: [{ option_id: 'o2', choice: 'yes' }],
      }),
    );
    expect(await screen.findByTestId('my-votes')).toHaveTextContent(/^Your votes are saved, Ulla\./);
  });

  it('sends signed-out users to the browser to vote', async () => {
    mockSignedIn = false;
    (supabase.rpc as jest.Mock).mockResolvedValue({ data: pendingInvite(), error: null });
    await render(<InviteInApp />);
    expect(await screen.findByTestId('vote-in-browser')).toBeTruthy();
    expect(screen.queryByTestId('vote-0-yes')).toBeNull();
  });
});
