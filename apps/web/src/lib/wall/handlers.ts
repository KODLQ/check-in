// Event wall API (change: add-event-wall, design §3-§6). One write path for web guests, app guests and hosts:
// every /api/wall/* route calls a handler here with real dependencies (deps.ts); unit tests pass mocks.
//
// Order in every handler: validate input (Zod) -> resolve the actor (bearer token verified with
// auth.getUser, or the device guest token) -> per-IP rate limit -> service-role RPC (which re-checks the
// invite link, eligibility, quotas and caps) -> storage work. Nothing is signed or stored before the RPC
// accepted the actor.
import {
  isWallError,
  WALL_LIMITS,
  wallBlockInputSchema,
  wallDeleteInputSchema,
  wallFeedQuerySchema,
  wallInputError,
  wallPostInputSchema,
  wallSettingsInputSchema,
  wallTargetSchema,
  wallUnblockInputSchema,
  wallUploadInputSchema,
  type WallError,
  type WallFeed,
  type WallPost,
} from '@check-in/shared';

import { ImageRejected, processImage, type ProcessedImage } from './image';

type DbError = { message: string; details?: string | null } | null;
type DbResult<T = unknown> = { data: T | null; error: DbError };

/** The parts of the Supabase service client the wall uses (typed loosely so tests can mock it). */
export interface WallBucket {
  createSignedUploadUrl(path: string): Promise<DbResult<{ signedUrl: string; token: string; path: string }>>;
  createSignedUrls(paths: string[], expiresIn: number): Promise<DbResult<{ path: string | null; signedUrl: string; error: string | null }[]>>;
  download(path: string): Promise<DbResult<Blob>>;
  upload(path: string, body: Buffer, options: { contentType: string; upsert: boolean; cacheControl?: string }): Promise<DbResult>;
  remove(paths: string[]): Promise<DbResult>;
}
export interface WallDb {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  storage: { from(bucket: 'wall' | 'wall-incoming'): WallBucket };
}
export interface WallDeps {
  db: WallDb;
  /** Verified user id for a Supabase access token, or null if it is invalid/expired. */
  getUser(jwt: string): Promise<string | null>;
  /** Counts one hit in a fixed window; false when over the limit. */
  rateLimit(bucket: string, max: number, windowSeconds: number): Promise<boolean>;
  /** Salted hash of the client IP (never the raw IP). */
  ipHash(req: Request): string;
  /** WALL_ENABLED feature flag (design: migration plan). Off -> every route 404s. */
  enabled: boolean;
  process?: (input: Uint8Array) => Promise<ProcessedImage>;
}

const STATUS: Record<WallError, number> = {
  not_found: 404,
  upload_not_found: 404,
  not_attending: 403,
  blocked: 403,
  forbidden: 403,
  disabled: 409,
  closed: 409,
  cancelled: 409,
  wall_full: 409,
  photo_quota: 409,
  invalid_upload: 409,
  rate_limited: 429,
  too_large: 413,
  unsupported_type: 415,
  invalid_image: 422,
  empty_post: 400,
  body_too_long: 400,
  too_many_photos: 400,
  invalid: 400,
  unauthorized: 401,
  unknown: 500,
};

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function wallError(code: WallError): Response {
  return json({ error: code }, STATUS[code]);
}

/** Database error message -> error code. Longer codes first (upload_not_found contains not_found). */
export function mapDbError(error: DbError): WallError {
  const m = error?.message ?? '';
  const codes = (Object.keys(STATUS) as WallError[]).sort((a, b) => b.length - a.length);
  return codes.find((c) => c !== 'unknown' && m.includes(c)) ?? 'unknown';
}

export interface Actor {
  token: string | null;
  eventId: string | null;
  userId: string | null;
  guestToken: string | null;
}

const rpcActor = (a: Actor) => ({
  p_token: a.token,
  p_event_id: a.eventId,
  p_user_id: a.userId,
  p_guest_token: a.guestToken,
});

/**
 * Who is calling. A bearer token must verify (else 401) and then wins over any guest token. The event-id
 * form is only for verified accounts. Writes need an identity (account or device guest token).
 */
export async function resolveActor(
  req: Request,
  input: { token?: string; eventId?: string; guestToken?: string },
  deps: WallDeps,
  opts: { write: boolean },
): Promise<Actor | Response> {
  const auth = req.headers.get('authorization');
  let userId: string | null = null;
  if (auth) {
    const m = /^Bearer\s+(\S+)$/i.exec(auth);
    userId = m ? await deps.getUser(m[1]!) : null;
    if (!userId) return wallError('unauthorized');
  }
  if (input.eventId && !userId) return wallError('unauthorized');
  const guestToken = userId ? null : (input.guestToken ?? null);
  if (opts.write && !userId && !guestToken) return wallError('invalid');
  return { token: input.token ?? null, eventId: input.eventId ?? null, userId, guestToken };
}

async function writeAllowed(req: Request, a: Actor, deps: WallDeps): Promise<boolean> {
  return deps.rateLimit(`wall:${deps.ipHash(req)}:${a.token ?? a.eventId}`, WALL_LIMITS.writesPerIp, WALL_LIMITS.ipWindowSeconds);
}

async function readJson(req: Request): Promise<unknown> {
  return req.json().catch(() => null);
}

type QueueRow = { id: number; bucket: 'wall' | 'wall-incoming'; path: string };

/**
 * Removes queued storage objects now (user-initiated deletes) so the photos stop loading immediately; rows
 * that fail stay queued for the storage-cleanup cron.
 */
export async function drainQueue(db: WallDb, rows: QueueRow[]): Promise<number> {
  let removed = 0;
  for (const bucket of ['wall', 'wall-incoming'] as const) {
    const batch = rows.filter((r) => r.bucket === bucket);
    if (batch.length === 0) continue;
    const { error } = await db.storage.from(bucket).remove(batch.map((r) => r.path));
    if (error) {
      await db.rpc('storage_queue_failed', { p_ids: batch.map((r) => r.id), p_error: error.message });
      continue;
    }
    await db.rpc('storage_queue_done', { p_ids: batch.map((r) => r.id) });
    removed += batch.length;
  }
  return removed;
}

// ---------------------------------------------------------------------------------------------------------
// Feed

type RawPhoto = { id: string; full_path: string; thumb_path: string; width: number; height: number };
type RawFeed =
  | Exclude<WallFeed, { state: 'ok' }>
  | (Omit<Extract<WallFeed, { state: 'ok' }>, 'posts'> & { posts: (Omit<WallPost, 'photos'> & { photos: RawPhoto[] })[] });

/** Replaces storage paths with signed URLs (≤ 1 h). Paths never leave the server. */
export async function signFeed(db: WallDb, feed: RawFeed): Promise<WallFeed> {
  if (feed.state !== 'ok') return feed;
  const paths = feed.posts.flatMap((p) => p.photos.flatMap((ph) => [ph.thumb_path, ph.full_path]));
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await db.storage.from('wall').createSignedUrls(paths, WALL_LIMITS.signedUrlSeconds);
    for (const s of data ?? []) if (s.path && !s.error) urls.set(s.path, s.signedUrl);
  }
  return {
    ...feed,
    posts: feed.posts.map((p) => ({
      ...p,
      photos: p.photos
        .filter((ph) => urls.has(ph.thumb_path) && urls.has(ph.full_path))
        .map((ph) => ({ id: ph.id, width: ph.width, height: ph.height, thumb_url: urls.get(ph.thumb_path)!, full_url: urls.get(ph.full_path)! })),
    })),
  };
}

/** Loads one feed page for an already resolved actor (used by GET /api/wall and the invite page). */
export async function loadFeed(db: WallDb, a: Actor, cursor?: { before?: string; beforeId?: string }): Promise<WallFeed> {
  const { data, error } = await db.rpc('wall_feed', {
    ...rpcActor(a),
    p_before_created_at: cursor?.before ?? null,
    p_before_id: cursor?.beforeId ?? null,
    p_limit: WALL_LIMITS.pageSize,
  });
  if (error || !data) return { state: 'not_found' };
  return signFeed(db, data as RawFeed);
}

/** GET /api/wall?token=…|eventId=…&before=…&beforeId=… (web guests: guest token from the ci_guest cookie). */
export async function getFeed(req: Request, deps: WallDeps): Promise<Response> {
  if (!deps.enabled) return wallError('not_found');
  const url = new URL(req.url);
  const query = Object.fromEntries([...url.searchParams].filter(([k]) => ['token', 'eventId', 'before', 'beforeId'].includes(k)));
  const parsed = wallFeedQuerySchema.safeParse(query);
  if (!parsed.success) return wallError('invalid');
  const cookie = /(?:^|;\s*)ci_guest=([A-Za-z0-9_-]{22,64})/.exec(req.headers.get('cookie') ?? '')?.[1];
  const actor = await resolveActor(req, { ...parsed.data, guestToken: cookie }, deps, { write: false });
  if (actor instanceof Response) return actor;
  if (!(await deps.rateLimit(`wall-read:${deps.ipHash(req)}`, WALL_LIMITS.readsPerIp, WALL_LIMITS.ipWindowSeconds))) {
    return wallError('rate_limited');
  }
  const feed = await loadFeed(deps.db, actor, parsed.data);
  return json(feed, feed.state === 'not_found' ? 404 : 200);
}

// ---------------------------------------------------------------------------------------------------------
// Uploads

/** POST /api/wall/uploads → { uploadId, signedUploadUrl } for a single PUT into the quarantine bucket. */
export async function reserveUpload(req: Request, deps: WallDeps): Promise<Response> {
  if (!deps.enabled) return wallError('not_found');
  const parsed = wallUploadInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return wallError(wallInputError(parsed.error.issues));
  const actor = await resolveActor(req, parsed.data, deps, { write: true });
  if (actor instanceof Response) return actor;
  if (!(await writeAllowed(req, actor, deps))) return wallError('rate_limited');

  const { data, error } = await deps.db.rpc('wall_reserve_upload', {
    ...rpcActor(actor),
    p_content_type: parsed.data.contentType,
    p_size: parsed.data.size,
  });
  if (error || !data) return wallError(mapDbError(error));
  const { upload_id, incoming_path } = data as { upload_id: string; incoming_path: string };
  // Unique path + no upsert: the URL can write exactly one object, once.
  const signed = await deps.db.storage.from('wall-incoming').createSignedUploadUrl(incoming_path);
  if (signed.error || !signed.data) return wallError('unknown');
  return json({ uploadId: upload_id, signedUploadUrl: signed.data.signedUrl }, 201);
}

/** POST /api/wall/uploads/:id/complete: download, verify, re-encode without metadata, store, mark ready. */
export async function completeUpload(req: Request, deps: WallDeps, uploadId: string): Promise<Response> {
  if (!deps.enabled) return wallError('not_found');
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) return wallError('upload_not_found');
  const parsed = wallTargetSchema.safeParse(await readJson(req));
  if (!parsed.success) return wallError('invalid');
  const actor = await resolveActor(req, parsed.data, deps, { write: true });
  if (actor instanceof Response) return actor;
  if (!(await writeAllowed(req, actor, deps))) return wallError('rate_limited');

  const claimed = await deps.db.rpc('wall_claim_upload', { p_upload_id: uploadId, ...rpcActor(actor) });
  if (claimed.error || !claimed.data) return wallError(mapDbError(claimed.error));
  const { event_id, incoming_path } = claimed.data as { event_id: string; incoming_path: string };
  const incoming = deps.db.storage.from('wall-incoming');

  const reject = async (code: WallError) => {
    await deps.db.rpc('wall_mark_upload', { p_upload_id: uploadId, p_status: 'rejected' });
    // Best effort now; the row's delete trigger also queued it for the cleanup cron.
    await incoming.remove([incoming_path]);
    return wallError(code);
  };

  const file = await incoming.download(incoming_path);
  if (file.error || !file.data) return reject('invalid_upload');
  let out: ProcessedImage;
  try {
    out = await (deps.process ?? processImage)(new Uint8Array(await file.data.arrayBuffer()));
  } catch (e) {
    return reject(e instanceof ImageRejected ? e.code : 'invalid_image');
  }

  const fullPath = `${event_id}/${uploadId}/full.jpg`;
  const thumbPath = `${event_id}/${uploadId}/thumb.jpg`;
  const wall = deps.db.storage.from('wall');
  const opts = { contentType: 'image/jpeg', upsert: false, cacheControl: '3600' };
  const [full, thumb] = await Promise.all([wall.upload(fullPath, out.full, opts), wall.upload(thumbPath, out.thumb, opts)]);
  if (full.error || thumb.error) {
    await wall.remove([fullPath, thumbPath]);
    return reject('unknown');
  }
  const marked = await deps.db.rpc('wall_mark_upload', {
    p_upload_id: uploadId,
    p_status: 'ready',
    p_full_path: fullPath,
    p_thumb_path: thumbPath,
    p_width: out.width,
    p_height: out.height,
  });
  if (marked.error || marked.data !== true) {
    await wall.remove([fullPath, thumbPath]);
    return wallError('upload_not_found');
  }
  // The original (with whatever metadata it had) is never kept or served.
  await incoming.remove([incoming_path]);
  const preview = await wall.createSignedUrls([thumbPath], WALL_LIMITS.signedUrlSeconds);
  return json({ uploadId, width: out.width, height: out.height, thumbUrl: preview.data?.[0]?.signedUrl ?? null });
}

// ---------------------------------------------------------------------------------------------------------
// Posts

/** POST /api/wall/posts { body?, uploadIds[] } */
export async function createPost(req: Request, deps: WallDeps): Promise<Response> {
  if (!deps.enabled) return wallError('not_found');
  const parsed = wallPostInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return wallError(wallInputError(parsed.error.issues));
  const actor = await resolveActor(req, parsed.data, deps, { write: true });
  if (actor instanceof Response) return actor;
  if (!(await writeAllowed(req, actor, deps))) return wallError('rate_limited');
  const { data, error } = await deps.db.rpc('wall_create_post', {
    ...rpcActor(actor),
    p_body: parsed.data.body ?? null,
    p_upload_ids: parsed.data.uploadIds,
  });
  if (error || !data) return wallError(mapDbError(error));
  return json(data, 201);
}

async function deleteWith(req: Request, deps: WallDeps, fn: 'wall_delete_post' | 'wall_delete_mine', postId?: string) {
  if (!deps.enabled) return wallError('not_found');
  if (postId !== undefined && !/^[0-9a-f-]{36}$/i.test(postId)) return wallError('not_found');
  const parsed = wallDeleteInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return wallError('invalid');
  const actor = await resolveActor(req, parsed.data, deps, { write: true });
  if (actor instanceof Response) return actor;
  if (!(await writeAllowed(req, actor, deps))) return wallError('rate_limited');
  const args = fn === 'wall_delete_post'
    ? { p_post_id: postId, ...rpcActor(actor), p_all_by_author: parsed.data.allByAuthor ?? false }
    : rpcActor(actor);
  const { data, error } = await deps.db.rpc(fn, args);
  if (error || !data) return wallError(mapDbError(error));
  const result = data as { deleted: number; queue: QueueRow[] };
  await drainQueue(deps.db, result.queue);
  return json({ deleted: result.deleted });
}

/** DELETE /api/wall/posts/:id { allByAuthor? } — own post, or any post (or all by its author) as moderator. */
export const deletePost = (req: Request, deps: WallDeps, postId: string) => deleteWith(req, deps, 'wall_delete_post', postId);

/** DELETE /api/wall/mine — every post the caller made on the event. */
export const deleteMine = (req: Request, deps: WallDeps) => deleteWith(req, deps, 'wall_delete_mine');

/** Used by DELETE /api/rsvp { deletePosts: true } before withdrawing (same identity as the RSVP). */
export async function deleteMineForGuest(db: WallDb, token: string, guestToken: string): Promise<boolean> {
  const { data, error } = await db.rpc('wall_delete_mine', { p_token: token, p_event_id: null, p_user_id: null, p_guest_token: guestToken });
  // A link that no longer works has nothing this device could delete through it; the withdrawal decides.
  if (error) return mapDbError(error) === 'not_found';
  if (!data) return false;
  await drainQueue(db, (data as { queue: QueueRow[] }).queue);
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Moderation (verified accounts only; the RPCs check can_moderate_event)

async function moderator(req: Request, deps: WallDeps): Promise<string | Response> {
  if (!deps.enabled) return wallError('not_found');
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  const userId = m ? await deps.getUser(m[1]!) : null;
  return userId ?? wallError('unauthorized');
}

export async function blockAuthor(req: Request, deps: WallDeps): Promise<Response> {
  const userId = await moderator(req, deps);
  if (userId instanceof Response) return userId;
  const parsed = wallBlockInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return wallError('invalid');
  const { data, error } = await deps.db.rpc('wall_block_author', {
    p_post_id: parsed.data.postId, p_event_id: parsed.data.eventId, p_user_id: userId,
  });
  if (error || !data) return wallError(mapDbError(error));
  return json(data, 201);
}

export async function unblock(req: Request, deps: WallDeps): Promise<Response> {
  const userId = await moderator(req, deps);
  if (userId instanceof Response) return userId;
  const parsed = wallUnblockInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return wallError('invalid');
  const { data, error } = await deps.db.rpc('wall_unblock', {
    p_block_id: parsed.data.blockId, p_event_id: parsed.data.eventId, p_user_id: userId,
  });
  if (error) return wallError(mapDbError(error));
  return json({ unblocked: data === true });
}

export async function setEnabled(req: Request, deps: WallDeps): Promise<Response> {
  const userId = await moderator(req, deps);
  if (userId instanceof Response) return userId;
  const parsed = wallSettingsInputSchema.safeParse(await readJson(req));
  if (!parsed.success) return wallError('invalid');
  const { data, error } = await deps.db.rpc('wall_set_enabled', {
    p_event_id: parsed.data.eventId, p_user_id: userId, p_enabled: parsed.data.enabled,
  });
  if (error) return wallError(mapDbError(error));
  return json({ enabled: data === true });
}

// ---------------------------------------------------------------------------------------------------------
// Storage cleanup cron (design §6)

export const MAX_CLEANUP_ATTEMPTS = 5;

/** Drains due queue rows (with retries/backoff in SQL) after queueing orphaned objects. */
export async function runStorageCleanup(db: WallDb, log: (msg: string) => void = console.error) {
  const orphans = await db.rpc('wall_enqueue_orphans');
  let removed = 0;
  let failed = 0;
  for (let round = 0; round < 10; round++) {
    const { data } = await db.rpc('storage_queue_claim', { p_limit: 200 });
    const rows = (data ?? []) as (QueueRow & { attempts: number })[];
    if (rows.length === 0) break;
    const done = await drainQueue(db, rows);
    removed += done;
    failed += rows.length - done;
    const stuck = rows.filter((r) => r.attempts >= MAX_CLEANUP_ATTEMPTS);
    if (rows.length - done > 0 && stuck.length > 0) {
      // Alert: picked up by log-based alerting (design §6: alert after 5 attempts).
      log(`[storage-cleanup] ALERT ${stuck.length} object(s) failed ${MAX_CLEANUP_ATTEMPTS}+ times`);
    }
  }
  return { orphansQueued: (orphans.data as number | null) ?? 0, removed, failed };
}

export { isWallError };
