/**
 * Removes metadata segments (EXIF incl. GPS, XMP, IPTC, comments) from a JPEG.
 *
 * Cover images and avatars are publicly readable, and photos straight from a
 * phone often carry the exact GPS position of the user's home. We never need
 * that metadata, so it is dropped before upload. Non-JPEG input is returned as-is.
 */
const SOI = 0xd8;
const SOS = 0xda;
const EOI = 0xd9;

/** APP1 (EXIF/XMP), APP2..APP15 except APP2 ICC color profile, and COM. */
function isMetadataSegment(marker: number, data: Uint8Array): boolean {
  if (marker === 0xfe) return true; // COM
  if (marker === 0xe2) {
    // Keep ICC_PROFILE so colors render correctly.
    const id = String.fromCharCode(...data.subarray(0, 11));
    return id !== 'ICC_PROFILE';
  }
  return marker >= 0xe1 && marker <= 0xef;
}

export function stripJpegMetadata(input: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(input);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== SOI) return input;

  const out: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return input; // Unexpected structure: don't risk corrupting it.
    const marker = bytes[i + 1]!;
    if (marker === SOS || marker === EOI) {
      out.push(bytes.subarray(i)); // Image data until the end.
      break;
    }
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    const end = i + 2 + length;
    if (length < 2 || end > bytes.length) return input;
    if (!isMetadataSegment(marker, bytes.subarray(i + 4, end))) {
      out.push(bytes.subarray(i, end));
    }
    i = end;
  }

  const total = out.reduce((n, part) => n + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of out) {
    result.set(part, offset);
    offset += part.length;
  }
  return result.buffer;
}
