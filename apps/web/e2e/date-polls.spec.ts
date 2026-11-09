import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  createPollEvent,
  eventIdFor,
  expirePoll,
  pickOption,
  pollOptionIds,
  setPollDeadline,
  sql,
} from './fixtures';

// Date polls on the web invite page (change: add-date-polls, tasks 5.1-5.4).

let seq = 0;
const guestToken = (name: string) => `poll-e2e-${Date.now().toString(36)}-${seq++}-${name}`.padEnd(30, 'x').slice(0, 40);
const ip = () => `198.51.100.${(seq++ % 200) + 20}`;

async function vote(request: APIRequestContext, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await request.post('/api/votes', { data: { displayName: 'API voter', ...body }, headers });
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> };
}

async function voterCount(token: string) {
  const [row] = await sql`select count(*)::int as n from public.date_poll_voters where event_id = ${await eventIdFor(token)}`;
  return row!.n as number;
}

test.describe('/api/votes', () => {
  test('saves a ballot and returns it; maps input errors to 400', async ({ request }) => {
    const token = await createPollEvent();
    const [a, b] = await pollOptionIds(token);
    const g = guestToken('a');
    const ok = await vote(request, { token, guestToken: g, votes: [{ optionId: a, choice: 'yes' }, { optionId: b, choice: 'no' }] });
    expect(ok).toEqual({ status: 200, body: { display_name: 'API voter', votes: { [a!]: 'yes', [b!]: 'no' } } });

    expect(await vote(request, { token, guestToken: g, displayName: ' ', votes: [{ optionId: a, choice: 'yes' }] })).toEqual({
      status: 400,
      body: { error: 'name_required' },
    });
    expect(await vote(request, { token, guestToken: g, votes: [] })).toEqual({ status: 400, body: { error: 'no_votes' } });
    expect(await vote(request, { token, guestToken: g, votes: [{ optionId: a, choice: 'maybe' }] })).toEqual({
      status: 400,
      body: { error: 'invalid_choice' },
    });
  });

  test('stale ballots get 409: unknown option, closed poll, picked poll', async ({ request }) => {
    const token = await createPollEvent();
    const [a] = await pollOptionIds(token);
    const g = guestToken('b');
    expect(
      await vote(request, { token, guestToken: g, votes: [{ optionId: '6f1c1f9e-4c1a-4b8e-9d55-0a4f0b7c1a11', choice: 'yes' }] }),
    ).toEqual({ status: 409, body: { error: 'option_not_found' } });

    await setPollDeadline(token, new Date(Date.now() - 60_000));
    expect(await vote(request, { token, guestToken: g, votes: [{ optionId: a, choice: 'yes' }] })).toEqual({
      status: 409,
      body: { error: 'poll_closed' },
    });
    await setPollDeadline(token, null);
    await pickOption(token, 0);
    expect(await vote(request, { token, guestToken: g, votes: [{ optionId: a, choice: 'yes' }] })).toEqual({
      status: 409,
      body: { error: 'poll_closed' },
    });
  });

  test('RSVPs are rejected with 409 while the date is pending', async ({ request }) => {
    const token = await createPollEvent();
    const res = await request.post('/api/rsvp', {
      data: { token, guestToken: guestToken('r'), displayName: 'Early', status: 'going' },
    });
    expect(res.status()).toBe(409);
    expect(await res.json()).toEqual({ error: 'date_pending' });
  });

  test('vote writes are rate limited per client and invite (429), in their own bucket', async ({ request }) => {
    const token = await createPollEvent();
    const [a] = await pollOptionIds(token);
    const headers = { 'x-real-ip': ip() };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await vote(request, { token, guestToken: guestToken(`f${i}`), votes: [{ optionId: a, choice: 'yes' }] }, headers)).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Withdrawing counts against the same bucket.
    const del = await request.delete('/api/votes', { data: { token, guestToken: guestToken('f0') }, headers });
    expect(del.status()).toBe(429);
  });
});

test('guest votes, changes and withdraws on a pending invite', async ({ page }) => {
  const token = await createPollEvent({ title: 'Poll party', hours: [48, 72, 96] });
  await page.goto(`/i/${token}`);

  await expect(page.getByTestId('when')).toContainText('Date TBD');
  await expect(page.getByTestId('poll-status')).toHaveText("The host hasn't picked a date yet. Answer for each time.");
  // No RSVP options and no calendar links while pending.
  await expect(page.getByTestId('answer-going')).toHaveCount(0);
  await expect(page.getByTestId('ics')).toHaveCount(0);

  // Name is required.
  await page.getByTestId('vote-0-yes').click();
  await page.getByTestId('save-votes').click();
  await expect(page.getByTestId('poll').getByRole('alert')).toHaveText('Enter your name');

  await page.getByLabel('Your name').fill('Saga');
  await page.getByTestId('vote-1-no').click();
  await page.getByTestId('save-votes').click();
  await expect(page.getByTestId('my-votes')).toContainText('Your votes are saved, Saga.');
  await expect(page.getByTestId('tallies-0')).toHaveText('1 yes · 0 if needed · 0 no');
  await expect(page.getByTestId('tallies-1')).toHaveText('0 yes · 0 if needed · 1 no');
  await expect(page.getByTestId('voters-0')).toHaveText('Saga');
  // No answers' names are never shown to guests.
  await expect(page.getByTestId('voters-1')).toHaveCount(0);

  // Persists on reload (same device), then change If needed on option 1.
  await page.reload();
  await expect(page.getByTestId('vote-0-yes')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('vote-0-if_needed').click();
  await page.getByTestId('save-votes').click();
  await expect(page.getByTestId('tallies-0')).toHaveText('0 yes · 1 if needed · 0 no');
  await expect(page.getByTestId('voters-0')).toHaveText('Saga · If needed');
  expect(await voterCount(token)).toBe(1);

  // Withdraw.
  await page.getByTestId('remove-votes').click();
  await expect(page.getByLabel('Your name')).toBeVisible();
  await expect(page.getByTestId('tallies-0')).toHaveText('0 yes · 0 if needed · 0 no');
  expect(await voterCount(token)).toBe(0);
});

test('closed deadline shows options and tallies without vote controls', async ({ page, request }) => {
  const token = await createPollEvent();
  const [a] = await pollOptionIds(token);
  await vote(request, { token, guestToken: guestToken('c'), displayName: 'Early bird', votes: [{ optionId: a, choice: 'yes' }] });
  await setPollDeadline(token, new Date(Date.now() - 60_000));

  await page.goto(`/i/${token}`);
  await expect(page.getByTestId('poll-status')).toHaveText('Voting has closed. The host will pick a date soon.');
  await expect(page.getByTestId('tallies-0')).toHaveText('1 yes · 0 if needed · 0 no');
  await expect(page.getByTestId('vote-0-yes')).toHaveCount(0);
  await expect(page.getByTestId('save-votes')).toHaveCount(0);
});

test('an expired poll shows the event as never scheduled', async ({ page }) => {
  const token = await createPollEvent();
  await expirePoll(token);
  await page.goto(`/i/${token}`);
  await expect(page.getByTestId('poll-status')).toHaveText('This event was never scheduled.');
  await expect(page.getByTestId('option-0')).toContainText('Passed');
  await expect(page.locator('[data-testid^="vote-"]')).toHaveCount(0);
});

test('link preview says "Date TBD — vote now" with no address, tallies or names; no calendar file', async ({ request }) => {
  const token = await createPollEvent({ title: 'Poll preview', location: 'Hemlig gatan 9' });
  const [a] = await pollOptionIds(token);
  await vote(request, { token, guestToken: guestToken('p'), displayName: 'Secret Voter', votes: [{ optionId: a, choice: 'yes' }] });

  const html = await (await request.get(`/i/${token}`, { headers: { 'user-agent': 'WhatsApp/2.23' } })).text();
  const head = html.slice(0, html.indexOf('</head>'));
  expect(head).toContain('<meta property="og:title" content="Poll preview"');
  expect(head).toContain('<meta property="og:description" content="Date TBD — vote now · Hosted by E2E Host"');
  expect(head).toMatch(/<meta property="og:image" content="[^"]+opengraph-image/);
  expect(head).not.toContain('Hemlig gatan');
  expect(head).not.toContain('Secret Voter');
  expect(head).not.toMatch(/1 yes/);

  const img = await request.get(`/i/${token}/opengraph-image`);
  expect(img.status()).toBe(200);
  expect(img.headers()['content-type']).toContain('image/png');

  const story = await request.get(`/i/${token}/story`);
  expect(story.status()).toBe(200);
  expect(story.headers()['content-type']).toBe('image/png');

  expect((await request.get(`/i/${token}/calendar.ics`)).status()).toBe(404);
});

test('pick flow: a Yes voter becomes Going and sees the picked date with calendar links', async ({ page, request }) => {
  const token = await createPollEvent({ title: 'Pick party' });
  await page.goto(`/i/${token}`);
  await page.getByLabel('Your name').fill('Vera');
  await page.getByTestId('vote-0-yes').click();
  await page.getByTestId('vote-1-no').click();
  await page.getByTestId('save-votes').click();
  await expect(page.getByTestId('my-votes')).toBeVisible();

  expect(await pickOption(token, 0)).toMatchObject({ going: 1, maybe: 0, waitlisted: 0 });

  await page.reload();
  await expect(page.getByTestId('when')).not.toContainText('Date TBD');
  await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Going');
  await expect(page.getByTestId('guest-list')).toContainText('Vera');
  await expect(page.getByTestId('ics')).toBeVisible();
  const ics = await request.get(`/i/${token}/calendar.ics`);
  expect(ics.status()).toBe(200);
  expect(await ics.text()).toContain('SUMMARY:Pick party');
});

test('a vote from a page loaded before the pick is rejected and the page shows the picked date', async ({ page }) => {
  const token = await createPollEvent({ title: 'Stale page' });
  await page.goto(`/i/${token}`);
  await page.getByLabel('Your name').fill('Late Larry');
  await page.getByTestId('vote-0-yes').click();

  await pickOption(token, 1);
  await page.getByTestId('save-votes').click();

  // The page reloads to the normal invite with RSVP options for the picked date.
  await expect(page.getByTestId('answer-going')).toBeVisible();
  await expect(page.getByTestId('when')).not.toContainText('Date TBD');
  expect(await voterCount(token)).toBe(0);
});
