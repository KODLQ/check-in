import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import NewEvent from '@/app/events/new';
import { EventForm } from '@/components/event-form';
import { supabase } from '@/lib/supabase';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  usePreventRemove: () => () => undefined,
}));
jest.mock('@/lib/supabase', () => ({ publicUrl: () => null, supabase: { rpc: jest.fn(), from: jest.fn() } }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }));
jest.mock('@/lib/push', () => ({ maybeAskForPush: jest.fn() }));
jest.mock('@/lib/upload', () => ({ pickAndUpload: jest.fn() }));

const now = () => new Date('2026-11-09T12:00:00Z');
// Friday 13 Nov 2026, 17:00 local.
const start = new Date(2026, 10, 13, 17, 0);
const groups = [
  { id: 'g1', name: 'AW crew' },
  { id: 'g2', name: 'Padel' },
];

async function fillBasics() {
  await fireEvent.changeText(screen.getByTestId('title'), 'AW');
  await fireEvent.changeText(screen.getByTestId('location'), 'Bar Central');
}

beforeEach(() => jest.clearAllMocks());

describe('Repeat in the event form (9.1)', () => {
  it('is not offered together with a date poll', async () => {
    await render(<EventForm submitLabel="Create" allowPoll allowRepeat groups={groups} onSubmit={jest.fn()} now={now} />);
    expect(screen.getByTestId('repeat-section')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('mode-vote'));
    expect(screen.queryByTestId('repeat-section')).toBeNull();
  });

  it('shows the rule in words and submits the frequency, group and end date', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(
      <EventForm submitLabel="Create" allowRepeat groups={groups} onSubmit={onSubmit} now={now} initial={{ startsAt: start }} />,
    );
    await fillBasics();
    await fireEvent.press(screen.getByTestId('repeat-monthly'));
    expect(screen.getByTestId('repeat-rule')).toHaveTextContent('Second Friday of the month');
    await fireEvent.press(screen.getByTestId('series-group-g2'));
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].repeat).toEqual({ frequency: 'monthly', endsOn: null, groupId: 'g2', newGroupName: null });
  });

  it('asks a user without groups to name a new one', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(<EventForm submitLabel="Create" allowRepeat groups={[]} onSubmit={onSubmit} now={now} initial={{ startsAt: start }} />);
    await fillBasics();
    await fireEvent.press(screen.getByTestId('repeat-weekly'));
    expect(screen.getByTestId('series-new-group-name')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('submit'));
    expect(await screen.findByTestId('series-group-error')).toHaveTextContent(/Give the group a name/);
    await fireEvent.changeText(screen.getByTestId('series-new-group-name'), 'AW crew');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0].repeat).toMatchObject({ frequency: 'weekly', groupId: null, newGroupName: 'AW crew' });
  });

  it('offers inviting a group on a one-off event', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(<EventForm submitLabel="Create" allowRepeat groups={groups} onSubmit={onSubmit} now={now} initial={{ startsAt: start }} />);
    await fillBasics();
    await fireEvent.press(screen.getByTestId('invite-group-g1'));
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ groupId: 'g1' });
    expect(onSubmit.mock.calls[0][0].repeat).toBeUndefined();
  });
});

describe('New event screen (9.1)', () => {
  it('creates a series for the chosen group with create_series', async () => {
    (supabase.rpc as jest.Mock).mockImplementation(async (fn: string) => {
      if (fn === 'list_my_groups') {
        return { data: { groups: [{ id: 'g1', name: 'AW crew', role: 'admin', member_count: 5 }, { id: 'g3', name: 'Book club', role: 'member', member_count: 3 }] } };
      }
      if (fn === 'create_series') return { data: { event_id: 'e1', series_id: 's1', token: 'Tok' }, error: null };
      return { data: null, error: null };
    });
    (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ eq: () => Promise.resolve({ count: 2 }) }) });
    await render(<NewEvent />);
    await screen.findByTestId('repeat-section');
    // Only groups the user owns or administers are offered.
    expect(screen.queryByTestId('series-group-g3')).toBeNull();
    await fillBasics();
    await fireEvent.press(screen.getByTestId('repeat-weekly'));
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith(
        'create_series',
        expect.objectContaining({ p_group_id: 'g1', p_frequency: 'weekly', p_event: expect.objectContaining({ title: 'AW' }) }),
      ),
    );
  });
});
