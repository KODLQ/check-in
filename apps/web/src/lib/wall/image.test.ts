import exifr from 'exifr';
import { readFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { FULL_MAX_PX, ImageRejected, processImage, THUMB_MAX_PX } from './image';

const GPS = {
  IFD0: { Make: 'TestCam', Model: 'X1', ImageDescription: 'home sweet home', Artist: 'Sara' },
  IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '59/1 20/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '18/1 4/1 0/1' },
};

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 80, b: 40 } } });

/** Every metadata block exifr knows (EXIF, GPS, XMP, IPTC, ICC, JFIF comments…). */
async function allMetadata(buf: Buffer) {
  return exifr.parse(buf, {
    tiff: true, ifd0: true, exif: true, gps: true, interop: true, ifd1: true,
    xmp: true, icc: true, iptc: true, jfif: true, ihdr: true, mergeOutput: false,
  } as never);
}

async function expectClean(buf: Buffer) {
  expect(await exifr.gps(buf)).toBeUndefined();
  const meta = (await allMetadata(buf)) as Record<string, unknown> | undefined;
  // Only the JFIF header (density) may remain; no EXIF/GPS/XMP/IPTC/ICC blocks.
  for (const block of ['ifd0', 'exif', 'gps', 'xmp', 'iptc', 'icc', 'ifd1', 'interop']) {
    expect(meta?.[block], block).toBeUndefined();
  }
  const m = await sharp(buf).metadata();
  expect(m.format).toBe('jpeg');
  expect(m.exif).toBeUndefined();
  expect(m.icc).toBeUndefined();
  expect(m.xmp).toBeUndefined();
  expect(m.iptc).toBeUndefined();
  expect(m.comments ?? []).toEqual([]);
}

/** PNG with tEXt chunks (author, comment, location) inserted before IEND. */
async function pngWithText(): Promise<Buffer> {
  const png = await solid(300, 200).png().toBuffer();
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const text = (k: string, v: string) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1'));
  const iend = png.length - 12;
  return Buffer.concat([
    png.subarray(0, iend),
    text('Author', 'Sara'),
    text('Comment', 'Taken at Sveavagen 1, Stockholm'),
    chunk('zTXt', Buffer.concat([Buffer.from('Location\0\0', 'latin1'), deflateSync('59.33,18.06')])),
    png.subarray(iend),
  ]);
}

/** A tiny PNG whose header claims 100 000 x 100 000 pixels (10 gigapixels). */
async function pngBomb(): Promise<Buffer> {
  const png = Buffer.from(await solid(16, 16).png().toBuffer());
  png.writeUInt32BE(100_000, 16);
  png.writeUInt32BE(100_000, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)) >>> 0, 29);
  return png;
}

describe('processImage', () => {
  it('re-encodes a GPS-tagged JPEG without any metadata and keeps the orientation', async () => {
    const input = await solid(3000, 2000).jpeg().withExif(GPS).withMetadata({ orientation: 6 }).toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);
    expect((await exifr.gps(input))?.latitude).toBeCloseTo(59.333, 2); // the fixture really has GPS
    const out = await processImage(input);
    await expectClean(out.full);
    await expectClean(out.thumb);
    // Orientation 6 = rotate 90°: landscape input becomes portrait, longest side capped at 2048.
    expect([out.width, out.height]).toEqual([1365, FULL_MAX_PX]);
    const thumb = await sharp(out.thumb).metadata();
    expect(Math.max(thumb.width!, thumb.height!)).toBe(THUMB_MAX_PX);
    expect(out.format).toBe('jpeg');
  });

  it('drops PNG text chunks (author, comments, location)', async () => {
    const input = await pngWithText();
    expect(input.includes(Buffer.from('Sveavagen'))).toBe(true);
    const out = await processImage(input);
    await expectClean(out.full);
    expect(out.full.includes(Buffer.from('Sveavagen'))).toBe(false);
    expect(out.full.includes(Buffer.from('Sara'))).toBe(false);
    expect(out.format).toBe('png');
  });

  it('decodes HEIC (via WASM) and strips its GPS data', async () => {
    const input = readFileSync(new URL('./__fixtures__/gps.heic', import.meta.url));
    expect((await exifr.gps(input))?.longitude).toBeCloseTo(18.067, 2);
    const out = await processImage(input);
    await expectClean(out.full);
    await expectClean(out.thumb);
    expect(out.format).toBe('heic');
    expect([out.width, out.height]).toEqual([1200, 800]);
  });

  it('re-encodes WebP with EXIF', async () => {
    const input = await solid(800, 600).webp().withExif(GPS).toBuffer();
    // exifr can't read WebP containers: check the EXIF chunk with sharp instead.
    expect((await sharp(input).metadata()).exif?.includes(Buffer.from('TestCam'))).toBe(true);
    const out = await processImage(input);
    await expectClean(out.full);
    expect(out.format).toBe('webp');
  });

  it('keeps only the first frame of an animated WebP', async () => {
    const red = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#ff0000' } }).png().toBuffer();
    const blue = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0000ff' } }).png().toBuffer();
    const input = await sharp([red, blue], { join: { animated: true } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
    expect((await sharp(input).metadata()).pages).toBe(2);
    const out = await processImage(input);
    const meta = await sharp(out.full).metadata();
    expect(meta.pages ?? 1).toBe(1);
    expect([out.width, out.height]).toEqual([64, 64]);
    const { data } = await sharp(out.full).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200); // red, i.e. frame 1
    expect(data[2]).toBeLessThan(50);
  });

  it('rejects a text file renamed to photo.jpg', async () => {
    const input = Buffer.from('this is not a photo, just text pretending to be photo.jpg\n'.repeat(20));
    await expect(processImage(input)).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('rejects other image formats it does not accept (GIF, AVIF)', async () => {
    const gif = await solid(10, 10).gif().toBuffer();
    await expect(processImage(gif)).rejects.toBeInstanceOf(ImageRejected);
    const avif = await solid(10, 10).avif().toBuffer();
    await expect(processImage(avif)).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('rejects a decompression bomb without decoding it', async () => {
    const started = Date.now();
    await expect(processImage(await pngBomb())).rejects.toMatchObject({ code: 'invalid_image' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('rejects truncated images', async () => {
    const input = await solid(400, 300).jpeg().toBuffer();
    await expect(processImage(input.subarray(0, input.length / 2))).rejects.toMatchObject({ code: 'invalid_image' });
  });

  it('rejects files over 10 MB before looking at them', async () => {
    await expect(processImage(Buffer.alloc(10 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'too_large' });
  });
});
