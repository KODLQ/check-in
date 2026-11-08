import { expect, test } from '@playwright/test';

import { createEvent, eventIdFor, sql } from './fixtures';

// Co-host test user with a known display name (local stack only).
const CO_HOST_ID = 'e2e00000-0000-0000-0000-0000000000c2';

async function ensureCoHostUser() {
  await sql`
    insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change)
    values ('00000000-0000-0000-0000-000000000000', ${CO_HOST_ID}, 'authenticated', 'authenticated', 'e2e-cohost@checkin.test',
            '{"full_name":"Erik"}', '', '', '', '')
    on conflict (id) do nothing`;
  await sql`update public.profiles set display_name = 'Erik' where id = ${CO_HOST_ID}`;
}

async function addCoHost(token: string) {
  await ensureCoHostUser();
  const eventId = await eventIdFor(token);
  await sql`insert into public.event_co_hosts (event_id, user_id) values (${eventId}, ${CO_HOST_ID}) on conflict do nothing`;
}

let counter = 0;
/** A co-host link with a known 22-char token. */
async function createCoHostLink(eventToken: string, opts: { revoked?: boolean } = {}): Promise<string> {
  const token = `CoHostE2e${Date.now().toString(36)}${counter++}`.padEnd(22, 'x').slice(0, 22);
  const eventId = await eventIdFor(eventToken);
  await sql`insert into public.co_host_invites (token, event_id, revoked_at) values (${token}, ${eventId}, ${opts.revoked ? new Date() : null})`;
  return token;
}

test.describe('co-host link in a browser', () => {
  test('offers the app and shows only the title and owner name', async ({ page, request }) => {
    const eventToken = await createEvent({ title: 'Kräftskiva', location: 'Secret Street 42' });
    await sql`insert into public.rsvps (event_id, guest_token_hash, display_name, status)
              values (${await eventIdFor(eventToken)}, public.hash_guest_token(${`e2e-cohost-guest-${Date.now()}-xxxxxxxx`}), 'Guesty McGuest', 'going')`;
    const token = await createCoHostLink(eventToken);

    await page.goto(`/c/${token}`);
    await expect(page.getByRole('heading', { name: 'E2E Host invited you to co-host Kräftskiva' })).toBeVisible();
    await expect(page.getByTestId('open-app')).toHaveAttribute('href', `checkin://c/${token}`);
    await expect(page.getByTestId('app-store')).toBeVisible();
    await expect(page.getByTestId('play-store')).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toContain('Secret Street');
    expect(text).not.toContain('Guesty');
    expect(text).not.toMatch(/\d{1,2}:\d{2}/); // no time
    await expect(page.getByRole('button', { name: /accept/i })).toHaveCount(0);

    const html = await (await request.get(`/c/${token}`)).text();
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('noindex');
    expect(head).toContain('<meta name="referrer" content="no-referrer"');
    expect(head).not.toContain('Secret Street');
  });

  test('revoked, used, cancelled, unknown and guest-format tokens render the same invalid page', async ({ page }) => {
    const eventToken = await createEvent({ title: 'Secret title' });
    const revoked = await createCoHostLink(eventToken, { revoked: true });
    const used = await createCoHostLink(eventToken);
    await ensureCoHostUser();
    await sql`update public.co_host_invites set accepted_at = now(), accepted_by = ${CO_HOST_ID} where token = ${used}`;
    const cancelledEvent = await createEvent({ title: 'Secret cancelled', cancelled: true });
    const cancelled = await createCoHostLink(cancelledEvent);

    await page.goto('/c/UnknownCoHostToken0001');
    const unknownHtml = await page.locator('main').innerHTML();
    await expect(page.getByRole('heading', { name: 'Invite no longer valid' })).toBeVisible();
    for (const token of [revoked, used, cancelled, eventToken]) {
      await page.goto(`/c/${token}`);
      expect(await page.locator('main').innerHTML()).toBe(unknownHtml);
    }
    expect(unknownHtml).not.toContain('Secret');
  });

  test('a co-host token is not a guest invite link', async ({ page }) => {
    const eventToken = await createEvent({ title: 'Not via co-host token' });
    const token = await createCoHostLink(eventToken);
    await page.goto(`/i/${token}`);
    await expect(page.getByRole('heading', { name: 'Invite not found' })).toBeVisible();
  });

  test('universal-link file lists /c/*', async ({ request }) => {
    const body = await (await request.get('/.well-known/apple-app-site-association')).json();
    expect(body.applinks.details[0].components).toEqual(expect.arrayContaining([{ '/': '/i/*' }, { '/': '/c/*' }]));
  });
});

test.describe('host names on the invite', () => {
  test('an event with a co-host is "Hosted by E2E Host & Erik" on the page and in the preview', async ({ page, request }) => {
    const token = await createEvent({ title: 'Two hosts' });
    await addCoHost(token);
    await page.goto(`/i/${token}`);
    await expect(page.getByTestId('hosted-by')).toHaveText('Hosted by E2E Host & Erik');
    const html = await (await request.get(`/i/${token}`, { headers: { 'user-agent': 'WhatsApp/2.23' } })).text();
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('Hosted by E2E Host &amp; Erik');
    const og = await request.get(`/i/${token}/opengraph-image`);
    expect(og.status()).toBe(200);
    expect(og.headers()['content-type']).toContain('image/png');
  });

  test('Swedish joins host names with "och"', async ({ browser }) => {
    const token = await createEvent({ title: 'Två värdar' });
    await addCoHost(token);
    const ctx = await browser.newContext({ locale: 'sv-SE', extraHTTPHeaders: { 'accept-language': 'sv-SE' } });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:3100/i/${token}`);
    await expect(page.getByTestId('hosted-by')).toHaveText('Värdar: E2E Host och Erik');
    await ctx.close();
  });

  test('an event without co-hosts is unchanged', async ({ page }) => {
    const token = await createEvent({ title: 'One host' });
    await page.goto(`/i/${token}`);
    await expect(page.getByTestId('hosted-by')).toHaveText('Hosted by E2E Host');
  });
});
