import { randomUUID } from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';

import { stripJpegMetadata } from './strip-metadata';
import { supabase } from './supabase';

/**
 * Lets the user pick an image and uploads it to `<bucket>/<folder>/<uuid>.<ext>`. Returns the storage path.
 * `folder` is the user's id, or `e/<event id>` for covers chosen while editing an event: those belong to
 * the event, so a co-host's upload survives their account deletion (add-co-hosts design §6).
 */
export async function pickAndUpload(
  bucket: 'covers' | 'avatars',
  folder: string,
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
  const path = `${folder}/${randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, body, { contentType });
  if (error) throw error;
  return path;
}
