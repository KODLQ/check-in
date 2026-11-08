import '@/lib/i18n';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActionSheetIOS, Alert } from 'react-native';

import EventDetail from '@/app/events/[id]';
import { availableDestinations, downloadStoryImage, shareStory } from '@/lib/story-share';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: 'e1' }),
  useFocusEffect: (cb: () => void) => {
    require('react').useEffect(cb, []);
  },
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
jest.mock('@/components/cover', () => ({ Cover: () => null }));
jest.mock('@/components/toast', () => ({ Toast: () => null }));
jest.mock('@/lib/events', () => ({ fetchActiveInvite: jest.fn(async () => 'AbC123def456') }));
jest.mock('@/lib/story-share', () => ({
  availableDestinations: jest.fn(),
  cleanupStoryImages: jest.fn(),
  downloadStoryImage: jest.fn(),
  shareStory: jest.fn(),
}));

let mockEvent: Record<string, unknown>;
jest.mock('@/lib/supabase', () => {
  // Chainable query builder: every method returns the builder; awaiting it resolves to the row(s).
  const builder = (table: string) => {
    const result = () => (table === 'events' ? { data: mockEvent } : { data: [] });
    const b: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'update', 'is', 'gt']) b[m] = () => b;
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res);
    return b;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return { supabase: { from: builder, channel: () => channel, removeChannel: jest.fn(), rpc: jest.fn(async () => ({ data: [] })) } };
});

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const baseEvent = {
  id: 'e1',
  title: 'Fredagshäng',
  starts_at: inDays(2),
  ends_at: null,
  time_zone: 'Europe/Stockholm',
  location_text: 'Hornsgatan 12',
  latitude: null,
  longitude: null,
  description: null,
  cover_path: null,
  theme: 'sunset',
  cancelled_at: null,
  guest_list_visible: true,
};
const file = { uri: 'file:///cache/story.png' };

beforeEach(() => {
  jest.clearAllMocks();
  mockEvent = { ...baseEvent };
  (downloadStoryImage as jest.Mock).mockResolvedValue(file);
  (shareStory as jest.Mock).mockResolvedValue(undefined);
});

describe('Share to Story button', () => {
  it('is shown next to Share invite on an active event', async () => {
    await render(<EventDetail />);
    expect(await screen.findByTestId('share-story')).toHaveTextContent('Share to Story');
    expect(screen.getByTestId('share')).toBeTruthy();
  });

  it('is hidden for a cancelled event', async () => {
    mockEvent = { ...baseEvent, cancelled_at: inDays(-1) };
    await render(<EventDetail />);
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByTestId('share-story')).toBeNull();
    expect(screen.queryByTestId('share')).toBeNull();
  });

  it('is hidden for an ended event', async () => {
    mockEvent = { ...baseEvent, starts_at: inDays(-3) };
    await render(<EventDetail />);
    expect(await screen.findByText('Fredagshäng')).toBeTruthy();
    expect(screen.queryByTestId('share-story')).toBeNull();
  });

  it('goes straight to the share sheet when no direct destination is available', async () => {
    (availableDestinations as jest.Mock).mockResolvedValue(['sheet']);
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions');
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('share-story'));
    await waitFor(() => expect(shareStory).toHaveBeenCalled());
    expect(sheet).not.toHaveBeenCalled();
    expect(downloadStoryImage).toHaveBeenCalledWith('AbC123def456', 'en');
    expect(shareStory).toHaveBeenCalledWith(
      expect.objectContaining({
        file,
        destination: 'sheet',
        link: 'http://localhost:3000/i/AbC123def456',
        message: "You're invited: Fredagshäng",
      }),
    );
  });

  it('offers a destination picker when Instagram or Snapchat is available', async () => {
    (availableDestinations as jest.Mock).mockResolvedValue(['instagram', 'snapchat', 'sheet']);
    const sheet = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((opts, cb) => {
        expect(opts.options).toEqual(['Instagram Stories', 'Snapchat', 'More…', 'Cancel']);
        cb(0);
      });
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('share-story'));
    await waitFor(() => expect(shareStory).toHaveBeenCalledWith(expect.objectContaining({ destination: 'instagram' })));
    expect(sheet).toHaveBeenCalledTimes(1);
  });

  it('tells the host when the image cannot be prepared and starts no share', async () => {
    (availableDestinations as jest.Mock).mockResolvedValue(['sheet']);
    (downloadStoryImage as jest.Mock).mockRejectedValue(new Error('offline'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<EventDetail />);
    await fireEvent.press(await screen.findByTestId('share-story'));
    await waitFor(() => expect(alert).toHaveBeenCalledWith("Couldn't prepare the image", expect.any(String)));
    expect(shareStory).not.toHaveBeenCalled();
  });
});
