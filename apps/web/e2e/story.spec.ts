import { expect, test, type APIResponse } from '@playwright/test';

import { storyImageModel, STORY_TITLE_MAX, type ShownInvite } from '../src/lib/invite-image-model';
import { createEvent, revoke, sql } from './fixtures';

/** Width/height from a PNG's IHDR chunk. */
function pngSize(buf: Buffer) {
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

async function body(res: APIResponse) {
  return Buffer.from(await res.body());
}

const fullInvite: ShownInvite = {
  state: 'active',
  event: {
    title: 'Secret garden party',
    description: 'Door code 4711, bring the cake',
    starts_at: '2026-12-12T18:00:00Z',
    ends_at: null,
    time_zone: 'Europe/Stockholm',
    location_text: 'Hemliga gatan 7',
    place_name: 'Kafé Undangömt',
    latitude: 59.3123,
    longitude: 18.0765,
    cover_path: 'host/cover.jpg',
    theme: 'night',
    time_changed_at: null,
    guest_list_visible: true,
    allow_plus_ones: true,
    max_plus_ones: 2,
    capacity: 80,
  },
  host: { display_name: 'Alva', avatar_path: 'host/avatar.jpg' },
  counts: { going: 73, maybe: 58, waitlist: 4, spots_left: 7, full: false },
  guests: [
    { display_name: 'Zlatan Gästsson', status: 'going', plus_ones: 2 },
    { display_name: 'Maja Maybe', status: 'maybe', plus_ones: 0 },
  ],
  my_rsvp: { status: 'going', display_name: 'Me Myself', plus_ones: 1, waitlist_position: null, promoted: false },
  announcements: [{ id: 'a1', body: 'Moved to the backyard', created_at: '2026-12-01T10:00:00Z' }],
};
const urls = { siteUrl: 'https://checkin.example', coverUrl: (p: string | null) => (p ? `https://cdn.example/${p}` : null) };

test.describe('storyImageModel', () => {
  test('passes only title, time, host, cover/theme, CTA and URL', () => {
    const model = storyImageModel(fullInvite, 'en', 'AbC123def456', urls);
    expect(Object.keys(model).sort()).toEqual(['background', 'coverUrl', 'cta', 'hostLine', 'title', 'url', 'when']);
    expect(model).toMatchObject({
      title: 'Secret garden party',
      hostLine: 'Hosted by Alva',
      cta: 'RSVP at',
      url: 'checkin.example/i/AbC123def456',
      coverUrl: 'https://cdn.example/host/cover.jpg',
    });
    const json = JSON.stringify(model);
    for (const secret of ['Hemliga', 'Undangömt', '59.31', '18.07', 'Door code', 'Zlatan', 'Maja', 'Me Myself', '73', '58', 'backyard', 'avatar']) {
      expect(json).not.toContain(secret);
    }
  });

  test('Swedish CTA and date', () => {
    const model = storyImageModel(fullInvite, 'sv', 'AbC123def456', urls);
    expect(model.cta).toBe('Svara på');
    expect(model.hostLine).toBe('Värd: Alva');
    expect(model.when).toMatch(/lör 12 dec\.? 19:00/);
  });

  test('long titles are shortened with an ellipsis', () => {
    const long = 'Väldigt lång titel på en fest som aldrig tar slut och fortsätter hela natten till morgonen';
    const model = storyImageModel({ ...fullInvite, event: { ...fullInvite.event, title: long } }, 'en', 'AbC123def456', urls);
    expect(model.title.endsWith('…')).toBe(true);
    expect(Array.from(model.title).length).toBeLessThanOrEqual(STORY_TITLE_MAX);
    expect(long.startsWith(model.title.slice(0, -1))).toBe(true);
  });

  test('no cover falls back to the theme', () => {
    const model = storyImageModel({ ...fullInvite, event: { ...fullInvite.event, cover_path: null } }, 'en', 'x', urls);
    expect(model.coverUrl).toBeNull();
    expect(model.background).toContain('#141E30');
  });
});

test.describe('story image route', () => {
  test('active invite returns a 1080×1920 PNG with a one-minute cache header', async ({ request }) => {
    const token = await createEvent({ title: 'Story time' });
    const res = await request.get(`/i/${token}/story`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
    expect(res.headers()['cache-control']).toBe('public, max-age=60, s-maxage=60, stale-while-revalidate=0');
    expect(pngSize(await body(res))).toEqual({ width: 1080, height: 1920 });
  });

  test('language follows ?lang= and Accept-Language', async ({ request }) => {
    const token = await createEvent({ title: 'Språk' });
    const en = await body(await request.get(`/i/${token}/story`, { headers: { 'accept-language': 'en' } }));
    const sv = await body(await request.get(`/i/${token}/story`, { headers: { 'accept-language': 'sv-SE' } }));
    const svParam = await body(await request.get(`/i/${token}/story?lang=sv`, { headers: { 'accept-language': 'en' } }));
    expect(sv.equals(en)).toBe(false);
    expect(svParam.equals(sv)).toBe(true);
  });

  test('unknown, revoked, cancelled and ended invites get the identical empty 404', async ({ request }) => {
    const revoked = await createEvent();
    await revoke(revoked);
    const cancelled = await createEvent({ cancelled: true });
    const ended = await createEvent({ startsInHours: -20 });

    const responses = await Promise.all(
      ['NoSuchToken0', revoked, cancelled, ended].map((t) => request.get(`/i/${t}/story`)),
    );
    const shapes = await Promise.all(
      responses.map(async (r) => ({
        status: r.status(),
        cacheControl: r.headers()['cache-control'],
        contentType: r.headers()['content-type'] ?? null,
        body: (await body(r)).toString('hex'),
      })),
    );
    expect(shapes[0]).toEqual({ status: 404, cacheControl: 'no-store', contentType: null, body: '' });
    for (const s of shapes) expect(s).toEqual(shapes[0]);
  });

  test('editing the title changes the image; revoking stops it', async ({ request }) => {
    const token = await createEvent({ title: 'Before edit' });
    const before = await body(await request.get(`/i/${token}/story`));
    await sql`update public.events e set title = 'After edit' from public.event_invites i where i.event_id = e.id and i.token = ${token}`;
    const res = await request.get(`/i/${token}/story`);
    expect(res.headers()['cache-control']).toContain('max-age=60');
    expect((await body(res)).equals(before)).toBe(false);

    await revoke(token);
    expect((await request.get(`/i/${token}/story`)).status()).toBe(404);
  });

  test('link preview image is still 1200×630 and gets the same cache header', async ({ request }) => {
    const token = await createEvent({ title: 'OG check' });
    const res = await request.get(`/i/${token}/opengraph-image`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('image/png');
    expect(res.headers()['cache-control']).toBe('public, max-age=60, s-maxage=60, stale-while-revalidate=0');
    expect(pngSize(await body(res))).toEqual({ width: 1200, height: 630 });
  });
});

test.describe('guest Share on the invite page', () => {
  test('shares the story PNG and the invite URL when the browser can share files', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: unknown[] };
      w.__shared = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d: ShareData) => !!d.files?.length });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: ShareData) => {
          const f = d.files?.[0];
          w.__shared.push({ name: f?.name, type: f?.type, size: f?.size, url: d.url, text: d.text });
        },
      });
    });
    const token = await createEvent({ title: 'Share me' });
    await page.goto(`/i/${token}`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared.length)).toBe(1);
    const [shared] = await page.evaluate(() => (window as unknown as { __shared: Record<string, unknown>[] }).__shared);
    expect(shared).toMatchObject({ name: 'invite.png', type: 'image/png', url: `http://localhost:3100/i/${token}` });
    expect(shared!.size as number).toBeGreaterThan(1000);
    await expect(page.getByTestId('share-fallback')).toHaveCount(0);
  });

  test('retries with the link in the text when files + url is rejected', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __shared: unknown[] };
      w.__shared = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d: ShareData) => {
          if (d.url) throw new TypeError('files and url not supported together');
          w.__shared.push({ files: d.files?.length, text: d.text });
        },
      });
    });
    const token = await createEvent({ title: 'Retry me' });
    await page.goto(`/i/${token}`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __shared: unknown[] }).__shared)).toEqual([
      { files: 1, text: `You're invited: Retry me http://localhost:3100/i/${token}` },
    ]);
  });

  test('without file sharing offers Save image and Copy link', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    const token = await createEvent({ title: 'No share API' });
    await page.goto(`/i/${token}`);
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const fallback = page.getByTestId('share-fallback');
    await expect(fallback.getByRole('link', { name: 'Save image' })).toHaveAttribute('href', `/i/${token}/story`);
    await fallback.getByRole('button', { name: 'Copy link' }).click();
    await expect(fallback.getByRole('status')).toHaveText('Link copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://localhost:3100/i/${token}`);
  });

  test('no Share action on cancelled or ended invites', async ({ page }) => {
    for (const token of [await createEvent({ cancelled: true }), await createEvent({ startsInHours: -20 })]) {
      await page.goto(`/i/${token}`);
      await expect(page.locator('main')).toBeVisible();
      await expect(page.getByTestId('share-invite')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
    }
  });
});
