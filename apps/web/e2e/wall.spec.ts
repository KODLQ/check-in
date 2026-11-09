import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import exifr from 'exifr';
import sharp from 'sharp';

import { cancelEvent, createEvent, E2E_HOST_ID, eventIdFor, localAccessToken, revoke, sql } from './fixtures';

// Event wall on the web invite page (change: add-event-wall, tasks 5.1-5.4).

let seq = 0;
const guestToken = (name: string) => `wall-e2e-${Date.now().toString(36)}-${seq++}-${name}`.padEnd(30, 'x').slice(0, 40);

/** A JPEG straight from a "phone": GPS position, camera and owner in EXIF. */
async function gpsPhoto(): Promise<Buffer> {
  return sharp({ create: { width: 1600, height: 1200, channels: 3, background: { r: 30, g: 140, b: 220 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'Apple', Model: 'iPhone 17', Artist: 'Sara Berg' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '59/1 18/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '18/1 4/1 0/1' },
    })
    .toBuffer();
}

async function rsvpApi(request: APIRequestContext, token: string, guest: string, name: string, status = 'going') {
  const res = await request.post('/api/rsvp', { data: { token, guestToken: guest, displayName: name, status } });
  expect(res.ok()).toBe(true);
}

async function postApi(request: APIRequestContext, token: string, guest: string, body: string) {
  const res = await request.post('/api/wall/posts', { data: { token, guestToken: guest, body } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function hostPost(request: APIRequestContext, token: string, body: string) {
  const res = await request.post('/api/wall/posts', {
    data: { eventId: await eventIdFor(token), body },
    headers: { authorization: `Bearer ${await localAccessToken(E2E_HOST_ID)}` },
  });
  expect(res.status()).toBe(201);
}

async function answerGoing(page: Page, name: string) {
  await page.getByLabel('Your name').fill(name);
  await page.getByTestId('answer-going').click();
  await expect(page.getByTestId('wall-composer')).toBeVisible();
}

async function writePost(page: Page, text: string) {
  await page.getByTestId('wall-input').fill(text);
  await page.getByTestId('wall-submit').click();
  await expect(page.getByTestId('wall-body').filter({ hasText: text })).toBeVisible();
}

test.describe('reading the wall', () => {
  test('a visitor without an RSVP sees posts and the host label, but no post form', async ({ page, request }) => {
    const token = await createEvent();
    const g = guestToken('gina');
    await rsvpApi(request, token, g, 'Gina');
    await postApi(request, token, g, 'Who brings ice?');
    await hostPost(request, token, 'Doors open at 8');

    await page.goto(`/i/${token}`);
    const posts = page.getByTestId('wall-post');
    await expect(posts).toHaveCount(2);
    await expect(posts.first()).toContainText('Doors open at 8');
    await expect(posts.first().getByTestId('host-label')).toBeVisible();
    await expect(posts.nth(1)).toContainText('Gina');
    await expect(page.getByTestId('wall-composer')).toHaveCount(0);
    await expect(page.getByTestId('wall-reason')).toHaveText(/Only people who are going or might go can post/);
    await expect(page.getByTestId('wall-delete')).toHaveCount(0);
  });

  test("a Can't go guest gets no form", async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await page.getByLabel('Your name').fill('Xena');
    await page.getByTestId('answer-declined').click();
    await expect(page.getByTestId('my-answer')).toBeVisible();
    await expect(page.getByTestId('wall-reason')).toBeVisible();
    await expect(page.getByTestId('wall-composer')).toHaveCount(0);
    const res = await page.request.post('/api/wall/posts', {
      data: { token, guestToken: await page.evaluate(() => localStorage.getItem('ci_guest')), body: 'sneaky' },
    });
    expect(res.status()).toBe(403);
    expect(await res.json()).toEqual({ error: 'not_attending' });
  });

  test('a revoked link shows "invite not found" with no wall content', async ({ page, request }) => {
    const token = await createEvent();
    const g = guestToken('gina');
    await rsvpApi(request, token, g, 'Gina');
    await postApi(request, token, g, 'Secret after-party at my place');
    await revoke(token);

    await page.goto(`/i/${token}`);
    await expect(page.getByRole('heading', { name: 'Invite not found' })).toBeVisible();
    await expect(page.getByTestId('wall')).toHaveCount(0);
    expect(await page.content()).not.toContain('Secret after-party');
    const api = await request.get(`/api/wall?token=${token}`);
    expect(api.status()).toBe(404);
    expect(await api.text()).not.toContain('Secret');
  });

  test('a cancelled event shows the notice with the read-only wall', async ({ page, request }) => {
    const token = await createEvent({ title: 'Called off' });
    const g = guestToken('gina');
    await rsvpApi(request, token, g, 'Gina');
    await postApi(request, token, g, 'So sad!');
    await cancelEvent(token);

    await page.goto(`/i/${token}`);
    await expect(page.getByTestId('cancelled')).toHaveText('This event has been cancelled.');
    await expect(page.getByTestId('wall-body')).toHaveText('So sad!');
    await expect(page.getByTestId('wall-composer')).toHaveCount(0);
    await expect(page.getByTestId('wall-reason')).toHaveText(/cancelled/);
  });

  test('guests see no wall while the host has turned it off', async ({ page, request }) => {
    const token = await createEvent();
    const g = guestToken('gina');
    await rsvpApi(request, token, g, 'Gina');
    await postApi(request, token, g, 'Hidden soon');
    const res = await request.patch('/api/wall/settings', {
      data: { eventId: await eventIdFor(token), enabled: false },
      headers: { authorization: `Bearer ${await localAccessToken(E2E_HOST_ID)}` },
    });
    expect(await res.json()).toEqual({ enabled: false });
    await page.goto(`/i/${token}`);
    await expect(page.getByTestId('going-count')).toBeVisible();
    await expect(page.getByTestId('wall')).toHaveCount(0);
    expect(await page.content()).not.toContain('Hidden soon');
  });
});

test.describe('posting', () => {
  test('a Going guest posts text and a GPS-tagged photo; the served photo has no EXIF', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await answerGoing(page, 'Sara');

    const photo = await gpsPhoto();
    expect((await exifr.gps(photo))?.latitude).toBeCloseTo(59.3, 1); // the input really carries GPS
    await page.getByTestId('wall-file').setInputFiles({ name: 'IMG_0420.jpg', mimeType: 'image/jpeg', buffer: photo });
    await page.getByTestId('wall-input').fill('Pics from tonight <b>bold?</b> https://example.com');
    await page.getByTestId('wall-submit').click();

    const first = page.getByTestId('wall-post').first();
    await expect(first.getByTestId('wall-body')).toHaveText('Pics from tonight <b>bold?</b> https://example.com');
    await expect(first.locator('b')).toHaveCount(0); // markup is shown literally
    await expect(first.locator('a')).toHaveCount(0); // links are not clickable
    await expect(first).toContainText('Sara');
    const img = first.getByTestId('wall-photo');
    await expect(img).toHaveAttribute('referrerpolicy', 'no-referrer');
    const thumbUrl = (await img.getAttribute('src'))!;
    expect(thumbUrl).toContain('/storage/v1/object/sign/wall/');
    expect(thumbUrl).not.toContain('/object/public/');

    // Full-size rendition through the lightbox.
    await img.click();
    const fullUrl = (await page.getByTestId('wall-full').getAttribute('src'))!;
    for (const url of [thumbUrl, fullUrl]) {
      const res = await page.request.get(url);
      expect(res.ok()).toBe(true);
      const bytes = await res.body();
      expect(await exifr.gps(bytes)).toBeUndefined();
      expect(await exifr.parse(bytes)).toBeUndefined();
      const meta = await sharp(bytes).metadata();
      expect(meta.format).toBe('jpeg');
      expect(meta.exif).toBeUndefined();
      expect(bytes.includes(Buffer.from('iPhone'))).toBe(false);
      expect(bytes.includes(Buffer.from('Sara Berg'))).toBe(false);
    }
    // The signed link expires within an hour.
    const exp = JSON.parse(Buffer.from(new URL(fullUrl).searchParams.get('token')!.split('.')[1]!, 'base64url').toString());
    expect(exp.exp - exp.iat).toBeLessThanOrEqual(3600);
    // The original upload is gone from the quarantine bucket.
    const [{ n }] = await sql`select count(*)::int as n from storage.objects where bucket_id = 'wall-incoming'
                              and name like ${(await eventIdFor(token)) + '/%'}`;
    expect(n).toBe(0);
  });

  test('client prechecks: a 12 MB file is rejected before upload', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await answerGoing(page, 'Big');
    await page.getByTestId('wall-file').setInputFiles({ name: 'huge.jpg', mimeType: 'image/jpeg', buffer: Buffer.alloc(12 * 1024 * 1024) });
    await expect(page.getByTestId('wall-error')).toHaveText('Photos can be at most 10 MB.');
  });

  test('a file named photo.jpg that is not an image never appears', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await answerGoing(page, 'Trick');
    await page.getByTestId('wall-file').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('not an image at all '.repeat(50)) });
    await page.getByTestId('wall-input').fill('look');
    await page.getByTestId('wall-submit').click();
    await expect(page.getByTestId('wall-error')).toHaveText("That file isn't a photo we can use.");
    await expect(page.getByTestId('wall-post')).toHaveCount(0);
  });

  test('an upload without a valid permission is rejected by Storage', async ({ request }) => {
    const res = await request.put(`http://127.0.0.1:54321/storage/v1/object/upload/sign/wall-incoming/x/y?token=forged`, {
      headers: { 'content-type': 'image/jpeg' },
      data: await gpsPhoto(),
    });
    expect(res.ok()).toBe(false);
  });
});

test.describe('deleting', () => {
  test('a guest deletes one post, then all their posts', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await answerGoing(page, 'Dora');
    await writePost(page, 'first');
    await writePost(page, 'second');
    await writePost(page, 'third');

    page.on('dialog', (d) => void d.accept());
    await page.getByTestId('wall-post').filter({ hasText: 'third' }).getByTestId('wall-delete').click();
    await expect(page.getByTestId('wall-post')).toHaveCount(2);

    await page.getByTestId('wall-mine').locator('summary').click();
    await page.getByTestId('wall-delete-all').click();
    await expect(page.getByTestId('wall-post')).toHaveCount(0);
  });

  test("a guest cannot delete someone else's post", async ({ page, request }) => {
    const token = await createEvent();
    const g = guestToken('gina');
    await rsvpApi(request, token, g, 'Gina');
    const id = await postApi(request, token, g, 'Mine, not yours');
    const res = await request.delete(`/api/wall/posts/${id}`, { data: { token, guestToken: guestToken('mallory') } });
    expect(res.status()).toBe(403);
    await page.goto(`/i/${token}`);
    await expect(page.getByTestId('wall-body')).toHaveText('Mine, not yours');
  });

  test('withdrawing keeps the posts by default; they stay deletable but the form is gone', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await answerGoing(page, 'Wilma');
    await writePost(page, 'staying');
    await expect(page.getByTestId('withdraw-delete-posts')).not.toBeChecked();
    await page.getByTestId('withdraw').click();

    await expect(page.getByTestId('my-answer')).toHaveCount(0);
    await expect(page.getByTestId('wall-composer')).toHaveCount(0);
    await expect(page.getByTestId('wall-post').filter({ hasText: 'staying' })).toContainText('Wilma');
    page.on('dialog', (d) => void d.accept());
    await page.getByTestId('wall-delete').click();
    await expect(page.getByTestId('wall-post')).toHaveCount(0);
  });

  test('withdrawing with "also delete my posts" removes them and their photos', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await answerGoing(page, 'Vera');
    await page.getByTestId('wall-file').setInputFiles({ name: 'a.jpg', mimeType: 'image/jpeg', buffer: await gpsPhoto() });
    await writePost(page, 'with photo');
    const eventId = await eventIdFor(token);
    const [{ before }] = await sql`select count(*)::int as before from storage.objects where bucket_id = 'wall' and name like ${eventId + '/%'}`;
    expect(before).toBe(2);

    await page.getByTestId('withdraw-delete-posts').check();
    await page.getByTestId('withdraw').click();
    await expect(page.getByTestId('my-answer')).toHaveCount(0);
    await expect(page.getByTestId('wall-post')).toHaveCount(0);
    const [{ after }] = await sql`select count(*)::int as after from storage.objects where bucket_id = 'wall' and name like ${eventId + '/%'}`;
    expect(after).toBe(0);
  });
});

test.describe('link previews', () => {
  test('metadata and the OG image contain no wall content', async ({ page, request }) => {
    const token = await createEvent({ title: 'Preview party' });
    const head = async () => {
      const html = await (await request.get(`/i/${token}`, { headers: { 'user-agent': 'facebookexternalhit/1.1' } })).text();
      return [...html.matchAll(/<meta[^>]+(?:property|name)="(og:[^"]+|twitter:[^"]+|description)"[^>]*>/g)]
        .map((m) => m[0])
        .sort();
    };
    const ogImage = async () => (await request.get(`/i/${token}/opengraph-image`)).body();
    const metaBefore = await head();
    const imageBefore = await ogImage();

    const g = guestToken('pia');
    await rsvpApi(request, token, g, 'Pia Poster');
    await postApi(request, token, g, 'WALLTEXT-should-never-preview');
    await page.goto(`/i/${token}`);
    await page.getByLabel('Your name').fill('Uploader');
    await page.getByTestId('answer-going').click();
    await page.getByTestId('wall-file').setInputFiles({ name: 'p.jpg', mimeType: 'image/jpeg', buffer: await gpsPhoto() });
    await writePost(page, 'photo post');

    const metaAfter = await head();
    expect(metaAfter).toEqual(metaBefore);
    // Snapshot of the preview metadata, with the per-run token, time and image hash normalised.
    const normalised = metaAfter
      .map((m) => m.replaceAll(token, '<token>').replace(/opengraph-image[^"]*/g, 'opengraph-image').replace(/\w{3} \d{1,2} \w{3}, \d{2}:\d{2}/g, '<when>'))
      .join('\n');
    expect(normalised).toMatchSnapshot('invite-preview-meta.txt');
    for (const m of metaAfter) {
      expect(m).not.toContain('WALLTEXT');
      expect(m).not.toContain('Pia Poster');
      expect(m).not.toContain('Uploader');
      expect(m).not.toContain('/storage/v1/object/sign/wall');
    }
    expect((await ogImage()).equals(imageBefore)).toBe(true);
  });
});
