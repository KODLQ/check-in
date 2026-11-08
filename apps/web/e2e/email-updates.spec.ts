import { expect, test } from '@playwright/test';

import { createEvent, postAnnouncement, revoke, sql, subscriptionFor } from './fixtures';

const unique = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

test.describe('RSVP email updates', () => {
  test('consent is unticked and the email empty on first view', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await expect(page.getByLabel('Email (optional)')).toHaveValue('');
    await expect(page.getByLabel('Email me updates about this event')).not.toBeChecked();
    await expect(page.getByText("Only for this event. The host can't see your email.")).toBeVisible();
  });

  test('email without consent is rejected and nothing is saved', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await page.getByLabel('Your name').fill('Ines');
    await page.getByLabel('Email (optional)').fill('ines@example.com');
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByTestId('email-error')).toHaveText('Tick the box to get emails, or clear the email');
    await expect(page.getByTestId('my-answer')).toHaveCount(0);
    const [{ count }] = await sql`select count(*)::int from rsvps r join event_invites i on i.event_id = r.event_id where i.token = ${token}`;
    expect(count).toBe(0);
  });

  test('malformed email shows an error', async ({ page }) => {
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await page.getByLabel('Your name').fill('Ines');
    await page.getByLabel('Email (optional)').fill('ines@');
    await page.getByLabel('Email me updates about this event').check();
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByTestId('email-error')).toHaveText('Enter a valid email address');
    await expect(page.getByTestId('my-answer')).toHaveCount(0);
  });

  test('opt in, see the masked address, turn off, add again later', async ({ page }) => {
    const token = await createEvent();
    const email = unique('optin');
    await page.goto(`/i/${token}`);
    await page.getByLabel('Your name').fill('Saga');
    await page.getByLabel('Email (optional)').fill(email.toUpperCase());
    await page.getByLabel('Email me updates about this event').check();
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Going');
    await expect(page.getByTestId('email-status')).toContainText('Email updates on (o•••@example.com)');
    expect(await subscriptionFor(email)).toBeTruthy();

    // Changing the answer keeps the subscription
    await page.getByRole('button', { name: 'Maybe' }).click();
    await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Maybe');
    await expect(page.getByTestId('email-status')).toBeVisible();

    await page.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByTestId('email-status')).toHaveCount(0);
    await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Maybe');
    expect(await subscriptionFor(email)).toBeUndefined();

    // Add email later on the same device
    await page.getByRole('button', { name: 'Get updates by email' }).click();
    await page.getByLabel('Email (optional)').fill(email);
    await page.getByLabel('Email me updates about this event').check();
    await page.getByRole('button', { name: 'Save email' }).click();
    await expect(page.getByTestId('email-status')).toBeVisible();
    await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Maybe');

    // Withdrawing deletes the address too
    await page.getByRole('button', { name: 'Remove my reply' }).click();
    await expect(page.getByTestId('my-answer')).toHaveCount(0);
    expect(await subscriptionFor(email)).toBeUndefined();
  });

  test('API: consent, validation and opt-in limit mapping', async ({ request }) => {
    const token = await createEvent();
    const base = { token, displayName: 'Api', status: 'going' };
    const post = (data: object, ip = '198.51.100.7') =>
      request.post('/api/rsvp', { data, headers: { 'x-real-ip': ip } });

    const noConsent = await post({ ...base, guestToken: 'api-guest-000000000000001', email: 'a@example.com' });
    expect(noConsent.status()).toBe(400);
    expect(await noConsent.json()).toEqual({ error: 'consent_required' });

    const bad = await post({ ...base, guestToken: 'api-guest-000000000000001', email: 'nope', emailConsent: true });
    expect(bad.status()).toBe(400);
    expect(await bad.json()).toEqual({ error: 'invalid_email' });

    const email = unique('limit');
    for (let i = 0; i < 6; i++) {
      const t = await createEvent();
      const res = await post({ ...base, token: t, guestToken: `api-guest-00000000000010${i}`, email, emailConsent: true });
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('going');
      expect(body.email_updates.state).toBe(i < 5 ? 'on' : 'rate_limited');
    }

    const plain = await post({ ...base, guestToken: 'api-guest-000000000000002' });
    expect((await plain.json()).email_updates).toEqual({ state: 'off', masked: null });
  });

  test('opt-in limit tells the guest their reply is saved', async ({ page, request }) => {
    const email = unique('limitui');
    for (let i = 0; i < 5; i++) {
      await request.post('/api/rsvp', {
        data: { token: await createEvent(), guestToken: `ui-limit-0000000000000${i}`, displayName: 'X', status: 'going', email, emailConsent: true },
        headers: { 'x-real-ip': '198.51.100.8' },
      });
    }
    const token = await createEvent();
    await page.goto(`/i/${token}`);
    await page.getByLabel('Your name').fill('Limit');
    await page.getByLabel('Email (optional)').fill(email);
    await page.getByLabel('Email me updates about this event').check();
    await page.getByRole('button', { name: 'Going' }).click();
    await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Going');
    await expect(page.getByTestId('email-notice')).toContainText("couldn't turn on email updates");
  });
});

test.describe('unsubscribe', () => {
  async function subscribed(request: import('@playwright/test').APIRequestContext) {
    const token = await createEvent({ title: 'Secret Party Name' });
    const email = unique('unsub');
    await request.post('/api/rsvp', {
      data: { token, guestToken: `unsub-${Date.now()}-00000000000`, displayName: 'U', status: 'going', email, emailConsent: true },
    });
    const sub = await subscriptionFor(email);
    expect(sub).toBeTruthy();
    return { email, unsubscribeToken: sub!.unsubscribe_token };
  }

  test('viewing the link does not unsubscribe; confirming does; unknown tokens look the same', async ({ page, request }) => {
    const { email, unsubscribeToken } = await subscribed(request);
    await page.goto(`/u/${unsubscribeToken}`);
    await expect(page.getByRole('heading', { name: 'Stop emails about this event?' })).toBeVisible();
    await expect(page.getByText('Secret Party Name')).toHaveCount(0);
    const knownHtml = (await page.locator('main').innerHTML()).replace(unsubscribeToken, 'TOKEN');
    expect(await subscriptionFor(email)).toBeTruthy();

    await page.goto('/u/AAAAAAAAAAAAAAAAAAAAAA');
    expect((await page.locator('main').innerHTML()).replace('AAAAAAAAAAAAAAAAAAAAAA', 'TOKEN')).toBe(knownHtml);

    await page.goto(`/u/${unsubscribeToken}`);
    await page.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(page.getByRole('heading', { name: "You're unsubscribed" })).toBeVisible();
    expect(await subscriptionFor(email)).toBeUndefined();
    const [{ count }] = await sql`select count(*)::int from rsvps where display_name = 'U' and id in (select id from rsvps)`;
    expect(count).toBeGreaterThan(0);

    // Used link: same confirm page, same result, no details
    await page.goto(`/u/${unsubscribeToken}`);
    await page.getByRole('button', { name: 'Unsubscribe' }).click();
    await expect(page.getByTestId('unsubscribed')).toHaveText("You won't get any more emails about this event.");
  });

  test('RFC 8058 one-click POST unsubscribes without a page; GET does nothing', async ({ request }) => {
    const { email, unsubscribeToken } = await subscribed(request);
    const get = await request.get(`/api/unsubscribe/${unsubscribeToken}`);
    expect(get.status()).toBe(405);
    expect(await subscriptionFor(email)).toBeTruthy();
    const res = await request.post(`/api/unsubscribe/${unsubscribeToken}`, { form: { 'List-Unsubscribe': 'One-Click' } });
    expect(res.status()).toBe(200);
    expect(await subscriptionFor(email)).toBeUndefined();
    const unknown = await request.post('/api/unsubscribe/nope', { form: { 'List-Unsubscribe': 'One-Click' } });
    expect(unknown.status()).toBe(200);
  });
});

test.describe('announcements on the invite page', () => {
  test('two announcements newest first with relative time', async ({ page }) => {
    const token = await createEvent();
    await postAnnouncement(token, 'Doors open 19:30, ring Andersson');
    await postAnnouncement(token, "We're on the roof");
    await page.goto(`/i/${token}`);
    const items = page.getByTestId('announcements').locator('li');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText("We're on the roof");
    await expect(items.nth(1)).toContainText('Doors open 19:30, ring Andersson');
    await expect(items.nth(0).locator('time')).toHaveText('now');
  });

  test('none on cancelled or not-found invites', async ({ page }) => {
    const token = await createEvent();
    await postAnnouncement(token, 'Hidden later');
    await sql`update events set cancelled_at = now() where id = (select event_id from event_invites where token = ${token})`;
    await page.goto(`/i/${token}`);
    await expect(page.getByText('This event has been cancelled.')).toBeVisible();
    await expect(page.getByTestId('announcements')).toHaveCount(0);

    const other = await createEvent();
    await postAnnouncement(other, 'Also hidden');
    await revoke(other);
    await page.goto(`/i/${other}`);
    await expect(page.getByRole('heading', { name: 'Invite not found' })).toBeVisible();
    await expect(page.getByText('Also hidden')).toHaveCount(0);
  });

  test.describe('Swedish', () => {
    test.use({ locale: 'sv-SE' });
    test('heading and relative time in Swedish', async ({ page }) => {
      const token = await createEvent();
      await postAnnouncement(token, 'Ta med jacka');
      await page.goto(`/i/${token}`);
      await expect(page.getByText('Uppdateringar från värden')).toBeVisible();
      await expect(page.getByTestId('announcements').locator('time')).toHaveText('nu');
    });
  });
});
