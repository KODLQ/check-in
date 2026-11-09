// Event wall API client (change: add-event-wall). The app uses the same /api/wall/* routes on the web app as
// web guests (design §3: one write path), authenticated with the Supabase access token. Photos are
// metadata-stripped here when they are JPEGs (strip-metadata.ts) and always re-encoded server-side.
import {
  isWallError,
  wallContentType,
  type WallContentType,
  type WallError,
  type WallFeed,
} from '@check-in/shared';
import * as ImagePicker from 'expo-image-picker';

import { INVITE_BASE_URL } from './config';
import { stripJpegMetadata } from './strip-metadata';
import { supabase } from './supabase';

/** Which wall: by event id (hosts, co-hosts, guests with an RSVP) or by invite token. */
export type WallTarget = { eventId: string; token?: undefined } | { token: string; eventId?: undefined };

export class WallApiError extends Error {
  constructor(public code: WallError) {
    super(code);
  }
}

type Fetch = typeof fetch;

export interface WallApi {
  feed(target: WallTarget, cursor?: { before: string; beforeId: string }): Promise<WallFeed>;
  post(target: WallTarget, body: string, photos: PickedPhoto[], onProgress?: (done: number, total: number) => void): Promise<void>;
  deletePost(target: WallTarget, postId: string, allByAuthor?: boolean): Promise<void>;
  deleteMine(target: WallTarget): Promise<void>;
  block(eventId: string, postId: string): Promise<void>;
  unblock(eventId: string, blockId: string): Promise<void>;
  setEnabled(eventId: string, enabled: boolean): Promise<boolean>;
}

export interface PickedPhoto {
  uri: string;
  contentType: WallContentType;
  /** Bytes as picked (before stripping). */
  size: number;
}

/** Opens the photo library (up to `limit` photos) and returns what was picked. */
export async function pickPhotos(limit: number): Promise<PickedPhoto[]> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: limit > 1,
    selectionLimit: Math.max(1, limit),
    // Re-encodes in the picker (smaller uploads); never request EXIF.
    quality: 0.8,
    exif: false,
  });
  if (result.canceled) return [];
  return result.assets.slice(0, limit).map((a) => ({
    uri: a.uri,
    contentType: wallContentType(a.fileName ?? a.uri, a.mimeType) ?? 'image/jpeg',
    size: a.fileSize ?? 0,
  }));
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) throw new WallApiError('unauthorized');
  return jwt;
}

export function makeWallApi(base = INVITE_BASE_URL, http: Fetch = fetch, token = accessToken): WallApi {
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await http(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${await token()}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).catch(() => null);
    if (!res) throw new WallApiError('unknown');
    const data = (await res.json().catch(() => ({}))) as T & { error?: string };
    if (!res.ok) throw new WallApiError(isWallError(data.error) ? data.error : 'unknown');
    return data;
  }

  return {
    async feed(target, cursor) {
      const q = new URLSearchParams(target.eventId ? { eventId: target.eventId } : { token: target.token! });
      if (cursor) {
        q.set('before', cursor.before);
        q.set('beforeId', cursor.beforeId);
      }
      try {
        return await call<WallFeed>('GET', `/api/wall?${q}`);
      } catch (e) {
        if (e instanceof WallApiError && e.code === 'not_found') return { state: 'not_found' };
        throw e;
      }
    },

    async post(target, body, photos, onProgress) {
      const uploadIds: string[] = [];
      for (const [i, photo] of photos.entries()) {
        onProgress?.(i, photos.length);
        let bytes = await (await http(photo.uri)).arrayBuffer();
        if (photo.contentType === 'image/jpeg') bytes = stripJpegMetadata(bytes);
        const reserved = await call<{ uploadId: string; signedUploadUrl: string }>('POST', '/api/wall/uploads', {
          ...target,
          contentType: photo.contentType,
          size: bytes.byteLength,
        });
        const put = await http(reserved.signedUploadUrl, {
          method: 'PUT',
          headers: { 'content-type': photo.contentType },
          body: bytes,
        }).catch(() => null);
        if (!put?.ok) throw new WallApiError('invalid_upload');
        await call('POST', `/api/wall/uploads/${reserved.uploadId}/complete`, target);
        uploadIds.push(reserved.uploadId);
      }
      onProgress?.(photos.length, photos.length);
      await call('POST', '/api/wall/posts', { ...target, body, uploadIds });
    },

    async deletePost(target, postId, allByAuthor) {
      await call('DELETE', `/api/wall/posts/${postId}`, { ...target, ...(allByAuthor ? { allByAuthor: true } : {}) });
    },
    async deleteMine(target) {
      await call('DELETE', '/api/wall/mine', target);
    },
    async block(eventId, postId) {
      await call('POST', '/api/wall/blocks', { eventId, postId });
    },
    async unblock(eventId, blockId) {
      await call('DELETE', '/api/wall/blocks', { eventId, blockId });
    },
    async setEnabled(eventId, enabled) {
      return (await call<{ enabled: boolean }>('PATCH', '/api/wall/settings', { eventId, enabled })).enabled;
    },
  };
}

export const wallApi = makeWallApi();

/** Error code -> message key. */
export function wallErrorKey(e: unknown): string {
  return `wall.errors.${e instanceof WallApiError ? e.code : 'unknown'}`;
}
