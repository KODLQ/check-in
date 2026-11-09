import '@/lib/i18n';

import type { WallFeed, WallPost } from '@check-in/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ActionSheetIOS, Alert } from 'react-native';

import WallScreen from '@/app/wall';
import MyInviteScreen from '@/app/invites/[eventId]';
import { postActions, WallComposer, withdrawChoices } from '@/components/wall';
import i18n from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import { makeWallApi, WallApiError, wallApi, type PickedPhoto, type WallApi } from '@/lib/wall';

// Event wall in the app (change: add-event-wall, tasks 6.1, 6.3, 6.4).

let mockParams: Record<string, string> = { eventId: 'ev-1' };
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    router: { push: jest.fn(), back: jest.fn() },
    Stack: { Screen: () => null },
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
  };
});
jest.mock('expo-constants', () => ({ expoConfig: {} }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('@/components/cover', () => ({ Cover: () => null }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ session: { user: { id: 'user-1' } } }) }));
jest.mock('@/lib/supabase', () => {
  const channel = { on: jest.fn(), subscribe: jest.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return {
    supabase: {
      rpc: jest.fn(),
      from: jest.fn(),
      channel: jest.fn(() => channel),
      removeChannel: jest.fn(),
      auth: { getSession: jest.fn(async () => ({ data: { session: { access_token: 'jwt-1' } } })) },
    },
  };
});

const t = i18n.t.bind(i18n) as (k: string, v?: Record<string, string | number>) => string;

const post = (over: Partial<WallPost> = {}): WallPost => ({
  id: 'p1',
  display_name: 'Gina',
  is_host: false,
  body: 'Hi <b>all</b> https://x.se',
  created_at: new Date().toISOString(),
  mine: false,
  can_block: false,
  photos: [],
  ...over,
});

const feed = (over: Partial<Extract<WallFeed, { state: 'ok' }>> = {}): WallFeed => ({
  state: 'ok',
  wall_enabled: true,
  moderator: false,
  can_post: 'ok',
  photos_left: 10,
  has_own_posts: false,
  posts: [post()],
  has_more: false,
  blocks: null,
  ...over,
});

function fakeApi(f: WallFeed | (() => WallFeed)): jest.Mocked<WallApi> {
  return ({
    feed: jest.fn(async () => (typeof f === 'function' ? f() : f)),
    post: jest.fn(async () => {}),
    deletePost: jest.fn(async () => {}),
    deleteMine: jest.fn(async () => {}),
    block: jest.fn(async () => {}),
    unblock: jest.fn(async () => {}),
    setEnabled: jest.fn(async (_e: string, on: boolean) => on),
  } as unknown) as jest.Mocked<WallApi>;
}

const photo = (size = 1000): PickedPhoto => ({ uri: `file:///p${Math.random()}.jpg`, contentType: 'image/jpeg', size });

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { eventId: 'ev-1' };
});

describe('WallComposer', () => {
  it('rejects an empty post and more than 500 characters without posting', async () => {
    const onSubmit = jest.fn();
    await render(<WallComposer photosLeft={10} onSubmit={onSubmit} />);
    await fireEvent.press(screen.getByTestId('wall-submit'));
    expect(await screen.findByText('Write something or add a photo.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('wall-input'), 'x'.repeat(501));
    expect(screen.getByTestId('wall-counter')).toHaveTextContent('501/500');
    await fireEvent.press(screen.getByTestId('wall-submit'));
    expect(await screen.findByText('Max 500 characters.')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('rejects photos over 10 MB and beyond the remaining quota before uploading', async () => {
    const onSubmit = jest.fn();
    const pick = jest.fn().mockResolvedValueOnce([photo(11 * 1024 * 1024)]).mockResolvedValueOnce([photo(), photo()]);
    await render(<WallComposer photosLeft={1} onSubmit={onSubmit} pick={pick} />);
    await fireEvent.press(screen.getByTestId('wall-add-photos'));
    expect(await screen.findByText('Photos can be at most 10 MB.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('wall-add-photos'));
    expect(await screen.findByText('You can have at most 10 photos on this wall.')).toBeTruthy();
    expect(pick).toHaveBeenLastCalledWith(1);
  });

  it('posts trimmed text with photos, then clears the form', async () => {
    const onSubmit = jest.fn(async () => {});
    const p = photo();
    await render(<WallComposer photosLeft={10} onSubmit={onSubmit} pick={async () => [p]} />);
    await fireEvent.press(screen.getByTestId('wall-add-photos'));
    await waitFor(() => expect(screen.getByTestId('wall-photo-remove-0')).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('wall-input'), '  Pics!  ');
    await fireEvent.press(screen.getByTestId('wall-submit'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Pics!', [p], expect.any(Function)));
    await waitFor(() => expect(screen.getByTestId('wall-input').props.value).toBe(''));
    expect(screen.queryByTestId('wall-photo-remove-0')).toBeNull();
  });

  it('shows the server error (e.g. blocked)', async () => {
    const onSubmit = jest.fn(async () => {
      throw new WallApiError('blocked');
    });
    await render(<WallComposer photosLeft={10} onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByTestId('wall-input'), 'hello');
    await fireEvent.press(screen.getByTestId('wall-submit'));
    expect(await screen.findByText('The host has stopped you from posting here.')).toBeTruthy();
  });
});

describe('moderation menus', () => {
  it('guests can only delete their own posts', () => {
    expect(postActions(post({ mine: false }), false, t)).toEqual([]);
    expect(postActions(post({ mine: true }), false, t).map((a) => a.key)).toEqual(['delete']);
  });

  it('hosts delete any post, everything by its author, and stop guests from posting', () => {
    expect(postActions(post({ can_block: true }), true, t)).toEqual([
      { key: 'delete', label: 'Delete post', destructive: true },
      { key: 'delete_all_by', label: 'Delete all posts by Gina', destructive: true },
      { key: 'block', label: 'Stop Gina from posting', destructive: false },
    ]);
  });

  it('another host cannot be blocked', () => {
    expect(postActions(post({ is_host: true, display_name: 'Erik' }), true, t).map((a) => a.key)).toEqual(['delete', 'delete_all_by']);
  });
});

describe('wall screen', () => {
  it('renders text as plain text and hides the form with the reason when not attending', async () => {
    const api = fakeApi(feed({ can_post: 'not_attending' }));
    await render(<WallScreen api={api} />);
    expect(await screen.findByTestId('wall-body')).toHaveTextContent('Hi <b>all</b> https://x.se');
    expect(screen.getByText('Only people who are going or might go can post. RSVP to join in.')).toBeTruthy();
    expect(screen.queryByTestId('wall-composer')).toBeNull();
    expect(api.feed).toHaveBeenCalledWith({ eventId: 'ev-1' });
  });

  /** Picks `label` in the post's "…" action sheet. */
  function chooseInSheet(label: string) {
    return jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((opts, cb) => cb(opts.options.indexOf(label)));
  }

  it('moderation choices live in one "…" sheet per post, not as inline links', async () => {
    const api = fakeApi(feed({ moderator: true, posts: [post({ can_block: true })] }));
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_o, cb) => cb(3));
    await render(<WallScreen api={api} />);
    expect(screen.queryByText('Delete post')).toBeNull();
    await fireEvent.press(await screen.findByTestId('wall-post-menu'));
    expect(sheet.mock.calls[0]![0]).toMatchObject({
      title: 'Gina',
      options: ['Delete post', 'Delete all posts by Gina', 'Stop Gina from posting', 'Cancel'],
      cancelButtonIndex: 3,
      destructiveButtonIndex: [0, 1],
    });
    expect(api.deletePost).not.toHaveBeenCalled();
    expect(api.block).not.toHaveBeenCalled();
  });

  it('guests without actions get no menu', async () => {
    await render(<WallScreen api={fakeApi(feed())} />);
    await screen.findByTestId('wall-body');
    expect(screen.queryByTestId('wall-post-menu')).toBeNull();
  });

  it('a host deletes all posts by a poster after confirming, then reloads and confirms with a toast', async () => {
    const api = fakeApi(feed({ moderator: true, posts: [post({ can_block: true })] }));
    chooseInSheet('Delete all posts by Gina');
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    await render(<WallScreen api={api} />);
    await fireEvent.press(await screen.findByTestId('wall-post-menu'));
    await waitFor(() => expect(api.deletePost).toHaveBeenCalledWith({ eventId: 'ev-1' }, 'p1', true));
    expect(await screen.findByTestId('toast')).toHaveTextContent('Posts deleted');
    expect(api.feed).toHaveBeenCalledTimes(2);
  });

  it('stopping a poster asks first and does nothing when cancelled', async () => {
    const api = fakeApi(feed({ moderator: true, posts: [post({ can_block: true })] }));
    chooseInSheet('Stop Gina from posting');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === 'cancel')?.onPress?.());
    await render(<WallScreen api={api} />);
    await fireEvent.press(await screen.findByTestId('wall-post-menu'));
    expect(alert).toHaveBeenCalledWith('Stop Gina from posting?', expect.any(String), expect.any(Array));
    expect(api.block).not.toHaveBeenCalled();
  });

  it('a host stops and then allows a poster; the stop option is gone while stopped', async () => {
    let blocked = false;
    const api = fakeApi(() => feed({ moderator: true, posts: [post({ can_block: true })], blocks: blocked ? [{ id: 'b1', display_name: 'Gina' }] : [] }));
    api.block.mockImplementation(async () => void (blocked = true));
    api.unblock.mockImplementation(async () => void (blocked = false));
    const sheet = chooseInSheet('Stop Gina from posting');
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    await render(<WallScreen api={api} />);
    await fireEvent.press(await screen.findByTestId('wall-post-menu'));
    expect(await screen.findByTestId('wall-blocked')).toHaveTextContent(/Gina/);
    expect(screen.getByTestId('toast')).toHaveTextContent('Gina can no longer post');
    sheet.mockClear();
    await fireEvent.press(screen.getByTestId('wall-post-menu'));
    expect(sheet.mock.calls[0]![0].options).not.toContain('Stop Gina from posting');
    await fireEvent.press(screen.getByTestId('wall-unblock-b1'));
    await waitFor(() => expect(screen.queryByTestId('wall-blocked')).toBeNull());
    expect(api.block).toHaveBeenCalledWith('ev-1', 'p1');
    expect(api.unblock).toHaveBeenCalledWith('ev-1', 'b1');
  });

  it('subscribes hosts to live wall updates and refetches (debounced) on new posts', async () => {
    const api = fakeApi(feed({ moderator: true }));
    await render(<WallScreen api={api} />);
    await waitFor(() => expect(supabase.channel).toHaveBeenCalled());
    const ch = (supabase.channel as jest.Mock).mock.results[0]!.value as { on: jest.Mock };
    const insert = ch.on.mock.calls.find((c) => c[1].event === 'INSERT')!;
    expect(insert[1]).toMatchObject({ table: 'wall_posts', filter: 'event_id=eq.ev-1' });
    const calls = api.feed.mock.calls.length;
    await act(async () => {
      insert[2]({});
      insert[2]({});
    });
    // Two events within the 1 s debounce -> exactly one refetch.
    await waitFor(() => expect(api.feed.mock.calls.length).toBe(calls + 1), { timeout: 3000 });
    await new Promise((r) => setTimeout(r, 1200));
    expect(api.feed.mock.calls.length).toBe(calls + 1);
  });

  it('an expired session hides the spinner and offers Retry and Sign in', async () => {
    const api = fakeApi(feed());
    api.feed.mockRejectedValueOnce(new WallApiError('unauthorized'));
    await render(<WallScreen api={api} />);
    expect(await screen.findByText('Sign in again.')).toBeTruthy();
    expect(screen.getByTestId('wall-sign-in')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('wall-retry'));
    expect(await screen.findByTestId('wall-body')).toBeTruthy();
  });

  it('guests do not subscribe to Realtime', async () => {
    await render(<WallScreen api={fakeApi(feed())} />);
    await screen.findByTestId('wall-body');
    expect(supabase.channel).not.toHaveBeenCalled();
  });
});

describe('withdraw dialog', () => {
  it('offers to delete wall posts only when there are some', () => {
    expect(withdrawChoices(false, t).map((c) => c.label)).toEqual(['Remove my reply']);
    expect(withdrawChoices(true, t).map((c) => c.label)).toEqual(['Remove my reply', 'Also delete my wall posts and photos']);
  });

  async function withdrawWith(choice: string) {
    (supabase.rpc as jest.Mock).mockImplementation(async (fn: string) =>
      fn === 'remove_rsvp'
        ? { data: true, error: null }
        : {
            data: {
              state: 'active',
              event: { title: 'X', starts_at: '2030-12-13T18:00:00Z', ends_at: null, time_zone: 'Europe/Stockholm', location_text: 'Y' },
              host: { display_name: 'Lina' },
              counts: { going: 1, maybe: 0 },
              guests: [],
              my_rsvp: { status: 'going', display_name: 'S' },
              announcements: [],
            },
            error: null,
          },
    );
    const eqUser = jest.fn(() => ({ maybeSingle: async () => ({ data: { id: 'r-1' }, error: null }) }));
    (supabase.from as jest.Mock).mockReturnValue({ select: () => ({ eq: () => ({ eq: eqUser }) }) });
    const feedSpy = jest.spyOn(wallApi, 'feed').mockResolvedValue(feed({ has_own_posts: true }));
    const deleteMine = jest.spyOn(wallApi, 'deleteMine').mockResolvedValue();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.text === choice)?.onPress?.());
    await render(<MyInviteScreen />);
    await fireEvent.press(await screen.findByTestId('withdraw'));
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith('remove_rsvp', { p_rsvp_id: 'r-1' }));
    expect(feedSpy).toHaveBeenCalledWith({ eventId: 'ev-1' });
    expect(alert.mock.calls[0]![2]!.map((b) => b.text)).toEqual(['Cancel', 'Remove my reply', 'Also delete my wall posts and photos']);
    return deleteMine;
  }

  it('keeps the posts by default', async () => {
    const deleteMine = await withdrawWith('Remove my reply');
    expect(deleteMine).not.toHaveBeenCalled();
  });

  it('deletes the posts first when chosen', async () => {
    const deleteMine = await withdrawWith('Also delete my wall posts and photos');
    expect(deleteMine).toHaveBeenCalledWith({ eventId: 'ev-1' });
    expect(deleteMine.mock.invocationCallOrder[0]!).toBeLessThan((supabase.rpc as jest.Mock).mock.invocationCallOrder.at(-1)!);
  });
});

describe('wall API client', () => {
  it('sends the access token, never a user id, and maps errors', async () => {
    const http = jest.fn(async () => ({ ok: false, json: async () => ({ error: 'photo_quota' }) })) as unknown as typeof fetch;
    const api = makeWallApi('https://web.test', http, async () => 'jwt-1');
    await expect(api.post({ eventId: 'ev-1' }, 'hi', [])).rejects.toMatchObject({ code: 'photo_quota' });
    const [url, init] = (http as unknown as jest.Mock).mock.calls[0]!;
    expect(url).toBe('https://web.test/api/wall/posts');
    expect(init.headers.authorization).toBe('Bearer jwt-1');
    expect(JSON.parse(init.body)).toEqual({ eventId: 'ev-1', body: 'hi', uploadIds: [] });
  });

  it('uploads each photo: reserve, PUT to the signed URL, complete, then post', async () => {
    const urls: string[] = [];
    const http = jest.fn(async (url: string, init?: RequestInit) => {
      urls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.startsWith('file://')) return { ok: true, arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer };
      if (url.endsWith('/api/wall/uploads')) return { ok: true, json: async () => ({ uploadId: 'u1', signedUploadUrl: 'https://s/up?token=x' }) };
      return { ok: true, json: async () => ({}) };
    }) as unknown as typeof fetch;
    await makeWallApi('https://web.test', http, async () => 'jwt').post({ token: 'AbCdEfGh1234' }, '', [photo()]);
    expect(urls).toEqual([
      expect.stringMatching(/^GET file:\/\//),
      'POST https://web.test/api/wall/uploads',
      'PUT https://s/up?token=x',
      'POST https://web.test/api/wall/uploads/u1/complete',
      'POST https://web.test/api/wall/posts',
    ]);
  });
});
