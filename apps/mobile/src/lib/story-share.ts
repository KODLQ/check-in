// "Share to Story" (design: add-story-share-card §3–6). Downloads the server-rendered story image and
// hands it to Instagram Stories, Snapchat (Creative Kit) or the native share sheet. The share sheet is
// always available and is the fall-through when a direct destination fails.
import * as Clipboard from 'expo-clipboard';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Linking, Platform, Share } from 'react-native';
import RNShare, { Social } from 'react-native-share';

import { FACEBOOK_APP_ID, INVITE_BASE_URL, SNAP_CLIENT_ID } from './config';

export type StoryDestination = 'instagram' | 'snapchat' | 'sheet';

const FILE_PREFIX = 'story-';

export class StoryImageError extends Error {
  constructor(cause: unknown) {
    super('story image download failed', { cause });
    this.name = 'StoryImageError';
  }
}

export function storyImageUrl(token: string, lang: string): string {
  return `${INVITE_BASE_URL.replace(/\/$/, '')}/i/${token}/story?lang=${encodeURIComponent(lang)}`;
}

/** Removes story images left in the cache by earlier shares (direct destinations read them after we return). */
export function cleanupStoryImages(except?: File) {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && entry.name.startsWith(FILE_PREFIX) && entry.uri !== except?.uri) entry.delete();
    }
  } catch {
    // best effort: the cache directory is purged by the OS anyway
  }
}

/** Downloads the story PNG to the cache directory. Throws StoryImageError (no share must start). */
export async function downloadStoryImage(token: string, lang: string): Promise<File> {
  cleanupStoryImages();
  try {
    const target = new File(Paths.cache, `${FILE_PREFIX}${token}-${Date.now()}.png`);
    return await File.downloadFileAsync(storyImageUrl(token, lang), target, { idempotent: true });
  } catch (e) {
    throw new StoryImageError(e);
  }
}

async function isInstalled(iosScheme: string, androidPackage: string): Promise<boolean> {
  try {
    if (Platform.OS === 'android') {
      return (await RNShare.isPackageInstalled(androidPackage)).isInstalled;
    }
    return await Linking.canOpenURL(iosScheme);
  } catch {
    return false;
  }
}

/** Direct destinations need both the app installed and the integration configured; the sheet is always last. */
export async function availableDestinations(
  config: { facebookAppId: string; snapClientId: string } = { facebookAppId: FACEBOOK_APP_ID, snapClientId: SNAP_CLIENT_ID },
): Promise<StoryDestination[]> {
  const [instagram, snapchat] = await Promise.all([
    config.facebookAppId ? isInstalled('instagram-stories://share', 'com.instagram.android') : false,
    config.snapClientId ? isInstalled('snapchat://', 'com.snapchat.android') : false,
  ]);
  const out: StoryDestination[] = [];
  if (instagram) out.push('instagram');
  if (snapchat) out.push('snapchat');
  out.push('sheet');
  return out;
}

export async function shareToInstagram(file: File, link: string) {
  const res = await RNShare.shareSingle({
    social: Social.InstagramStories,
    appId: FACEBOOK_APP_ID,
    backgroundImage: file.uri,
    attributionURL: link,
  });
  if (res && res.success === false) throw new Error(res.message || 'instagram share failed');
}

export async function shareToSnapchat(file: File, link: string, caption: string) {
  // Required lazily: the package reads its native modules at import time, and on Android the Snap SDK
  // must not initialise in builds without a client ID.
  const { CreativeKit } = require('@snapchat/snap-kit-react-native') as typeof import('@snapchat/snap-kit-react-native');
  if (!CreativeKit) throw new Error('Snap Creative Kit is not linked');
  await CreativeKit.sharePhoto({ content: { uri: file.uri }, attachmentUrl: link, caption });
}

/** Native share sheet with the image and the link. iOS carries both; Android shares the image (link is on the clipboard). */
export async function shareViaSheet(file: File, link: string, message: string) {
  if (Platform.OS === 'ios') {
    await Share.share({ url: file.uri, message: `${message}\n${link}` });
  } else {
    await Sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: message });
  }
}

export interface ShareStoryOptions {
  file: File;
  destination: StoryDestination;
  link: string;
  /** Short invite text for the share sheet / snap caption. */
  message: string;
  /** Shows a non-blocking message (toast). */
  notify: (key: 'link_copied' | 'direct_failed') => void;
}

/**
 * Shares an already downloaded story image. The link goes to the clipboard first for Instagram and the
 * share sheet (Instagram has no link field; many share targets accept one payload only). A failing
 * direct destination reports an error and falls through to the share sheet.
 */
export async function shareStory({ file, destination, link, message, notify }: ShareStoryOptions) {
  if (destination !== 'snapchat') {
    await Clipboard.setStringAsync(link);
    notify('link_copied');
  }
  try {
    if (destination === 'instagram') return await shareToInstagram(file, link);
    if (destination === 'snapchat') return await shareToSnapchat(file, link, message);
  } catch {
    notify('direct_failed');
    if (destination === 'snapchat') await Clipboard.setStringAsync(link);
  }
  try {
    await shareViaSheet(file, link, message);
  } finally {
    // The share sheet is done with the file once it is dismissed.
    try {
      file.delete();
    } catch {
      // already gone
    }
  }
}
