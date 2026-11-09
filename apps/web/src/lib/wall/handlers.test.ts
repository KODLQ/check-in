import { describe, expect, it, vi } from 'vitest';

import {
  blockAuthor,
  completeUpload,
  createPost,
  deleteMine,
  deletePost,
  getFeed,
  mapDbError,
  reserveUpload,
  runStorageCleanup,
  setEnabled,
  type WallBucket,
  type WallDb,
  type WallDeps,
} from './handlers';
import { ImageRejected } from './image';

const TOKEN = 'AbCdEfGh1234';
const GUEST = 'guest-token-aaaaaaaaaaaa';
const EVENT = '6f9619ff-8b86-4d11-b42d-00c04fc964ff';
const UPLOAD = '1b4e28ba-2fa1-4d3b-a3f5-ef19b5a7633b';
const POST_ID = '3d8b6a3e-7c1f-4a0e-9a57-0d8c1a2b3c4d';
const USER = '00000000-0000-0000-0000-00000000c0a1';

type RpcImpl = (fn: string, args?: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function bucket(overrides: Partial<WallBucket> = {}): WallBucket {
  return {
    createSignedUploadUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://s/upload/${path}?token=t`, token: 't', path }, error: null })),
    createSignedUrls: vi.fn(async (paths: string[], expiresIn: number) => ({
      data: paths.map((p) => ({ path: p, signedUrl: `https://s/sign/${p}?exp=${expiresIn}`, error: null })),
      error: null,
    })),
    download: vi.fn(async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]), error: null })),
    upload: vi.fn(async () => ({ data: {}, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    ...overrides,
  };
}

function setup(rpcImpl: RpcImpl = () => ({ data: null, error: null }), opts: Partial<WallDeps> & { wall?: WallBucket; incoming?: WallBucket } = {}) {
  const wall = opts.wall ?? bucket();
  const incoming = opts.incoming ?? bucket();
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => rpcImpl(fn, args));
  const db: WallDb = { rpc, storage: { from: (b) => (b === 'wall' ? wall : incoming) } };
  const deps: WallDeps = {
    db,
    enabled: true,
    getUser: vi.fn(async (jwt: string) => (jwt === 'valid-jwt' ? USER : null)),
    rateLimit: vi.fn(async () => true),
    ipHash: () => 'iphash',
    ...opts,
  };
  return { deps, rpc, wall, incoming };
}

const req = (method: string, body?: unknown, headers: Record<string, string> = {}, url = 'http://localhost/api/wall') =>
  new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error;

describe('actor resolution', () => {
  it('rejects an invalid or expired bearer token with 401, before any database call', async () => {
    const { deps, rpc } = setup();
    const r = await createPost(req('POST', { eventId: EVENT, body: 'hi' }, { authorization: 'Bearer expired-jwt' }), deps);
    expect(r.status).toBe(401);
    expect(await errorOf(r)).toBe('unauthorized');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed Authorization header', async () => {
    const { deps } = setup();
    expect((await createPost(req('POST', { token: TOKEN, guestToken: GUEST, body: 'hi' }, { authorization: 'Basic abc' }), deps)).status).toBe(401);
  });

  it('requires an account for the event-id form', async () => {
    const { deps } = setup();
    expect((await createPost(req('POST', { eventId: EVENT, guestToken: GUEST, body: 'hi' }), deps)).status).toBe(401);
  });

  it('rejects a web write without a guest token', async () => {
    const { deps, rpc } = setup();
    const r = await createPost(req('POST', { token: TOKEN, body: 'hi' }), deps);
    expect(r.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes the VERIFIED user id, never one from the body, and drops the guest token for accounts', async () => {
    const { deps, rpc } = setup(() => ({ data: { id: POST_ID }, error: null }));
    const bad = await createPost(req('POST', { token: TOKEN, userId: 'forged', body: 'hi' }, { authorization: 'Bearer valid-jwt' }), deps);
    expect(bad.status).toBe(400); // unknown fields are rejected
    const r = await createPost(req('POST', { token: TOKEN, guestToken: GUEST, body: 'hi' }, { authorization: 'Bearer valid-jwt' }), deps);
    expect(r.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('wall_create_post', expect.objectContaining({ p_user_id: USER, p_guest_token: null, p_token: TOKEN }));
  });

  it('returns 429 when the per-IP limit is exceeded, without calling the RPC', async () => {
    const { deps, rpc } = setup(undefined, { rateLimit: vi.fn(async () => false) });
    const r = await createPost(req('POST', { token: TOKEN, guestToken: GUEST, body: 'hi' }), deps);
    expect(r.status).toBe(429);
    expect(await errorOf(r)).toBe('rate_limited');
    expect(rpc).not.toHaveBeenCalled();
    expect(deps.rateLimit).toHaveBeenCalledWith(`wall:iphash:${TOKEN}`, 30, 600);
  });

  it('404s everything while the WALL_ENABLED flag is off', async () => {
    const { deps } = setup(undefined, { enabled: false });
    expect((await getFeed(req('GET', undefined, {}, `http://localhost/api/wall?token=${TOKEN}`), deps)).status).toBe(404);
    expect((await createPost(req('POST', { token: TOKEN, guestToken: GUEST, body: 'hi' }), deps)).status).toBe(404);
  });
});

describe('error mapping', () => {
  it.each([
    ['not_found', 404],
    ['closed', 409],
    ['cancelled', 409],
    ['not_attending', 403],
    ['blocked', 403],
    ['rate_limited', 429],
    ['wall_full', 409],
    ['photo_quota', 409],
    ['empty_post', 400],
  ])('%s -> %i', async (code, status) => {
    const { deps } = setup(() => ({ data: null, error: { message: code } }));
    const r = await createPost(req('POST', { token: TOKEN, guestToken: GUEST, body: 'hi' }), deps);
    expect(r.status).toBe(status);
    expect(await errorOf(r)).toBe(code);
  });

  it('does not confuse upload_not_found with not_found', () => {
    expect(mapDbError({ message: 'upload_not_found' })).toBe('upload_not_found');
    expect(mapDbError({ message: 'something else' })).toBe('unknown');
  });

  it('validates input before anything else', async () => {
    const { deps, rpc } = setup();
    expect(await errorOf(await createPost(req('POST', { token: TOKEN, guestToken: GUEST, body: '   ' }), deps))).toBe('empty_post');
    expect(await errorOf(await createPost(req('POST', { token: TOKEN, guestToken: GUEST, body: 'x'.repeat(501) }), deps))).toBe('body_too_long');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('uploads', () => {
  it('rejects oversize and unknown types before reserving', async () => {
    const { deps, rpc } = setup();
    const big = await reserveUpload(req('POST', { token: TOKEN, guestToken: GUEST, contentType: 'image/jpeg', size: 12 * 1024 * 1024 }), deps);
    expect(big.status).toBe(413);
    const gif = await reserveUpload(req('POST', { token: TOKEN, guestToken: GUEST, contentType: 'image/gif', size: 10 }), deps);
    expect(gif.status).toBe(415);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns a signed upload URL for the reserved quarantine path only', async () => {
    const path = `${EVENT}/${UPLOAD}`;
    const { deps, incoming } = setup(() => ({ data: { upload_id: UPLOAD, incoming_path: path }, error: null }));
    const r = await reserveUpload(req('POST', { token: TOKEN, guestToken: GUEST, contentType: 'image/heic', size: 1000 }), deps);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ uploadId: UPLOAD, signedUploadUrl: `https://s/upload/${path}?token=t` });
    expect(incoming.createSignedUploadUrl).toHaveBeenCalledWith(path);
  });

  it('does not sign anything when the reservation is refused (quota)', async () => {
    const { deps, incoming } = setup(() => ({ data: null, error: { message: 'photo_quota' } }));
    const r = await reserveUpload(req('POST', { token: TOKEN, guestToken: GUEST, contentType: 'image/jpeg', size: 1000 }), deps);
    expect(r.status).toBe(409);
    expect(incoming.createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('a different actor cannot complete the upload (claim fails -> 404, nothing downloaded)', async () => {
    const { deps, incoming } = setup((fn) =>
      fn === 'wall_claim_upload' ? { data: null, error: { message: 'upload_not_found' } } : { data: null, error: null },
    );
    const r = await completeUpload(req('POST', { token: TOKEN, guestToken: 'someone-else-aaaaaaaaaa' }), deps, UPLOAD);
    expect(r.status).toBe(404);
    expect(incoming.download).not.toHaveBeenCalled();
  });

  it('rejects a file that is not an image: row rejected, quarantine object removed, nothing stored', async () => {
    const calls: string[] = [];
    const { deps, wall, incoming } = setup(
      (fn, args) => {
        calls.push(`${fn}:${(args?.p_status as string) ?? ''}`);
        if (fn === 'wall_claim_upload') return { data: { event_id: EVENT, incoming_path: `${EVENT}/${UPLOAD}` }, error: null };
        return { data: true, error: null };
      },
      { process: async () => { throw new ImageRejected('invalid_image'); } },
    );
    const r = await completeUpload(req('POST', { token: TOKEN, guestToken: GUEST }), deps, UPLOAD);
    expect(r.status).toBe(422);
    expect(await errorOf(r)).toBe('invalid_image');
    expect(calls).toEqual(['wall_claim_upload:', 'wall_mark_upload:rejected']);
    expect(incoming.remove).toHaveBeenCalledWith([`${EVENT}/${UPLOAD}`]);
    expect(wall.upload).not.toHaveBeenCalled();
  });

  it('stores only the re-encoded renditions, marks ready, deletes the original', async () => {
    const { deps, rpc, wall, incoming } = setup(
      (fn) => (fn === 'wall_claim_upload'
        ? { data: { event_id: EVENT, incoming_path: `${EVENT}/${UPLOAD}` }, error: null }
        : { data: true, error: null }),
      { process: async () => ({ full: Buffer.from('FULL'), thumb: Buffer.from('THUMB'), width: 2048, height: 1536, format: 'heic' as const }) },
    );
    const r = await completeUpload(req('POST', { token: TOKEN, guestToken: GUEST }), deps, UPLOAD);
    expect(r.status).toBe(200);
    expect(wall.upload).toHaveBeenCalledWith(`${EVENT}/${UPLOAD}/full.jpg`, Buffer.from('FULL'), expect.objectContaining({ contentType: 'image/jpeg', upsert: false }));
    expect(wall.upload).toHaveBeenCalledWith(`${EVENT}/${UPLOAD}/thumb.jpg`, Buffer.from('THUMB'), expect.anything());
    expect(rpc).toHaveBeenCalledWith('wall_mark_upload', expect.objectContaining({ p_status: 'ready', p_width: 2048, p_height: 1536 }));
    expect(incoming.remove).toHaveBeenCalledWith([`${EVENT}/${UPLOAD}`]);
  });

  it('maps a too-large file found at processing time to 413', async () => {
    const { deps } = setup(
      (fn) => (fn === 'wall_claim_upload' ? { data: { event_id: EVENT, incoming_path: 'p' }, error: null } : { data: true, error: null }),
      { process: async () => { throw new ImageRejected('too_large'); } },
    );
    expect((await completeUpload(req('POST', { token: TOKEN, guestToken: GUEST }), deps, UPLOAD)).status).toBe(413);
  });
});

describe('feed', () => {
  const rawFeed = {
    state: 'ok', wall_enabled: true, moderator: false, can_post: 'ok', photos_left: 10, has_own_posts: false, has_more: false, blocks: null,
    posts: [{
      id: POST_ID, display_name: 'Sara', is_host: false, body: 'hi', created_at: '2026-11-09T10:00:00Z', mine: false, can_block: false,
      photos: [{ id: 'ph1', full_path: `${EVENT}/u/full.jpg`, thumb_path: `${EVENT}/u/thumb.jpg`, width: 10, height: 10 }],
    }],
  };

  it('signs photo URLs only after wall_feed succeeded, for at most an hour, and never leaks paths', async () => {
    const { deps, rpc, wall } = setup(() => ({ data: rawFeed, error: null }));
    const r = await getFeed(req('GET', undefined, { cookie: `ci_guest=${GUEST}` }, `http://localhost/api/wall?token=${TOKEN}`), deps);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(rpc).toHaveBeenCalledWith('wall_feed', expect.objectContaining({ p_token: TOKEN, p_guest_token: GUEST }));
    const signCall = (wall.createSignedUrls as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(signCall[1]).toBeLessThanOrEqual(3600);
    const body = await r.json();
    expect(body.posts[0].photos[0]).toEqual({ id: 'ph1', width: 10, height: 10, thumb_url: expect.stringContaining('exp=3600'), full_url: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain('_path');
  });

  it('signs nothing for revoked or unknown links', async () => {
    const { deps, wall } = setup(() => ({ data: { state: 'not_found' }, error: null }));
    const r = await getFeed(req('GET', undefined, {}, `http://localhost/api/wall?token=${TOKEN}`), deps);
    expect(r.status).toBe(404);
    expect(wall.createSignedUrls).not.toHaveBeenCalled();
  });

  it('signs nothing when the database refuses the read', async () => {
    const { deps, wall } = setup(() => ({ data: null, error: { message: 'permission denied' } }));
    const r = await getFeed(req('GET', undefined, { authorization: 'Bearer valid-jwt' }, `http://localhost/api/wall?eventId=${EVENT}`), deps);
    expect(r.status).toBe(404);
    expect(wall.createSignedUrls).not.toHaveBeenCalled();
  });

  it('rate limits reads per IP', async () => {
    const { deps } = setup(() => ({ data: rawFeed, error: null }), { rateLimit: vi.fn(async () => false) });
    expect((await getFeed(req('GET', undefined, {}, `http://localhost/api/wall?token=${TOKEN}`), deps)).status).toBe(429);
  });
});

describe('deletes and moderation', () => {
  it('removes the post\'s files synchronously and acknowledges the queue rows', async () => {
    const queue = [
      { id: 1, bucket: 'wall', path: 'e/u/full.jpg' },
      { id: 2, bucket: 'wall', path: 'e/u/thumb.jpg' },
    ];
    const { deps, rpc, wall } = setup((fn) => (fn === 'wall_delete_post' ? { data: { deleted: 1, queue }, error: null } : { data: 2, error: null }));
    const r = await deletePost(req('DELETE', { token: TOKEN, guestToken: GUEST }), deps, POST_ID);
    expect(r.status).toBe(200);
    expect(wall.remove).toHaveBeenCalledWith(['e/u/full.jpg', 'e/u/thumb.jpg']);
    expect(rpc).toHaveBeenCalledWith('storage_queue_done', { p_ids: [1, 2] });
  });

  it('maps someone else\'s post to 403', async () => {
    const { deps } = setup(() => ({ data: null, error: { message: 'forbidden' } }));
    expect((await deletePost(req('DELETE', { token: TOKEN, guestToken: GUEST }), deps, POST_ID)).status).toBe(403);
  });

  it('keeps failed removals queued for the cron', async () => {
    const { deps, rpc } = setup(
      (fn) => (fn === 'wall_delete_mine' ? { data: { deleted: 1, queue: [{ id: 9, bucket: 'wall', path: 'x' }] }, error: null } : { data: null, error: null }),
      { wall: bucket({ remove: vi.fn(async () => ({ data: null, error: { message: 'storage down' } })) }) },
    );
    expect((await deleteMine(req('DELETE', { token: TOKEN, guestToken: GUEST }), deps)).status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('storage_queue_failed', { p_ids: [9], p_error: 'storage down' });
    expect(rpc).not.toHaveBeenCalledWith('storage_queue_done', expect.anything());
  });

  it('moderator routes need a verified account', async () => {
    const { deps, rpc } = setup();
    expect((await blockAuthor(req('POST', { eventId: EVENT, postId: POST_ID }), deps)).status).toBe(401);
    expect((await setEnabled(req('PATCH', { eventId: EVENT, enabled: false }, { authorization: 'Bearer nope' }), deps)).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes the verified moderator id to the RPC', async () => {
    const { deps, rpc } = setup(() => ({ data: false, error: null }));
    const r = await setEnabled(req('PATCH', { eventId: EVENT, enabled: false }, { authorization: 'Bearer valid-jwt' }), deps);
    expect(await r.json()).toEqual({ enabled: false });
    expect(rpc).toHaveBeenCalledWith('wall_set_enabled', { p_event_id: EVENT, p_user_id: USER, p_enabled: false });
  });
});

describe('storage cleanup', () => {
  it('queues orphans, drains due rows and alerts on repeated failures', async () => {
    let round = 0;
    const log = vi.fn();
    const { deps } = setup(
      (fn) => {
        if (fn === 'wall_enqueue_orphans') return { data: 1, error: null };
        if (fn === 'storage_queue_claim') {
          round += 1;
          return round === 1
            ? { data: [{ id: 1, bucket: 'wall', path: 'a', attempts: 1 }, { id: 2, bucket: 'wall-incoming', path: 'b', attempts: 5 }], error: null }
            : { data: [], error: null };
        }
        return { data: 1, error: null };
      },
      { incoming: bucket({ remove: vi.fn(async () => ({ data: null, error: { message: 'boom' } })) }) },
    );
    const result = await runStorageCleanup(deps.db, log);
    expect(result).toEqual({ orphansQueued: 1, removed: 1, failed: 1 });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('ALERT'));
  });
});
