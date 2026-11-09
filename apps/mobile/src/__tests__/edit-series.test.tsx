import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import EditEvent from '@/app/events/[id]/edit';
import { showActionSheet } from '@/lib/action-sheet';
import { supabase } from '@/lib/supabase';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'e2' }),
  usePreventRemove: () => () => undefined,
}));
jest.mock('@/lib/action-sheet', () => ({ showActionSheet: jest.fn() }));
jest.mock('@/lib/upload', () => ({ pickAndUpload: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'admin' } } }) }));

let mockEvent: Record<string, unknown>;
const mockUpdate = jest.fn();
jest.mock('@/lib/supabase', () => ({
  publicUrl: () => null,
  supabase: {
    rpc: jest.fn(),
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: mockEvent, error: null }) }) }),
      update: (row: unknown) => {
        mockUpdate(row);
        return { eq: () => ({ select: async () => ({ data: [{ id: 'e2' }], error: null }) }) };
      },
    }),
  },
}));

const start = new Date(Date.now() + 3 * 86_400_000);
start.setHours(17, 0, 0, 0);

beforeEach(() => {
  jest.clearAllMocks();
  mockEvent = {
    id: 'e2',
    host_id: 'owner',
    series_id: 's1',
    group_id: 'g1',
    title: 'AW',
    starts_at: start.toISOString(),
    ends_at: null,
    time_zone: 'Europe/Stockholm',
    location_text: 'Bar Central',
    place_name: null,
    latitude: null,
    longitude: null,
    description: null,
    cover_path: null,
    theme: 'sunset',
    guest_list_visible: true,
    allow_plus_ones: false,
    max_plus_ones: 1,
    capacity: null,
  };
});

function mockAdmin(admin: boolean) {
  (supabase.rpc as jest.Mock).mockImplementation(async (fn: string) =>
    fn === 'is_series_admin' ? { data: admin, error: null } : { data: 3, error: null },
  );
}

describe('editing a series date (9.2)', () => {
  it('applies "This and following" with update_series_from', async () => {
    mockAdmin(true);
    (showActionSheet as jest.Mock).mockResolvedValue(1);
    await render(<EditEvent />);
    await fireEvent.changeText(await screen.findByTestId('location'), 'Bar Norr');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith('update_series_from', {
        p_event_id: 'e2',
        p_patch: expect.objectContaining({ location_text: 'Bar Norr' }),
      }),
    );
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(router.back).toHaveBeenCalled();
  });

  it('applies "This date" as an ordinary update', async () => {
    mockAdmin(true);
    (showActionSheet as jest.Mock).mockResolvedValue(0);
    await render(<EditEvent />);
    await fireEvent.changeText(await screen.findByTestId('location'), 'Bar Norr');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ location_text: 'Bar Norr' })));
    expect(supabase.rpc).not.toHaveBeenCalledWith('update_series_from', expect.anything());
  });

  it('never asks a co-host of only this date', async () => {
    mockAdmin(false);
    await render(<EditEvent />);
    await fireEvent.changeText(await screen.findByTestId('location'), 'Bar Norr');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalled());
    expect(showActionSheet).not.toHaveBeenCalled();
    // A series date's group can't be changed, so the update never sends group_id.
    expect(mockUpdate.mock.calls[0][0]).not.toHaveProperty('group_id');
  });
});
