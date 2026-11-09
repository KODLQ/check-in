// Server-side photo pipeline for the event wall (change: add-event-wall, design §5).
//
// Every photo is decoded and re-encoded here before anyone can see it, whatever the client did: the output is
// a fresh JPEG with NO metadata (sharp drops EXIF/GPS/XMP/IPTC/comments unless withMetadata/keepExif is
// called, and converts to sRGB without embedding a profile). The type is judged from the bytes, never from
// the file name or declared content type. Animated images keep their first frame only.
//
// HEIC: sharp's prebuilt libvips only decodes AVIF (no HEVC), so HEIC/HEIF goes through libheif compiled to
// WASM (heic-decode) and the raw pixels are handed to sharp. Verified on Node 24 with Next.js 16 route
// handlers (design: "Rebase" R11).
import decodeHeic from 'heic-decode';
import { fileTypeFromBuffer } from 'file-type';
import sharp, { type Sharp } from 'sharp';

import { WALL_LIMITS, type WallError } from '@check-in/shared';

/** Decompression-bomb guard: refuse anything above ~50 megapixels before decoding it. */
export const MAX_INPUT_PIXELS = 50_000_000;
export const FULL_MAX_PX = 2048;
export const THUMB_MAX_PX = 640;

export class ImageRejected extends Error {
  constructor(public code: Extract<WallError, 'too_large' | 'invalid_image'>, detail?: string) {
    super(detail ?? code);
  }
}

export interface ProcessedImage {
  full: Buffer;
  thumb: Buffer;
  width: number;
  height: number;
  /** Detected input format (for logging/metrics). */
  format: 'jpeg' | 'png' | 'webp' | 'heic';
}

const ACCEPTED: Record<string, ProcessedImage['format']> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heic',
};

/** Accepted format from magic bytes, or null. AVIF, GIF, TIFF, SVG, … are rejected. */
export async function sniffImage(input: Uint8Array): Promise<ProcessedImage['format'] | null> {
  const type = await fileTypeFromBuffer(input);
  return (type && ACCEPTED[type.mime]) ?? null;
}

/** First image of a HEIC/HEIF container as a sharp pipeline (pixel limit checked before decoding). */
async function heicToSharp(input: Uint8Array): Promise<Sharp> {
  let images;
  try {
    images = await decodeHeic.all({ buffer: input });
  } catch (e) {
    throw new ImageRejected('invalid_image', `heic: ${(e as Error).message}`);
  }
  try {
    const first = images[0];
    if (!first) throw new ImageRejected('invalid_image', 'heic: no image');
    if (first.width * first.height > MAX_INPUT_PIXELS) throw new ImageRejected('invalid_image', 'pixel limit');
    const { width, height, data } = await first.decode();
    return sharp(Buffer.from(data.buffer, data.byteOffset, data.byteLength), { raw: { width, height, channels: 4 } });
  } finally {
    images.dispose();
  }
}

/**
 * Validates, decodes and re-encodes one uploaded photo into the `full` (≤ 2048 px) and `thumb` (≤ 640 px)
 * JPEG renditions. Throws ImageRejected for anything that isn't an acceptable image.
 */
export async function processImage(input: Uint8Array): Promise<ProcessedImage> {
  if (input.byteLength > WALL_LIMITS.maxBytes) throw new ImageRejected('too_large');
  const format = await sniffImage(input);
  if (!format) throw new ImageRejected('invalid_image', 'unsupported or unknown format');

  try {
    // animated: false (default) = first frame only. failOn 'error': truncated/corrupt input is rejected.
    const base =
      format === 'heic'
        ? await heicToSharp(input)
        : sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, animated: false, failOn: 'error' });
    // rotate() applies the EXIF orientation before the metadata is dropped.
    const oriented = await base.rotate().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    const pixels = () =>
      sharp(oriented.data, {
        raw: { width: oriented.info.width, height: oriented.info.height, channels: oriented.info.channels },
      });
    const encode = (max: number, quality: number) =>
      pixels()
        .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }) // PNG/WebP transparency -> white, JPEG has no alpha
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });
    const [full, thumb] = await Promise.all([encode(FULL_MAX_PX, 82), encode(THUMB_MAX_PX, 78)]);
    return { full: full.data, thumb: thumb.data, width: full.info.width, height: full.info.height, format };
  } catch (e) {
    if (e instanceof ImageRejected) throw e;
    throw new ImageRejected('invalid_image', (e as Error).message);
  }
}
