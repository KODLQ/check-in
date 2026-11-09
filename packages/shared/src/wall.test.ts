import { describe, expect, it } from 'vitest';

import en from './i18n/en.json';
import sv from './i18n/sv.json';
import {
  WALL_ERRORS,
  WALL_LIMITS,
  WALL_REASONS,
  wallContentType,
  wallFilesPrecheck,
  wallInputError,
  wallPostInputSchema,
  wallTargetSchema,
  wallTextLength,
  wallUploadInputSchema,
} from './wall';

const web = { token: 'AbCdEfGh1234', guestToken: 'guest-token-aaaaaaaaaaaa' };
const app = { eventId: '6f9619ff-8b86-4d11-b42d-00c04fc964ff' };
const upload = '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b';

describe('wall schemas', () => {
  it('accepts text, photos, or both', () => {
    expect(wallPostInputSchema.safeParse({ ...web, body: 'Hej!' }).success).toBe(true);
    expect(wallPostInputSchema.safeParse({ ...app, uploadIds: [upload] }).success).toBe(true);
    expect(wallPostInputSchema.safeParse({ ...web, body: 'Pics', uploadIds: [upload] }).success).toBe(true);
  });

  it('rejects empty and whitespace-only posts', () => {
    const r = wallPostInputSchema.safeParse({ ...web, body: ' \n\t ' });
    expect(r.success).toBe(false);
    expect(wallInputError(r.error!.issues)).toBe('empty_post');
  });

  it('counts characters like Postgres (code points) and caps at 500', () => {
    expect(wallTextLength('🎉'.repeat(500))).toBe(500);
    expect(wallPostInputSchema.safeParse({ ...web, body: '🎉'.repeat(500) }).success).toBe(true);
    const r = wallPostInputSchema.safeParse({ ...web, body: 'x'.repeat(501) });
    expect(wallInputError(r.error!.issues)).toBe('body_too_long');
  });

  it('allows at most 4 distinct photos', () => {
    const five = Array.from({ length: 5 }, () => upload);
    expect(wallInputError(wallPostInputSchema.safeParse({ ...web, uploadIds: five }).error!.issues)).toBe('too_many_photos');
    expect(wallInputError(wallPostInputSchema.safeParse({ ...web, uploadIds: [upload, upload] }).error!.issues)).toBe(
      'too_many_photos',
    );
  });

  it('needs exactly one of invite token or event id, and rejects unknown fields', () => {
    expect(wallTargetSchema.safeParse({ guestToken: web.guestToken }).success).toBe(false);
    expect(wallTargetSchema.safeParse({ ...web, ...app }).success).toBe(false);
    expect(wallTargetSchema.safeParse({ ...web, userId: app.eventId }).success).toBe(false);
    expect(wallTargetSchema.safeParse({ token: 'bad' }).success).toBe(false);
  });

  it('validates upload reservations', () => {
    expect(wallUploadInputSchema.safeParse({ ...web, contentType: 'image/heic', size: WALL_LIMITS.maxBytes }).success).toBe(true);
    const big = wallUploadInputSchema.safeParse({ ...web, contentType: 'image/jpeg', size: 12 * 1024 * 1024 });
    expect(wallInputError(big.error!.issues)).toBe('too_large');
    const pdf = wallUploadInputSchema.safeParse({ ...web, contentType: 'application/pdf', size: 10 });
    expect(wallInputError(pdf.error!.issues)).toBe('unsupported_type');
  });
});

describe('wall client prechecks', () => {
  it('checks size, count and quota before uploading', () => {
    expect(wallFilesPrecheck([{ size: 11 * 1024 * 1024, type: 'image/jpeg' }], 10)).toBe('too_large');
    expect(wallFilesPrecheck(Array.from({ length: 5 }, () => ({ size: 1 })), 10)).toBe('too_many_photos');
    expect(wallFilesPrecheck([{ size: 1 }, { size: 1 }], 1)).toBe('photo_quota');
    expect(wallFilesPrecheck([{ size: 1, type: 'image/gif' }], 10)).toBe('unsupported_type');
    expect(wallFilesPrecheck([{ size: 1, type: 'image/png' }], null)).toBeNull();
  });

  it('infers HEIC from the file name when the browser gives no type', () => {
    expect(wallContentType('IMG_0001.HEIC', '')).toBe('image/heic');
    expect(wallContentType('a.txt', 'text/plain')).toBeNull();
  });
});

describe('wall strings', () => {
  it('has a message for every error and reason in both languages', () => {
    for (const strings of [en, sv]) {
      for (const code of WALL_ERRORS) expect(strings.wall.errors[code]).toBeTruthy();
      for (const r of WALL_REASONS.filter((x) => x !== 'ok')) expect(strings.wall.reason[r]).toBeTruthy();
    }
  });
});
