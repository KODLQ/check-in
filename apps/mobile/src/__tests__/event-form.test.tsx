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
});
