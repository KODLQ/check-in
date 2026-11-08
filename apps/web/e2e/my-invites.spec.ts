import { expect, test, type Request } from '@playwright/test';

import { createEvent, sql } from './fixtures';

const TICKET_RE = /^[A-Za-z0-9_-]{22}$/;
const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250)).join('.')}`;
const guestToken = () =>
  `e2e-guest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

test.beforeEach(async () => {
  // Isolate from earlier runs: the default (no proxy header) IP bucket is shared.
  await sql`delete from public.rsvp_rate_limits where bucket like '%:claim'`;
});

test.describe('POST /api/claim-ticket', () => {
  test('returns a ticket and stores only hashes', async ({ request }) => {
    const gt = guestToken();
    const res = await request.post('/api/claim-ticket', {
      data: { guestToken: gt },
      headers: { 'x-real-ip': randomIp() },
    });
    expect(res.status()).toBe(200);
    const { ticket } = (await res.json()) as { ticket: string };
    expect(ticket).toMatch(TICKET_RE);
    const rows = await sql`select ticket_hash, guest_token_hash from public.rsvp_claim_tickets
                           where ticket_hash = encode(extensions.digest(${ticket}, 'sha256'), 'hex')`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.guest_token_hash).not.toBe(gt);
  });

  test('the 11th ticket from one IP within 10 minutes is rejected', async ({ request }) => {
    const ip = randomIp();
    for (let i = 0; i < 10; i++) {
      const res = await request.post('/api/claim-ticket', {
        data: { guestToken: guestToken() },
        headers: { 'x-real-ip': ip },
      });
      expect(res.status()).toBe(200);
    }
    const res = await request.post('/api/claim-ticket', {
      data: { guestToken: guestToken() },
      headers: { 'x-real-ip': ip },
    });
    expect(res.status()).toBe(429);
  });

  test('rejects GET and malformed bodies', async ({ request }) => {
    expect((await request.get('/api/claim-ticket')).status()).toBe(405);
    expect(
      (await request.post('/api/claim-ticket', { data: { guestToken: 'short' } })).status(),
    ).toBe(400);
    expect(
      (
        await request.post('/api/claim-ticket', { data: { guestToken: guestToken(), extra: 1 } })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post('/api/claim-ticket', {
          data: 'not json',
          headers: { 'content-type': 'text/plain' },
        })
      ).status(),
    ).toBe(400);
  });
});

test.describe('Plan your own prompt', () => {
  test('appears only after responding, and RSVP controls keep working', async ({ page }) => {
    const token = await createEvent({ title: 'CTA test' });
    await page.goto(`/i/${token}`);
    await expect(page.getByRole('button', { name: 'Going' })).toBeVisible();
    await expect(page.getByTestId('plan-your-own')).toHaveCount(0);

    await page.getByLabel('Your name').fill('Saga');
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Going');
    await expect(page.getByTestId('plan-your-own')).toContainText('Plan your own in 30 seconds →');
    await expect(page.getByText('Plan your own with check-in')).toHaveCount(0);

    await page.getByRole('button', { name: 'Maybe' }).click();
    await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Maybe');
    await expect(page.getByTestId('plan-your-own')).toBeVisible();

    await page.getByRole('button', { name: 'Remove my reply' }).click();
    await expect(page.getByTestId('my-answer')).toHaveCount(0);
    await expect(page.getByTestId('plan-your-own')).toHaveCount(0);
  });
});

test.describe('Plan your own prompt (Swedish)', () => {
  test.use({ locale: 'sv-SE' });
  test('is shown in Swedish', async ({ page }) => {
    const token = await createEvent({ title: 'CTA sv' });
    await page.goto(`/i/${token}`);
    await expect(page.getByTestId('plan-your-own')).toHaveCount(0);
    await page.getByLabel('Ditt namn').fill('Saga');
    await page.getByRole('button', { name: 'Kommer' }).click();
    await expect(page.getByTestId('plan-your-own')).toContainText(
      'Planera ditt eget på 30 sekunder →',
    );
  });
});

test.describe('hand-off page', () => {
  test('carries the ticket only in the fragment and the app link, never to a server', async ({
    page,
    context,
  }) => {
    const requests: Request[] = [];
    page.on('request', (r) => requests.push(r));
    // Store links are external: intercept so following them stays offline but is still recorded.
    await context.route(/apps\.apple\.com|play\.google\.com/, (route) =>
      route.fulfill({ status: 200, body: 'store' }),
    );

    const token = await createEvent({ title: 'Hand-off' });
    await page.goto(`/i/${token}`);
    await page.getByLabel('Your name').fill('Sara B');
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Going');

    const handOff = page.waitForResponse((r) => new URL(r.url()).pathname === '/get-app');
    await page.getByTestId('plan-your-own').click();
    const response = await handOff;
    expect(response.headers()['referrer-policy']).toBe('no-referrer');
    await expect(page).toHaveURL(/\/get-app#t=/);

    const ticket = new URL(page.url()).hash.replace('#t=', '');
    expect(ticket).toMatch(TICKET_RE);
    await expect(page.getByTestId('open-app')).toHaveAttribute(
      'href',
      `checkin://claim?t=${ticket}`,
    );
    await expect(
      page.getByText('Installed the app? Come back here and tap Open the app.'),
    ).toBeVisible();
    await expect(page.getByTestId('in-app-browser')).toHaveCount(0);

    await page.getByTestId('app-store').click();
    await expect(page).toHaveURL(/apps\.apple\.com/);

    const guest = (await context.cookies()).find((c) => c.name === 'ci_guest')!.value;
    expect(guest.length).toBeGreaterThanOrEqual(22);
    expect(requests.length).toBeGreaterThan(3);
    for (const r of requests) {
      const referer = (await r.allHeaders())['referer'] ?? '';
      for (const secret of [ticket, guest]) {
        expect(r.url(), r.url()).not.toContain(secret);
        expect(referer, `${r.url()} referer`).not.toContain(secret);
      }
    }
    const storeRequest = requests.find((r) => r.url().includes('apps.apple.com'))!;
    expect((await storeRequest.allHeaders())['referer']).toBeUndefined();

    // The ticket claims this browser's response into an account; the same browser can still change it.
    const [user] = await sql`
      insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
      values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
              ${`e2e-claim-${Date.now()}@checkin.test`}, '{"full_name":"Sara Berg"}', '', '', '', '')
      returning id`;
    const claimed = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user!.id, role: 'authenticated' })}, true)`;
      await tx`set local role authenticated`;
      const [row] = await tx`select public.claim_guest_rsvps(${ticket}) as r`;
      return row!.r;
    });
    expect(claimed).toEqual({ claimed: 1, merged: 0 });

    await page.goto(`/i/${token}`);
    await page.getByRole('button', { name: "Can't go" }).click();
    await expect(page.getByTestId('my-answer')).toHaveText("Your answer: Can't go");
    const rows = await sql`select r.user_id, r.display_name, r.status from public.rsvps r
                           join public.event_invites i on i.event_id = r.event_id where i.token = ${token}`;
    expect(rows).toEqual([{ user_id: user!.id, display_name: 'Sara B', status: 'declined' }]);
    await sql`delete from auth.users where id = ${user!.id}`;
  });

  test('desktop shows only the store links', async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      isMobile: false,
      hasTouch: false,
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
    });
    const page = await context.newPage();
    await page.goto('/get-app#t=AAAAAAAAAAAAAAAAAAAAAA');
    await expect(page.getByText('Get check-in on your phone.')).toBeVisible();
    await expect(page.getByTestId('app-store')).toBeVisible();
    await expect(page.getByTestId('open-app')).toHaveCount(0);
    await context.close();
  });

  test('in-app browsers get open-in-browser guidance', async ({ browser }) => {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0',
    });
    const page = await context.newPage();
    await page.goto('/get-app#t=AAAAAAAAAAAAAAAAAAAAAA');
    await expect(page.getByTestId('in-app-browser')).toBeVisible();
    await expect(page.getByTestId('open-app')).toHaveAttribute(
      'href',
      'checkin://claim?t=AAAAAAAAAAAAAAAAAAAAAA',
    );
    await context.close();
  });
});
