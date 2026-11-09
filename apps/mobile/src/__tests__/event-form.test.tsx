import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { EventForm } from '@/components/event-form';

jest.mock('@/lib/supabase', () => ({ publicUrl: () => null }));

const now = () => new Date('2026-06-01T12:00:00Z');

describe('EventForm', () => {
  it('requires a title and location before submitting', async () => {
    const onSubmit = jest.fn();
    await render(<EventForm submitLabel="Create event" onSubmit={onSubmit} now={now} />);
    await fireEvent.press(screen.getByTestId('submit'));
    expect(await screen.findByText('Give your event a name')).toBeTruthy();
    expect(screen.getByText('Where is it?')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects a start time in the past', async () => {
    const onSubmit = jest.fn();
    await render(
      <EventForm
        submitLabel="Create event"
        onSubmit={onSubmit}
        now={now}
        initial={{ title: 'Late', locationText: 'Here', startsAt: new Date('2026-05-01T18:00:00Z') }}
      />,
    );
    await fireEvent.press(screen.getByTestId('submit'));
    expect(await screen.findByText('Pick a time in the future')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits a minimal event with defaults', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(<EventForm submitLabel="Create event" onSubmit={onSubmit} now={now} />);
    await fireEvent.changeText(screen.getByTestId('title'), 'Fika');
    await fireEvent.changeText(screen.getByTestId('location'), 'Café Pascal');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      title: 'Fika',
      locationText: 'Café Pascal',
      theme: 'sunset',
      guestListVisible: true,
    });
  });

  it('shows server-side errors', async () => {
    const onSubmit = jest.fn().mockResolvedValue('start_in_past');
    await render(<EventForm submitLabel="Create event" onSubmit={onSubmit} now={now} />);
    await fireEvent.changeText(screen.getByTestId('title'), 'Fika');
    await fireEvent.changeText(screen.getByTestId('location'), 'Café Pascal');
    await fireEvent.press(screen.getByTestId('submit'));
    expect(await screen.findByText('Pick a time in the future')).toBeTruthy();
  });

  describe('Guests section (add-guest-capacity)', () => {
    async function fillBasics() {
      await fireEvent.changeText(screen.getByTestId('title'), 'Fika');
      await fireEvent.changeText(screen.getByTestId('location'), 'Café Pascal');
    }

    it('is collapsed and defaults to no plus-ones and no limit', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      await render(<EventForm submitLabel="Create event" onSubmit={onSubmit} now={now} />);
      expect(screen.getByTestId('guests-summary')).toHaveTextContent('No plus-ones · No limit');
      expect(screen.queryByTestId('capacity')).toBeNull();
      await fillBasics();
      await fireEvent.press(screen.getByTestId('submit'));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ allowPlusOnes: false, maxPlusOnes: 1, capacity: null });
    });

    it('sends plus-ones and capacity when set', async () => {
      const onSubmit = jest.fn().mockResolvedValue(undefined);
      await render(<EventForm submitLabel="Create event" onSubmit={onSubmit} now={now} />);
      await fillBasics();
      await fireEvent.press(screen.getByTestId('guests-toggle'));
      await fireEvent(screen.getByTestId('allow-plus-ones'), 'valueChange', true);
      await fireEvent.press(screen.getByTestId('max-plus-ones-increase'));
      await fireEvent.press(screen.getByTestId('max-plus-ones-increase'));
      await fireEvent.changeText(screen.getByTestId('capacity'), '30');
      expect(screen.getByTestId('guests-summary')).toHaveTextContent('Up to +3 each · Max 30');
      await fireEvent.press(screen.getByTestId('submit'));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
      expect(onSubmit.mock.calls[0][0]).toMatchObject({ allowPlusOnes: true, maxPlusOnes: 3, capacity: 30 });
    });

    it('stops the plus-one maximum at 5', async () => {
      await render(<EventForm submitLabel="Create event" onSubmit={jest.fn()} now={now} initial={{ allowPlusOnes: true, maxPlusOnes: 5 }} />);
      await fireEvent.press(screen.getByTestId('guests-toggle'));
      expect(screen.getByTestId('max-plus-ones-increase')).toBeDisabled();
      expect(screen.getByTestId('max-plus-ones-value')).toHaveTextContent('5');
    });

    it.each(['0', '3001', '1.5', 'ten'])('blocks capacity %s', async (value) => {
      const onSubmit = jest.fn();
      await render(<EventForm submitLabel="Create event" onSubmit={onSubmit} now={now} />);
      await fillBasics();
      await fireEvent.press(screen.getByTestId('guests-toggle'));
      await fireEvent.changeText(screen.getByTestId('capacity'), value);
      await fireEvent.press(screen.getByTestId('submit'));
      expect(await screen.findByText('Enter a number from 1 to 3000, or leave it empty')).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('opens the section to show an invalid capacity in an edited event', async () => {
      const onSubmit = jest.fn();
      await render(
        <EventForm
          submitLabel="Save"
          onSubmit={onSubmit}
          now={now}
          initial={{ title: 'Fika', locationText: 'Here', capacity: 0 }}
        />,
      );
      expect(screen.queryByTestId('capacity')).toBeNull();
      await fireEvent.press(screen.getByTestId('submit'));
      expect(await screen.findByTestId('capacity-error')).toHaveTextContent('Enter a number from 1 to 3000, or leave it empty');
      expect(onSubmit).not.toHaveBeenCalled();
    });
  });
});
