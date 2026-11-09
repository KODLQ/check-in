import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { EventForm } from '@/components/event-form';
import { PollResults } from '@/components/poll-results';
import type { HostPoll } from '@/lib/polls';
import { toPollEventArgs } from '@/lib/events';

// Date polls in the host app (change: add-date-polls, tasks 6.1-6.3). Screens with Supabase are covered in
// date-poll-screens.test.tsx.

jest.mock('@/lib/supabase', () => ({ publicUrl: () => null, supabase: {} }));

const now = () => new Date('2026-06-01T12:00:00Z');
const at = (iso: string) => new Date(iso);

async function fillBasics() {
  await fireEvent.changeText(screen.getByTestId('title'), 'Picnic');
  await fireEvent.changeText(screen.getByTestId('location'), 'Tantolunden');
}

describe('EventForm: Let guests vote (6.1)', () => {
  it('switches between a fixed date and two default options', async () => {
    await render(<EventForm submitLabel="Create event" onSubmit={jest.fn()} now={now} allowPoll />);
    expect(screen.getByTestId('starts-at')).toBeTruthy();
    expect(screen.queryByTestId('poll-options')).toBeNull();
    await fireEvent.press(screen.getByTestId('mode-vote'));
    expect(screen.queryByTestId('starts-at')).toBeNull();
    expect(screen.getByTestId('option-0-start')).toBeTruthy();
    expect(screen.getByTestId('option-1-start')).toBeTruthy();
    expect(screen.queryByTestId('option-2-start')).toBeNull();
    // At the minimum of 2 no option can be removed; a third can be added and removed again.
    expect(screen.queryByTestId('option-0-remove')).toBeNull();
    await fireEvent.press(screen.getByTestId('add-option'));
    expect(screen.getByTestId('option-2-start')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('option-2-remove'));
    expect(screen.queryByTestId('option-2-start')).toBeNull();
    await fireEvent.press(screen.getByTestId('mode-fixed'));
    expect(screen.getByTestId('starts-at')).toBeTruthy();
  });

  it('offers at most 4 options', async () => {
    await render(<EventForm submitLabel="Create event" onSubmit={jest.fn()} now={now} allowPoll />);
    await fireEvent.press(screen.getByTestId('mode-vote'));
    await fireEvent.press(screen.getByTestId('add-option'));
    await fireEvent.press(screen.getByTestId('add-option'));
    expect(screen.getByTestId('option-3-start')).toBeTruthy();
    expect(screen.queryByTestId('add-option')).toBeNull();
  });

  it('submits the options and deadline as a poll', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(
      <EventForm
        submitLabel="Create event"
        onSubmit={onSubmit}
        now={now}
        allowPoll
        initial={{
          poll: {
            options: [{ startsAt: at('2026-06-05T17:00:00Z'), endsAt: at('2026-06-05T21:00:00Z') }, { startsAt: at('2026-06-06T17:00:00Z') }],
            closesAt: at('2026-06-04T12:00:00Z'),
          },
        }}
      />,
    );
    await fillBasics();
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const values = onSubmit.mock.calls[0][0];
    expect(values.poll).toEqual({
      options: [{ startsAt: at('2026-06-05T17:00:00Z'), endsAt: at('2026-06-05T21:00:00Z') }, { startsAt: at('2026-06-06T17:00:00Z') }],
      closesAt: at('2026-06-04T12:00:00Z'),
    });
    expect(toPollEventArgs(values)).toMatchObject({
      p_event: { title: 'Picnic', location_text: 'Tantolunden' },
      p_options: [
        { starts_at: '2026-06-05T17:00:00.000Z', ends_at: '2026-06-05T21:00:00.000Z' },
        { starts_at: '2026-06-06T17:00:00.000Z', ends_at: null },
      ],
      p_closes_at: '2026-06-04T12:00:00.000Z',
    });
    expect(toPollEventArgs(values).p_event).not.toHaveProperty('starts_at');
  });

  it.each([
    [
      'an option in the past',
      [{ startsAt: at('2026-06-05T17:00:00Z') }, { startsAt: at('2026-05-01T17:00:00Z') }],
      null,
      'option-1-start-error',
      'Pick a time in the future',
    ],
    [
      'duplicate options',
      [{ startsAt: at('2026-06-05T17:00:00Z') }, { startsAt: at('2026-06-05T17:00:00Z') }],
      null,
      'option-1-start-error',
      'Two options have the same time',
    ],
    [
      'an option ending before it starts',
      [{ startsAt: at('2026-06-05T17:00:00Z'), endsAt: at('2026-06-05T16:00:00Z') }, { startsAt: at('2026-06-06T17:00:00Z') }],
      null,
      'option-0-end-error',
      'End must be after the start',
    ],
    [
      'a deadline after the first option',
      [{ startsAt: at('2026-06-05T17:00:00Z') }, { startsAt: at('2026-06-06T17:00:00Z') }],
      at('2026-06-05T18:00:00Z'),
      'deadline-error',
      'The deadline must be in the future and before the first option',
    ],
    ['too few options', [{ startsAt: at('2026-06-05T17:00:00Z') }], null, 'poll-error', 'A poll needs 2 to 4 times'],
  ])('shows a validation message for %s', async (_label, options, closesAt, errorId, message) => {
    const onSubmit = jest.fn();
    await render(
      <EventForm
        submitLabel="Create event"
        onSubmit={onSubmit}
        now={now}
        allowPoll
        initial={{ poll: { options, closesAt } }}
      />,
    );
    await fillBasics();
    await fireEvent.press(screen.getByTestId('submit'));
    expect(await screen.findByTestId(errorId)).toHaveTextContent(message);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('hides the date fields when editing a date-pending event', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(
      <EventForm submitLabel="Save" onSubmit={onSubmit} now={now} datePending initial={{ title: 'Picnic', locationText: 'Here' }} />,
    );
    expect(screen.queryByTestId('starts-at')).toBeNull();
    expect(screen.queryByTestId('mode-vote')).toBeNull();
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });
});

describe('PollResults (6.2)', () => {
  const poll: HostPoll = {
    options: [
      { id: 'o1', starts_at: '2030-06-05T17:00:00Z', ends_at: null },
      { id: 'o2', starts_at: '2030-06-06T17:00:00Z', ends_at: null },
    ],
    voters: [
      { id: 'v1', display_name: 'Anna', user_id: null, created_at: '2030-06-01T10:00:00Z',
        date_poll_votes: [{ option_id: 'o1', choice: 'yes' }, { option_id: 'o2', choice: 'yes' }] },
      { id: 'v2', display_name: 'Bo', user_id: null, created_at: '2030-06-01T10:01:00Z',
        date_poll_votes: [{ option_id: 'o1', choice: 'no' }, { option_id: 'o2', choice: 'if_needed' }] },
      { id: 'v3', display_name: 'Cai', user_id: 'u3', created_at: '2030-06-01T10:02:00Z',
        date_poll_votes: [{ option_id: 'o2', choice: 'yes' }] },
    ],
  };

  it('shows tallies, every answer including No, and highlights the leading option', async () => {
    const onPick = jest.fn();
    const onRemoveVoter = jest.fn();
    await render(
      <PollResults
        poll={poll}
        timeZone="Europe/Stockholm"
        closesAt={null}
        editable
        onPick={onPick}
        onRemoveVoter={onRemoveVoter}
        onEdit={jest.fn()}
        now={new Date('2030-06-01T12:00:00Z')}
      />,
    );
    expect(screen.getByTestId('poll-voter-count')).toHaveTextContent('3 voted');
    expect(screen.getByTestId('poll-tallies-0')).toHaveTextContent('1 yes · 0 if needed · 1 no');
    expect(screen.getByTestId('poll-tallies-1')).toHaveTextContent('2 yes · 1 if needed · 0 no');
    expect(screen.getByTestId('poll-names-0-no')).toHaveTextContent('No: Bo');
    expect(screen.getByTestId('poll-names-1-yes')).toHaveTextContent('Yes: Anna, Cai');
    expect(screen.getByTestId('poll-leading-1')).toHaveTextContent('Most yes');
    expect(screen.queryByTestId('poll-leading-0')).toBeNull();

    await fireEvent.press(screen.getByTestId('pick-1'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining(poll.options[1]));
    await fireEvent.press(screen.getByTestId('remove-voter-1'));
    expect(onRemoveVoter).toHaveBeenCalledWith(poll.voters[1]);
  });

  it('offers no Pick for a passed option and nothing to change on a cancelled poll', async () => {
    const props = {
      poll,
      timeZone: 'Europe/Stockholm',
      closesAt: '2030-06-05T10:00:00Z',
      onPick: jest.fn(),
      onRemoveVoter: jest.fn(),
      onEdit: jest.fn(),
      now: new Date('2030-06-05T18:00:00Z'),
    };
    const { rerender } = await render(<PollResults {...props} editable />);
    expect(screen.queryByTestId('pick-0')).toBeNull();
    expect(screen.getByTestId('pick-1')).toBeTruthy();
    expect(screen.getByText('Voting has closed. The host will pick a date soon.')).toBeTruthy();
    await rerender(<PollResults {...props} editable={false} />);
    expect(screen.queryByTestId('pick-1')).toBeNull();
    expect(screen.queryByTestId('edit-poll')).toBeNull();
    expect(screen.queryByTestId('remove-voter-0')).toBeNull();
  });
});
