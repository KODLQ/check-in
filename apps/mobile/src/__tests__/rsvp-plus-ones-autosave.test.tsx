import '@/lib/i18n';

import type { RsvpStatus } from '@check-in/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useState } from 'react';

import { PLUS_ONES_SAVE_DELAY_MS, RsvpControls, type RsvpInvite } from '@/components/rsvp-controls';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

type Respond = (status: RsvpStatus, plusOnes?: number) => Promise<{ plusOnes: number } | null>;

/** Stands in for the invite screens: busy while the RPC runs, then the reloaded answer. */
function Harness({ initial, save }: { initial: RsvpInvite['my_rsvp']; save: Respond }) {
  const [my, setMy] = useState(initial);
  const [busy, setBusy] = useState(false);
  return (
    <RsvpControls
      invite={{ event: { allow_plus_ones: true, max_plus_ones: 3 }, my_rsvp: my }}
      busy={busy}
      onRespond={(status, plusOnes) => {
        setBusy(true);
        // The RPC and reload take a moment.
        void new Promise((resolve) => setTimeout(resolve, 200))
          .then(() => save(status, plusOnes))
          .then((result) => {
            if (result) setMy({ status: 'going', plus_ones: result.plusOnes });
            setBusy(false);
          });
      }}
    />
  );
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('RsvpControls plus-ones', () => {
  it('saves a stepper change of a guest who is already going (debounced) and confirms it', async () => {
    const save = jest.fn<ReturnType<Respond>, Parameters<Respond>>(async (_s, n) => ({ plusOnes: n ?? 0 }));
    await render(<Harness initial={{ status: 'going', plus_ones: 0 }} save={save} />);
    await fireEvent.press(screen.getByTestId('plus-ones-increase'));
    await fireEvent.press(screen.getByTestId('plus-ones-increase'));
    expect(screen.getByTestId('plus-ones-value')).toHaveTextContent('2');
    expect(screen.getByTestId('plus-ones-status')).toHaveTextContent('Saving…');
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(PLUS_ONES_SAVE_DELAY_MS);
    });
    // One save for both taps.
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith('going', 2);
    await waitFor(() => expect(screen.getByTestId('my-answer')).toHaveTextContent('Your answer: Going +2'));
    expect(screen.getByTestId('plus-ones-status')).toHaveTextContent('Saved ✓');
  });

  it('shows the saved count again when the change is rejected', async () => {
    const save = jest.fn<ReturnType<Respond>, Parameters<Respond>>(async () => null);
    await render(<Harness initial={{ status: 'going', plus_ones: 1 }} save={save} />);
    await fireEvent.press(screen.getByTestId('plus-ones-increase'));
    await act(async () => {
      jest.advanceTimersByTime(PLUS_ONES_SAVE_DELAY_MS);
    });
    await waitFor(() => expect(save).toHaveBeenCalledWith('going', 2));
    await waitFor(() => expect(screen.getByTestId('plus-ones-value')).toHaveTextContent('1'));
    expect(screen.getByTestId('plus-ones-status')).toHaveTextContent('Up to 3');
  });

  it('does not save on its own before the guest has answered Going', async () => {
    const save = jest.fn<ReturnType<Respond>, Parameters<Respond>>(async (_s, n) => ({ plusOnes: n ?? 0 }));
    await render(<Harness initial={{ status: 'maybe' }} save={save} />);
    await fireEvent.press(screen.getByTestId('plus-ones-increase'));
    await act(async () => {
      jest.advanceTimersByTime(PLUS_ONES_SAVE_DELAY_MS * 2);
    });
    expect(save).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('answer-going'));
    await waitFor(() => expect(save).toHaveBeenCalledWith('going', 1));
  });
});
