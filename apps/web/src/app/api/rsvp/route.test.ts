import { beforeEach, describe, expect, it, vi } from 'vitest';

// DELETE /api/rsvp { deletePosts } (add-event-wall task 4.6): posts are deleted first, only when asked.
const calls: string[] = [];
const rpc = vi.fn(async (fn: string) => {
  calls.push(fn);
  if (fn === 'wall_delete_mine') return { data: { deleted: 2, queue: [{ id: 1, bucket: 'wall', path: 'e/u/full.jpg' }] }, error: null };
  if (fn === 'withdraw_rsvp') return { data: true, error: null };
  return { data: 1, error: null };
});
const remove = vi.fn(async () => ({ data: [], error: null }));
const db = { rpc, storage: { from: () => ({ remove }) } };

vi.mock('@/lib/env', () => ({ env: { rateLimitSalt: 's', emailUpdatesEnabled: false } }));
vi.mock('@/lib/rate-limit', () => ({ allowedWrite: vi.fn(async () => true) }));
vi.mock('@/lib/supabase', () => ({ serviceClient: () => db }));
vi.mock('@/lib/wall/deps', () => ({ wallDb: () => db }));

const { DELETE } = await import('./route');

const withdraw = (body: object) =>
  DELETE(new Request('http://localhost/api/rsvp', { method: 'DELETE', body: JSON.stringify(body) }));
const base = { token: 'AbCdEfGh1234', guestToken: 'guest-token-aaaaaaaaaaaa' };

describe('DELETE /api/rsvp', () => {
  beforeEach(() => {
    calls.length = 0;
    remove.mockClear();
  });

  it('keeps wall posts by default', async () => {
    const r = await withdraw(base);
    expect(await r.json()).toEqual({ withdrawn: true });
    expect(calls).toEqual(['withdraw_rsvp']);
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes the posts (and their files) first when asked, then withdraws', async () => {
    const r = await withdraw({ ...base, deletePosts: true });
    expect(await r.json()).toEqual({ withdrawn: true });
    expect(calls).toEqual(['wall_delete_mine', 'storage_queue_done', 'withdraw_rsvp']);
    expect(remove).toHaveBeenCalledWith(['e/u/full.jpg']);
  });

  it('does not withdraw when deleting the posts failed', async () => {
    rpc.mockImplementationOnce(async (fn: string) => {
      calls.push(fn);
      return { data: null, error: { message: 'boom' } } as never;
    });
    const r = await withdraw({ ...base, deletePosts: true });
    expect(r.status).toBe(500);
    expect(calls).toEqual(['wall_delete_mine']);
  });
});
