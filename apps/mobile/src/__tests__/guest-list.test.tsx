import '@/lib/i18n';

import { fireEvent, render, screen } from '@testing-library/react-native';
import i18n from 'i18next';
import { Alert } from 'react-native';

import { GuestList, promoteGuest, type GuestRow } from '@/components/guest-list';

const row = (id: string, name: string, status: GuestRow['status'], plus = 0, at: string | null = null): GuestRow => ({
  id,
  display_name: name,
  status,
  plus_ones: plus,
  waitlisted_at: status === 'waitlisted' ? at : null,
});

const rows: GuestRow[] = [
  row('1', 'Anna', 'going', 2),
  row('2', 'Ben', 'going'),
  row('3', 'Cleo', 'maybe'),
  row('4', 'Dan', 'declined'),
  row('6', 'Fia', 'waitlisted', 1, '2026-11-01T10:05:00Z'),
  row('5', 'Eli', 'waitlisted', 0, '2026-11-01T10:00:00Z'),
];

describe('GuestList (add-guest-capacity)', () => {
  it('groups Going, Maybe, Can\'t go and Waitlist, counting heads and showing "+N"', async () => {
    await render(<GuestList rsvps={rows} capacity={4} editable onRemove={jest.fn()} onPromote={jest.fn()} />);
    expect(screen.getByTestId('group-going')).toHaveTextContent('Going · 4 / 4');
    expect(screen.getByTestId('group-maybe')).toHaveTextContent('Maybe · 1');
    expect(screen.getByTestId('group-declined')).toHaveTextContent("Can't go · 1");
    expect(screen.getByTestId('group-waitlisted')).toHaveTextContent('Waitlist · 3');
    expect(screen.getByTestId('plus-Anna')).toHaveTextContent('+2');
    expect(screen.queryByTestId('plus-Ben')).toBeNull();
    // Waitlist in the order guests joined it.
    const names = screen.getAllByTestId(/^promote-/).map((n) => n.props.testID);
    expect(names).toEqual(['promote-Eli', 'promote-Fia']);
  });

  it('shows "12 / 10" when capacity was lowered below Going, and no capacity as a plain count', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => row(String(i), `G${i}`, 'going'));
    const { rerender } = await render(
      <GuestList rsvps={twelve} capacity={10} editable onRemove={jest.fn()} onPromote={jest.fn()} />,
    );
    expect(screen.getByTestId('group-going')).toHaveTextContent('Going · 12 / 10');
    await rerender(<GuestList rsvps={twelve} capacity={null} editable onRemove={jest.fn()} onPromote={jest.fn()} />);
    expect(screen.getByTestId('group-going')).toHaveTextContent('Going · 12');
    // No capacity and nobody waiting: no Waitlist group.
    expect(screen.queryByTestId('group-waitlisted')).toBeNull();
  });

  it('Promote and Remove call back with the guest; no Promote once the event is closed', async () => {
    const onPromote = jest.fn();
    const onRemove = jest.fn();
    const { rerender } = await render(
      <GuestList rsvps={rows} capacity={4} editable onRemove={onRemove} onPromote={onPromote} />,
    );
    await fireEvent.press(screen.getByTestId('promote-Fia'));
    expect(onPromote).toHaveBeenCalledWith(expect.objectContaining({ id: '6' }));
    await fireEvent.press(screen.getByTestId('remove-Ben'));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }));
    await rerender(<GuestList rsvps={rows} capacity={4} editable={false} onRemove={onRemove} onPromote={onPromote} />);
    expect(screen.queryByTestId('promote-Fia')).toBeNull();
  });
});

describe('promoteGuest', () => {
  const t = i18n.t.bind(i18n);
  const fia = rows[4]!;

  it('promotes directly when the party fits', async () => {
    const rpc = jest.fn().mockResolvedValue({ error: null });
    expect(await promoteGuest(rpc, t, fia, rows, 10)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('promote_waitlisted', { p_rsvp_id: '6' });
  });

  it('asks before going over capacity and retries with p_over_capacity', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ error: { message: 'over_capacity' } })
      .mockResolvedValueOnce({ error: null });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((title, body, buttons) => {
      expect(title).toBe('Go over capacity?');
      expect(body).toBe('Fia needs 2 spots and 0 are left. Promote anyway?');
      buttons?.find((b) => b.text === 'Promote anyway')?.onPress?.();
    });
    expect(await promoteGuest(rpc, t, fia, rows, 4)).toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('promote_waitlisted', { p_rsvp_id: '6', p_over_capacity: true });
    alert.mockRestore();
  });

  it('does nothing more when the host cancels', async () => {
    const rpc = jest.fn().mockResolvedValueOnce({ error: { message: 'over_capacity' } });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _b, buttons) => {
      buttons?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    expect(await promoteGuest(rpc, t, fia, rows, 4)).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(1);
    alert.mockRestore();
  });
});
