import { stripJpegMetadata } from '@/lib/strip-metadata';

const seg = (marker: number, payload: number[]) => {
  const len = payload.length + 2;
  return [0xff, marker, len >> 8, len & 0xff, ...payload];
};
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

const exifWithGps = seg(0xe1, [...ascii('Exif\0\0'), 0x4d, 0x4d, 0x88, 0x25, 1, 2, 3]);
const jfif = seg(0xe0, [...ascii('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const icc = seg(0xe2, [...ascii('ICC_PROFILE\0'), 1, 1, 9, 9]);
const comment = seg(0xfe, ascii('shot at home'));
const quant = seg(0xdb, [0, 1, 2, 3]);
const scan = [0xff, 0xda, 0, 4, 9, 9, 0xaa, 0xbb, 0xff, 0xd9];

const jpeg = (...parts: number[][]) => new Uint8Array([0xff, 0xd8, ...parts.flat()]).buffer;
const bytes = (b: ArrayBuffer) => Array.from(new Uint8Array(b));

describe('stripJpegMetadata', () => {
  it('removes EXIF (with GPS) and comments but keeps image data, JFIF and ICC', () => {
    const out = bytes(stripJpegMetadata(jpeg(jfif, exifWithGps, icc, comment, quant, scan)));
    expect(out).toEqual(bytes(jpeg(jfif, icc, quant, scan)));
    expect(String.fromCharCode(...out).includes('Exif')).toBe(false);
  });

  it('returns non-JPEG input unchanged', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;
    expect(stripJpegMetadata(png)).toBe(png);
  });

  it('returns malformed JPEGs unchanged instead of corrupting them', () => {
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1]).buffer;
    expect(stripJpegMetadata(broken)).toBe(broken);
  });
});
