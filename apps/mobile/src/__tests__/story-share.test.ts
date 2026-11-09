import * as Clipboard from 'expo-clipboard';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform, Share } from 'react-native';

import {
  availableDestinations,
  downloadStoryImage,
  shareStory,
  StoryImageError,
  storyImageUrl,
} from '@/lib/story-share';

jest.mock('@/lib/config', () => ({
  INVITE_BASE_URL: 'https://checkin.example/',
  FACEBOOK_APP_ID: 'fb-app-123',
  SNAP_CLIENT_ID: 'snap-client-456',
}));

jest.mock('expo-file-system', () => {
  class MockFile {
    uri: string;
    name: string;
    delete = jest.fn();
    constructor(dir: { uri: string }, name: string) {
      this.name = name;
      this.uri = `${dir.uri}/${name}`;
    }
    static downloadFileAsync = jest.fn();
  }
  return { File: MockFile, Paths: { cache: { uri: 'file:///cache', list: jest.fn(() => []) } } };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn(async () => undefined) }));
const mockShareSingle = jest.fn();
const mockIsPackageInstalled = jest.fn();
jest.mock('react-native-share', () => ({
  __esModule: true,
  default: { shareSingle: (...a: unknown[]) => mockShareSingle(...a), isPackageInstalled: (...a: unknown[]) => mockIsPackageInstalled(...a) },
  Social: { InstagramStories: 'instagramstories' },
}));
const mockSharePhoto = jest.fn();
jest.mock('@snapchat/snap-kit-react-native', () => ({ CreativeKit: { sharePhoto: (...a: unknown[]) => mockSharePhoto(...a) } }));

const downloadFileAsync = File.downloadFileAsync as unknown as jest.Mock;
const LINK = 'https://checkin.example/i/AbC123def456';

function makeFile() {
  return new File({ uri: 'file:///cache' } as never, 'story-AbC123def456-1.png') as unknown as File & { delete: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
  Platform.OS = 'ios';
});

describe('story image download', () => {
  it('requests the image in the given language into the cache directory', async () => {
    downloadFileAsync.mockImplementation(async (_url: string, target: File) => target);
    const file = await downloadStoryImage('AbC123def456', 'sv');
    expect(downloadFileAsync).toHaveBeenCalledWith(
      'https://checkin.example/i/AbC123def456/story?lang=sv',
      expect.objectContaining({ uri: expect.stringMatching(/^file:\/\/\/cache\/story-AbC123def456-\d+\.png$/) }),
      { idempotent: true },
    );
    expect(file.uri).toMatch(/^file:\/\/\/cache\/story-/);
    expect(storyImageUrl('x', 'en')).toBe('https://checkin.example/i/x/story?lang=en');
  });

  it('a failed download throws StoryImageError and starts no share', async () => {
    downloadFileAsync.mockRejectedValue(new Error('offline'));
    await expect(downloadStoryImage('AbC123def456', 'en')).rejects.toBeInstanceOf(StoryImageError);
    expect(Share.share).not.toHaveBeenCalled();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(mockShareSingle).not.toHaveBeenCalled();
    expect(mockSharePhoto).not.toHaveBeenCalled();
    expect(Clipboard.setStringAsync).not.toHaveBeenCalled();
  });
});

describe('available destinations (installed × configured)', () => {
  const both = { facebookAppId: 'fb', snapClientId: 'snap' };
  const cases: [string, { facebookAppId: string; snapClientId: string }, string[], string[]][] = [
    ['both installed and configured', both, ['instagram-stories://share', 'snapchat://'], ['instagram', 'snapchat', 'sheet']],
    ['only Instagram installed', both, ['instagram-stories://share'], ['instagram', 'sheet']],
    ['only Snapchat installed', both, ['snapchat://'], ['snapchat', 'sheet']],
    ['nothing installed', both, [], ['sheet']],
    ['installed but Instagram not configured', { facebookAppId: '', snapClientId: 'snap' }, ['instagram-stories://share', 'snapchat://'], ['snapchat', 'sheet']],
    ['installed but Snapchat not configured', { facebookAppId: 'fb', snapClientId: '' }, ['instagram-stories://share', 'snapchat://'], ['instagram', 'sheet']],
    ['installed but nothing configured', { facebookAppId: '', snapClientId: '' }, ['instagram-stories://share', 'snapchat://'], ['sheet']],
  ];
  it.each(cases)('iOS: %s', async (_name, config, installed, expected) => {
    jest.spyOn(Linking, 'canOpenURL').mockImplementation(async (url) => installed.includes(url));
    expect(await availableDestinations(config)).toEqual(expected);
  });

  it('Android uses package visibility for Instagram', async () => {
    Platform.OS = 'android';
    mockIsPackageInstalled.mockImplementation(async (p: string) => ({ isInstalled: p === 'com.instagram.android' }));
    expect(await availableDestinations(both)).toEqual(['instagram', 'sheet']);
  });

  it('Android never offers Snapchat while Snap Kit is unlinked there', async () => {
    Platform.OS = 'android';
    mockIsPackageInstalled.mockResolvedValue({ isInstalled: true });
    expect(await availableDestinations(both)).toEqual(['instagram', 'sheet']);
  });

  it('a failing install check just hides the destination', async () => {
    jest.spyOn(Linking, 'canOpenURL').mockRejectedValue(new Error('not allowed'));
    expect(await availableDestinations(both)).toEqual(['sheet']);
  });
});

describe('shareStory', () => {
  const notify = jest.fn();

  it('Instagram: copies the link first, then opens the story composer with the image', async () => {
    const order: string[] = [];
    (Clipboard.setStringAsync as jest.Mock).mockImplementation(async () => order.push('clipboard'));
    mockShareSingle.mockImplementation(async () => {
      order.push('instagram');
      return { success: true };
    });
    const file = makeFile();
    await shareStory({ file, destination: 'instagram', link: LINK, message: 'msg', notify });
    expect(mockShareSingle).toHaveBeenCalledWith({
      social: 'instagramstories',
      appId: 'fb-app-123',
      backgroundImage: file.uri,
      attributionURL: LINK,
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(LINK);
    expect(order).toEqual(['clipboard', 'instagram']);
    expect(notify).toHaveBeenCalledWith('link_copied');
    expect(Share.share).not.toHaveBeenCalled();
  });

  it('Snapchat: shares the photo with the link attached', async () => {
    mockSharePhoto.mockResolvedValue(undefined);
    const file = makeFile();
    await shareStory({ file, destination: 'snapchat', link: LINK, message: "You're invited: Fest", notify });
    expect(mockSharePhoto).toHaveBeenCalledWith({ content: { uri: file.uri }, attachmentUrl: LINK, caption: "You're invited: Fest" });
    expect(Share.share).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it.each(['instagram', 'snapchat'] as const)('%s failing shows an error and opens the share sheet', async (destination) => {
    mockShareSingle.mockRejectedValue(new Error('Instagram not available'));
    mockSharePhoto.mockRejectedValue(new Error('Snapchat not available'));
    const file = makeFile();
    await shareStory({ file, destination, link: LINK, message: 'msg', notify });
    expect(notify).toHaveBeenCalledWith('direct_failed');
    expect(Share.share).toHaveBeenCalledWith({ url: file.uri, message: `msg\n${LINK}` });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(LINK);
    expect(file.delete).toHaveBeenCalled();
  });

  it('Instagram reporting success=false also falls through', async () => {
    mockShareSingle.mockResolvedValue({ success: false, message: 'not installed' });
    await shareStory({ file: makeFile(), destination: 'instagram', link: LINK, message: 'msg', notify });
    expect(notify).toHaveBeenCalledWith('direct_failed');
    expect(Share.share).toHaveBeenCalled();
  });

  it('iOS share sheet carries image and link; the file is deleted afterwards', async () => {
    const file = makeFile();
    await shareStory({ file, destination: 'sheet', link: LINK, message: 'msg', notify });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(LINK);
    expect(Share.share).toHaveBeenCalledWith({ url: file.uri, message: `msg\n${LINK}` });
    expect(file.delete).toHaveBeenCalled();
  });

  it('Android share sheet shares the PNG with the link on the clipboard', async () => {
    Platform.OS = 'android';
    const file = makeFile();
    await shareStory({ file, destination: 'sheet', link: LINK, message: 'msg', notify });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(LINK);
    expect(Sharing.shareAsync).toHaveBeenCalledWith(file.uri, expect.objectContaining({ mimeType: 'image/png' }));
    expect(notify).toHaveBeenCalledWith('link_copied');
  });
});
