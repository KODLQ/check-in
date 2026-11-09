import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { usePreventRemove } from 'expo-router';
import { Alert, Pressable, Text } from 'react-native';

import { EventForm, formSnapshot } from '@/components/event-form';
import { useDiscardGuard } from '@/lib/use-discard-guard';

jest.mock('@/lib/supabase', () => ({ publicUrl: () => null }));
jest.mock('expo-router', () => ({ usePreventRemove: jest.fn(() => jest.fn()) }));

const now = () => new Date('2026-06-01T12:00:00Z');
const preventRemove = usePreventRemove as jest.Mock;

beforeEach(() => jest.clearAllMocks());

describe('unsaved changes', () => {
  it('formSnapshot ignores surrounding whitespace and compares dates by value', () => {
    const d = new Date('2026-06-02T17:00:00Z');
    expect(formSnapshot({ title: 'Fika ', at: d })).toBe(formSnapshot({ title: 'Fika', at: new Date(d) }));
    expect(formSnapshot({ title: 'Fika', at: d })).not.toBe(formSnapshot({ title: 'Fika!', at: d }));
  });

  it('the form becomes dirty on a change and clean again when it is undone', async () => {
    const onDirtyChange = jest.fn();
    await render(
      <EventForm
        submitLabel="Save"
        onSubmit={jest.fn()}
        now={now}
        initial={{ title: 'Fika', locationText: 'Café Pascal' }}
        onDirtyChange={onDirtyChange}
      />,
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await fireEvent.changeText(screen.getByTestId('title'), 'Fika!');
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    await fireEvent.changeText(screen.getByTestId('title'), 'Fika');
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    await fireEvent.press(screen.getByTestId('theme-night'));
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it('header Save submits the form', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(
      <EventForm
        submitLabel="Save"
        onSubmit={onSubmit}
        now={now}
        initial={{ title: 'Fika', locationText: 'Café Pascal' }}
        renderHeader={({ submit }) => (
          <Pressable testID="header-save" onPress={submit}>
            <Text>Save</Text>
          </Pressable>
        )}
      />,
    );
    await fireEvent.press(screen.getByTestId('header-save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  });

  function Guarded({ dirty, onAllow }: { dirty: boolean; onAllow?: (allow: () => void) => void }) {
    const allowLeave = useDiscardGuard(dirty);
    onAllow?.(allowLeave);
    return null;
  }

  it('blocks leaving only with unsaved changes and asks before discarding', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { rerender } = await render(<Guarded dirty={false} />);
    expect(preventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
    await rerender(<Guarded dirty />);
    expect(preventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));

    const repeat = jest.fn();
    preventRemove.mock.lastCall[1]({ data: { action: { type: 'GO_BACK' } }, repeat });
    expect(alert).toHaveBeenCalledWith('Discard changes?', "Your changes haven't been saved.", expect.any(Array));
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(['Keep editing', 'Discard']);
    expect(repeat).not.toHaveBeenCalled();
    buttons[1].onPress?.();
    expect(repeat).toHaveBeenCalledTimes(1);
  });

  it('allowLeave lifts the guard after a save', async () => {
    const disable = jest.fn();
    preventRemove.mockReturnValue(disable);
    let allow: () => void = () => {};
    await render(<Guarded dirty onAllow={(a) => (allow = a)} />);
    expect(preventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));
    allow();
    expect(disable).toHaveBeenCalled();
    await waitFor(() => expect(preventRemove).toHaveBeenLastCalledWith(false, expect.any(Function)));
  });
});

describe('field fixes', () => {
  it('clears the location error as soon as a location is typed', async () => {
    await render(<EventForm submitLabel="Create" onSubmit={jest.fn()} now={now} />);
    await fireEvent.press(screen.getByTestId('submit'));
    expect(await screen.findByText('Where is it?')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('location'), 'Hornstull');
    expect(screen.queryByText('Where is it?')).toBeNull();
    // Other errors stay until their field changes.
    expect(screen.getByText('Give your event a name')).toBeTruthy();
  });

  it('an added end time can be removed again', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(
      <EventForm submitLabel="Create" onSubmit={onSubmit} now={now} initial={{ title: 'Fika', locationText: 'Here' }} />,
    );
    await fireEvent.press(screen.getByTestId('add-end'));
    expect(screen.getByTestId('ends-at')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Remove end time'));
    expect(screen.queryByTestId('ends-at')).toBeNull();
    expect(screen.getByTestId('add-end')).toHaveTextContent('+ Add end time');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0].endsAt).toBeUndefined();
  });

  it('max guests accepts digits only', async () => {
    await render(<EventForm submitLabel="Create" onSubmit={jest.fn()} now={now} />);
    await fireEvent.press(screen.getByTestId('guests-toggle'));
    await fireEvent.changeText(screen.getByTestId('capacity'), '12.5');
    expect(screen.getByTestId('capacity').props.value).toBe('125');
  });

  it('theme swatches have localized labels', async () => {
    await render(<EventForm submitLabel="Create" onSubmit={jest.fn()} now={now} />);
    expect(screen.getByLabelText('Lagoon theme')).toBeTruthy();
  });
});
