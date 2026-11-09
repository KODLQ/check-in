import { z } from 'zod';

import { guestTokenSchema } from './schemas';

/**
 * Event wall (change: add-event-wall). Limits mirror `public.wall_limits()` in
 * supabase/migrations/20261108000022_event_wall_functions.sql (design §7: tunable constants, not spec values).
 */
export const WALL_LIMITS = {
  bodyMax: 500,
  photosPerPost: 4,
  photosPerGuest: 10,
  postsPer10Min: 10,
  reservationsPerHour: 20,
  postsPerEvent: 1000,
  photosPerEvent: 500,
  maxBytes: 10 * 1024 * 1024,
  pageSize: 30,
  openDaysAfterEnd: 14,
  /** Signed photo URLs (spec: links expire within one hour). */
  signedUrlSeconds: 3600,
  /** Per IP + invite (web tier). */
  writesPerIp: 30,
  readsPerIp: 120,
  ipWindowSeconds: 600,
} as const;

/** Declared types accepted for reservation; the server judges the real type from the bytes. */
export const WALL_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] as const;
export type WallContentType = (typeof WALL_CONTENT_TYPES)[number];

/** Why the post form is hidden (`can_post` from wall_feed). */
export const WALL_REASONS = ['ok', 'not_attending', 'blocked', 'disabled', 'closed', 'cancelled'] as const;
export type WallReason = (typeof WALL_REASONS)[number];

/** Error codes returned by /api/wall/*; each has a `wall.errors.<code>` string. */
export const WALL_ERRORS = [
  'not_found',
  'not_attending',
  'blocked',
  'disabled',
  'closed',
  'cancelled',
  'rate_limited',
  'wall_full',
  'photo_quota',
  'too_large',
  'unsupported_type',
  'invalid_image',
  'invalid_upload',
  'upload_not_found',
  'empty_post',
  'body_too_long',
  'too_many_photos',
  'forbidden',
  'unauthorized',
  'invalid',
  'unknown',
] as const;
export type WallError = (typeof WALL_ERRORS)[number];

export function isWallError(code: unknown): code is WallError {
  return typeof code === 'string' && (WALL_ERRORS as readonly string[]).includes(code);
}

/** Characters as Postgres counts them (code points), so "500 characters" means the same everywhere. */
export function wallTextLength(text: string): number {
  return [...text.trim()].length;
}

const inviteTokenSchema = z.string().regex(/^[A-Za-z0-9]{12}$/);

/**
 * Who is acting and on which wall. Web guests send the invite token + their device guest token; the app sends
 * a bearer token (verified server-side) with either the invite token or the event id.
 */
const actorShape = {
  token: inviteTokenSchema.optional(),
  eventId: z.guid().optional(),
  guestToken: guestTokenSchema.optional(),
};
const hasTarget = (v: { token?: string; eventId?: string }) => !!v.token !== !!v.eventId;
const targetIssue = { message: 'invalid', path: ['token'] };

export const wallTargetSchema = z.object(actorShape).strict().refine(hasTarget, targetIssue);
export type WallTarget = z.infer<typeof wallTargetSchema>;

export const wallPostInputSchema = z
  .object({
    ...actorShape,
    body: z.string().max(5000, 'body_too_long').optional(),
    uploadIds: z.array(z.guid()).max(WALL_LIMITS.photosPerPost, 'too_many_photos').default([]),
  })
  .strict()
  .refine(hasTarget, targetIssue)
  .superRefine((v, ctx) => {
    const length = wallTextLength(v.body ?? '');
    if (length > WALL_LIMITS.bodyMax) ctx.addIssue({ code: 'custom', message: 'body_too_long', path: ['body'] });
    if (length === 0 && v.uploadIds.length === 0) ctx.addIssue({ code: 'custom', message: 'empty_post', path: ['body'] });
    if (new Set(v.uploadIds).size !== v.uploadIds.length) {
      ctx.addIssue({ code: 'custom', message: 'too_many_photos', path: ['uploadIds'] });
    }
  });
export type WallPostInput = z.infer<typeof wallPostInputSchema>;

export const wallUploadInputSchema = z
  .object({
    ...actorShape,
    contentType: z.enum(WALL_CONTENT_TYPES, { error: 'unsupported_type' }),
    size: z.int('too_large').min(1, 'too_large').max(WALL_LIMITS.maxBytes, 'too_large'),
  })
  .strict()
  .refine(hasTarget, targetIssue);
export type WallUploadInput = z.infer<typeof wallUploadInputSchema>;

export const wallDeleteInputSchema = z
  .object({ ...actorShape, allByAuthor: z.boolean().optional() })
  .strict()
  .refine(hasTarget, targetIssue);

export const wallFeedQuerySchema = z
  .object({
    ...actorShape,
    before: z.iso.datetime({ offset: true }).optional(),
    beforeId: z.guid().optional(),
  })
  .strict()
  .refine(hasTarget, targetIssue);

/** Moderator actions: always by event id with a verified account. (z.guid: seed/test ids are not RFC 4122 v1-8.) */
export const wallBlockInputSchema = z.object({ eventId: z.guid(), postId: z.guid() }).strict();
export const wallUnblockInputSchema = z.object({ eventId: z.guid(), blockId: z.guid() }).strict();
export const wallSettingsInputSchema = z.object({ eventId: z.guid(), enabled: z.boolean() }).strict();

/** First issue's message as a WallError (schemas use error codes as messages). */
export function wallInputError(issues: readonly { message: string }[]): WallError {
  const code = issues[0]?.message;
  return isWallError(code) ? code : 'invalid';
}

export interface WallPhoto {
  id: string;
  width: number;
  height: number;
  /** Signed, expiring URLs (never public). */
  thumb_url: string;
  full_url: string;
}

export interface WallPost {
  id: string;
  display_name: string;
  is_host: boolean;
  body: string | null;
  created_at: string;
  mine: boolean;
  can_block: boolean;
  photos: WallPhoto[];
}

export type WallFeed =
  | { state: 'not_found' | 'disabled' }
  | {
      state: 'ok';
      wall_enabled: boolean;
      moderator: boolean;
      can_post: WallReason;
      photos_left: number | null;
      has_own_posts: boolean;
      posts: WallPost[];
      has_more: boolean;
      blocks: { id: string; display_name: string }[] | null;
    };

/**
 * Client-side prechecks before anything is uploaded (the server re-checks everything).
 * Returns the first error code or null.
 */
export function wallFilesPrecheck(
  files: readonly { size: number; type?: string | null }[],
  photosLeft: number | null,
): WallError | null {
  if (files.length > WALL_LIMITS.photosPerPost) return 'too_many_photos';
  if (photosLeft !== null && files.length > photosLeft) return 'photo_quota';
  for (const f of files) {
    if (f.size > WALL_LIMITS.maxBytes) return 'too_large';
    if (f.type && !(WALL_CONTENT_TYPES as readonly string[]).includes(f.type)) return 'unsupported_type';
  }
  return null;
}

/** Declared content type for a picked file (some browsers leave HEIC untyped). */
export function wallContentType(name: string, type: string | null | undefined): WallContentType | null {
  if (type && (WALL_CONTENT_TYPES as readonly string[]).includes(type)) return type as WallContentType;
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic') return 'image/heic';
  if (ext === 'heif') return 'image/heif';
  return null;
}
