import { expect, test, type Page } from '@playwright/test';

import { E2E_HOST_ID, ensureHost, sql } from './fixtures';

// Group links and series dates on the web (change: add-groups-and-recurring-events, tasks 10.1-10.2).

let seq = 0;
const unique = () => `${Date.now().toString(36)}${seq++}`;

/** A group owned by the E2E host with one active (or revoked) link. Returns the group id and link token. */
async function createGroup(name: string, opts: { revoked?: boolean } = {}) {
  await ensureHost();
  const token = `GroupE2e${unique()}`.padEnd(22, 'x').slice(0, 22);
  const [g] = await sql`insert into public.groups (owner_id, name) values (${E2E_HOST_ID}, ${name}) returning id`;
  await sql`insert into public.group_members (group_id, user_id) values (${g!.id}, ${E2E_HOST_ID})`;
  await sql`insert into public.group_invite_links (token, group_id, revoked_at)
            values (${token}, ${g!.id}, ${opts.revoked ? new Date() : null})`;
  return { groupId: g!.id as string, token };
}

/** A weekly series for the group, created as the host through create_series. Returns its dates' tokens in order. */
async function createWeeklySeries(groupId: string, title: string): Promise<string[]> {
  const start = new Date(Date.now() + 2 * 86_400_000);
  start.setUTCHours(16, 0, 0, 0);
  const seriesId = await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: E2E_HOST_ID, role: 'authenticated' })}, true)`;
    await tx`set local role authenticated`;
    const [row] = await tx`select public.create_series(${groupId}, ${sql.json({
      title,
      location_text: 'Secret Bar 7',
      starts_at: start.toISOString(),
    })}, 'weekly') as r`;
    return (row!.r as { series_id: string }).series_id;
  });
  const rows = await sql`
    select i.token from public.events e join public.event_invites i on i.event_id = e.id and i.revoked_at is null
    where e.series_id = ${seriesId} order by e.occurrence_index`;
  return rows.map((r) => r.token as string);
}

async function answerGoing(page: Page, name: string) {
  await page.getByLabel('Your name').fill(name);
  await page.getByTestId('answer-going').click();
}

test.describe('group link in a browser (10.1)', () => {
  test('offers the app and shows only the name, owner and member count', async ({ page, request }) => {
    const { token } = await createGroup('AW crew');
    await page.goto(`/g/${token}`);
    await expect(page.getByRole('heading', { name: 'Join AW crew?' })).toBeVisible();
    await expect(page.getByTestId('group-summary')).toContainText("E2E Host's group · 1 member.");
    await expect(page.getByTestId('open-app')).toHaveAttribute('href', `checkin://g/${token}`);
    await expect(page.getByTestId('app-store')).toBeVisible();
    await expect(page.getByRole('button', { name: /join/i })).toHaveCount(0);

    const html = await (await request.get(`/g/${token}`)).text();
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain('noindex');
    expect(head).toContain('<meta name="referrer" content="no-referrer"');
  });

  test('turned-off and unknown links render the same invalid page', async ({ page }) => {
    const { token: revoked } = await createGroup('Secret group', { revoked: true });
    for (const token of [revoked, 'UnknownGroupLink123456', 'short']) {
      await page.goto(`/g/${token}`);
      await expect(page.getByTestId('group-invalid')).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Secret group');
    }
  });
});

test.describe('series date invite page (10.2)', () => {
  test('shows the group as host, the rule and the next date; a signed-out guest answers Going', async ({ page }) => {
    const { groupId } = await createGroup(`AW crew ${unique()}`);
    const [first, second] = await createWeeklySeries(groupId, 'AW');

    await page.goto(`/i/${first}`);
    await expect(page.getByTestId('hosted-by')).toContainText(/Hosted by AW crew \S+ · E2E Host/);
    await expect(page.getByTestId('series-rule')).toContainText(/Every (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/);

    await answerGoing(page, 'Colleague');
    await expect(page.getByTestId('my-answer')).toContainText('Going');
    const [row] = await sql`
      select r.user_id, (select count(*) from public.group_members m where m.group_id = ${groupId})::int as members
      from public.rsvps r join public.event_invites i on i.event_id = r.event_id
      where i.token = ${first} and r.display_name = 'Colleague'`;
    expect(row).toEqual({ user_id: null, members: 1 });

    await page.getByTestId('next-date').click();
    await expect(page).toHaveURL(new RegExp(`/i/${second}$`));
    // Answering one date never answers another.
    await expect(page.getByTestId('my-answer')).toHaveCount(0);
  });
});
