import { expect, test } from '@playwright/test';

import { createEvent, revoke, sql } from './fixtures';

test.describe('invite page states', () => {
  test('active invite shows event details without sign-in', async ({ page }) => {
    const token = await createEvent({ title: 'Kräftskiva' });
    await page.goto(`/i/${token}`);
    await expect(page.getByRole('heading', { name: 'Kräftskiva' })).toBeVisible();
    await expect(page.getByText('Hosted by E2E Host')).toBeVisible();
    await expect(page.getByText('Secret Street 42')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Going' })).toBeVisible();
  });

  test('unknown and revoked links show the same generic page', async ({ page }) => {
    const token = await createEvent();
    await revoke(token);
    await page.goto(`/i/${token}`);
    const revokedHtml = await page.locator('main').innerHTML();
    await page.goto('/i/NoSuchToken0');
    expect(await page.locator('main').innerHTML()).toBe(revokedHtml);
    await expect(page.getByRole('heading', { name: 'Invite not found' })).toBeVisible();
  });

  test('cancelled event shows title and cancellation, no RSVP', async ({ page }) => {
    const token = await createEvent({ title: 'Called off', cancelled: true });
    await page.goto(`/i/${token}`);
    await expect(page.getByRole('heading', { name: 'Called off' })).toBeVisible();
    await expect(page.getByText('This event has been cancelled.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Going' })).toHaveCount(0);
  });

  test('past event shows details but no RSVP options', async ({ page }) => {
    const token = await createEvent({ startsInHours: -20 });
    await page.goto(`/i/${token}`);
    await expect(page.getByTestId('past')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Going' })).toHaveCount(0);
  });
});

test('link preview metadata has title/date/image but no address or guests', async ({ request }) => {
  const token = await createEvent({ title: 'Preview Party', location: 'Hemlig gatan 7' });
  const html = await (await request.get(`/i/${token}`, { headers: { 'user-agent': 'WhatsApp/2.23' } })).text();
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head).toContain('<meta property="og:title" content="Preview Party"');
  expect(head).toMatch(/<meta property="og:image" content="[^"]+opengraph-image/);
  expect(head).toContain('Hosted by E2E Host');
  expect(head).toContain('noindex');
  expect(head).not.toContain('Hemlig gatan');

  const img = await request.get(`/i/${token}/opengraph-image`);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/png');
});

test('guest RSVP flow: respond, persist on reload, change, withdraw', async ({ page }) => {
  const token = await createEvent({ title: 'Flow test' });
  await page.goto(`/i/${token}`);

  await page.getByRole('button', { name: 'Going' }).click();
  await expect(page.locator('p.error')).toHaveText('Enter your name');

  await page.getByLabel('Your name').fill('Saga');
  await page.getByRole('button', { name: 'Going' }).click();
  await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Going');
  await expect(page.getByTestId('going-count')).toHaveText('1 person going');
  await expect(page.getByTestId('guest-list')).toContainText('Saga');

  await page.reload();
  await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Going');

  await page.getByRole('button', { name: 'Maybe' }).click();
  await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Maybe');
  const [{ count }] = await sql`select count(*)::int from rsvps r join event_invites i on i.event_id = r.event_id where i.token = ${token}`;
  expect(count).toBe(1);

  await page.getByRole('button', { name: 'Remove my reply' }).click();
  await expect(page.getByTestId('my-answer')).toHaveCount(0);
  await expect(page.getByTestId('going-count')).toHaveText('0 people going');
});

test('declined guests are not shown to other guests; hidden lists show only counts', async ({ page, browser }) => {
  const token = await createEvent();
  await page.goto(`/i/${token}`);
  await page.getByLabel('Your name').fill('Nej Tack');
  await page.getByRole('button', { name: "Can't go" }).click();
  await expect(page.getByTestId('my-answer')).toBeVisible();

  const other = await browser.newPage();
  await other.goto(`/i/${token}`);
  await expect(other.getByText('Nej Tack')).toHaveCount(0);
  await other.close();

  const hidden = await createEvent({ guestListVisible: false });
  await page.goto(`/i/${hidden}`);
  await page.getByLabel('Your name').fill('Secret Sam');
  await page.getByRole('button', { name: 'Going' }).click();
  await expect(page.getByTestId('going-count')).toHaveText('1 person going');
  await expect(page.getByTestId('guest-list')).toHaveCount(0);
});

test('rate limiting rejects the 11th rapid write', async ({ request }) => {
  const token = await createEvent();
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const res = await request.post('/api/rsvp', {
      headers: { 'x-real-ip': '203.0.113.9' },
      data: { token, guestToken: `ratelimit-guest-${String(i).padStart(8, '0')}`, displayName: `G${i}`, status: 'going' },
    });
    statuses.push(res.status());
  }
  expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
  expect(statuses[10]).toBe(429);
});

test('calendar file has UTC times and event details', async ({ request }) => {
  const token = await createEvent({ title: 'Cal test' });
  const res = await request.get(`/i/${token}/calendar.ics`);
  expect(res.headers()['content-type']).toContain('text/calendar');
  const ics = await res.text();
  expect(ics).toMatch(/DTSTART:\d{8}T\d{6}Z/);
  expect(ics).toContain('SUMMARY:Cal test');
  expect(ics).toContain('LOCATION:Secret Street 42');
});

test.describe('Swedish', () => {
  test.use({ locale: 'sv-SE' });
  test('UI follows Accept-Language', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await expect(page.getByRole('button', { name: 'Kommer' })).toBeVisible();
    await expect(page.getByText('Värd: E2E Host')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  });
});

test('deep-link association files are served', async ({ request }) => {
  const aasa = await (await request.get('/.well-known/apple-app-site-association')).json();
  expect(JSON.stringify(aasa)).toContain('/i/*');
  expect((await request.get('/.well-known/assetlinks.json')).status()).toBe(200);
});
