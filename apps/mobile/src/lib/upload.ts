import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';

import { stripJpegMetadata } from './strip-metadata';
import { supabase } from './supabase';

/** Lets the user pick an image and uploads it to `<bucket>/<uid>/<uuid>.jpg`. Returns the storage path. */
export async function pickAndUpload(
  bucket: 'covers' | 'avatars',
  userId: string,
  aspect: [number, number],
): Promise<string | null> {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect,
    quality: 0.8,
  });
  const asset = result.canceled ? null : result.assets[0];
  if (!asset) return null;

  const contentType = asset.mimeType ?? 'image/jpeg';
  // Public bucket: never upload EXIF/GPS metadata.
  const body = stripJpegMetadata(await (await fetch(asset.uri)).arrayBuffer());
  const ext = contentType.split('/')[1] ?? 'jpg';
  const path = `${userId}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType });
  if (error) throw error;
  return path;
}
