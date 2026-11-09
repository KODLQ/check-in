import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createEvent, eventIdFor, mailsTo, runWorker, sql, waitForMail } from './fixtures';

// Guest capacity on the web invite page (change: add-guest-capacity, tasks 4.1-4.3).

let seq = 0;
const guestToken = (name: string) => `cap-e2e-${Date.now().toString(36)}-${seq++}-${name}`.padEnd(30, 'x').slice(0, 40);

async function rsvp(request: APIRequestContext, body: Record<string, unknown>) {
  const res = await request.post('/api/rsvp', { data: { displayName: 'API guest', status: 'going', ...body } });
  return { status: res.status(), body: (await res.json()) as Record<string, unknown> };
}

async function statusOf(token: string, name: string) {
  const [row] = await sql`
    select r.status::text as status, r.plus_ones from public.rsvps r
    join public.event_invites i on i.event_id = r.event_id
    where i.token = ${token} and r.display_name = ${name}`;
  return row as { status: string; plus_ones: number } | undefined;
}

async function answer(page: Page, name: string) {
  await page.getByLabel('Your name').fill(name);
  await page.getByTestId('answer-going').click();
}

test.describe('/api/rsvp capacity errors', () => {
  test('plus-ones are rejected when the host does not allow them', async ({ request }) => {
    const token = await createEvent();
    const r = await rsvp(request, { token, guestToken: guestToken('a'), plusOnes: 1 });
    expect(r).toEqual({ status: 400, body: { error: 'plus_ones_not_allowed' } });
  });

  test("more plus-ones than the host's maximum are rejected with the maximum", async ({ request }) => {
    const token = await createEvent({ allowPlusOnes: true, maxPlusOnes: 1 });
    const r = await rsvp(request, { token, guestToken: guestToken('a'), plusOnes: 2 });
    expect(r).toEqual({ status: 400, body: { error: 'too_many_plus_ones', max_plus_ones: 1 } });
    // Above the absolute bound (5) the schema rejects it before the database.
    const r2 = await rsvp(request, { token, guestToken: guestToken('b'), plusOnes: 6 });
    expect(r2).toEqual({ status: 400, body: { error: 'too_many_plus_ones' } });
  });

  test('clients cannot answer "waitlisted"', async ({ request }) => {
    const token = await createEvent({ capacity: 2 });
    const r = await rsvp(request, { token, guestToken: guestToken('a'), status: 'waitlisted' });
    expect(r).toEqual({ status: 400, body: { error: 'invalid_status' } });
  });

  test('a Going guest asking for more plus-ones than spots left gets 409 with spots_left', async ({ request }) => {
    const token = await createEvent({ capacity: 3, allowPlusOnes: true, maxPlusOnes: 3 });
    const me = guestToken('me');
    expect((await rsvp(request, { token, guestToken: me, displayName: 'Me' })).body.status).toBe('going');
    await rsvp(request, { token, guestToken: guestToken('b'), displayName: 'Other' });
    const r = await rsvp(request, { token, guestToken: me, displayName: 'Me', plusOnes: 2 });
    expect(r).toEqual({ status: 409, body: { error: 'capacity_exceeded', spots_left: 1 } });
    expect(await statusOf(token, 'Me')).toEqual({ status: 'going', plus_ones: 0 });
  });

  test('a Going answer that does not fit is waitlisted with its position', async ({ request }) => {
    const token = await createEvent({ capacity: 1 });
    await rsvp(request, { token, guestToken: guestToken('a') });
    const r = await rsvp(request, { token, guestToken: guestToken('b'), displayName: 'Late' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: 'waitlisted', waitlist_position: 1, spots_left: 0, plus_ones: 0 });
  });
});

test('RSVP with plus-ones: stepper up to the maximum, "Going +2" and heads in the count', async ({ page }) => {
  const token = await createEvent({ title: 'Plus party', allowPlusOnes: true, maxPlusOnes: 2 });
  await page.goto(`/i/${token}`);
  const more = page.getByRole('button', { name: 'One friend more' });
  await more.click();
  await more.click();
  await expect(page.getByTestId('plus-ones-value')).toHaveText('2');
  await expect(more).toBeDisabled(); // can't pick more than the host allows
  await answer(page, 'Saga');
  await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Going +2');
  await expect(page.getByTestId('going-count')).toHaveText('3 people going');
  await expect(page.getByTestId('guest-list')).toContainText('Saga +2');
  expect(await statusOf(token, 'Saga')).toEqual({ status: 'going', plus_ones: 2 });

  // Maybe drops the plus-ones.
  await page.getByTestId('answer-maybe').click();
  await expect(page.getByTestId('my-answer')).toHaveText('Your answer: Maybe');
  expect(await statusOf(token, 'Saga')).toEqual({ status: 'maybe', plus_ones: 0 });
});

test('no stepper when the host does not allow plus-ones', async ({ page }) => {
  const token = await createEvent();
  await page.goto(`/i/${token}`);
  await expect(page.getByTestId('answer-going')).toHaveText('Going');
  await expect(page.getByTestId('plus-ones')).toHaveCount(0);
});

test('full event: "Full — join waitlist", then the waitlist position', async ({ page, request }) => {
  const token = await createEvent({ capacity: 2, guestListVisible: true });
  await rsvp(request, { token, guestToken: guestToken('a'), displayName: 'Ann' });
  await rsvp(request, { token, guestToken: guestToken('b'), displayName: 'Ben' });
  await rsvp(request, { token, guestToken: guestToken('c'), displayName: 'Cat' }); // waitlisted #1
  await page.goto(`/i/${token}`);
  await expect(page.getByTestId('answer-going')).toHaveText('Full — join waitlist');
  await expect(page.getByTestId('answer-maybe')).toBeVisible();
  await expect(page.getByTestId('answer-declined')).toBeVisible();
  await expect(page.getByTestId('capacity-line')).toHaveText('Full · 1 on the waitlist');
  await expect(page.getByTestId('guest-list')).not.toContainText('Cat');
  await answer(page, 'Dora');
  await expect(page.getByTestId('my-answer')).toHaveText("You're on the waitlist — #2");
  await expect(page.getByTestId('going-count')).toHaveText('2 people going');
});

test('waitlist to promotion: A withdraws, B gets the spot; link preview unchanged', async ({ browser, request }) => {
  const token = await createEvent({ title: 'Small flat', capacity: 1 });
  const ogBefore = await ogTags(request, token);

  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  await a.goto(`/i/${token}`);
  await answer(a, 'Alva');
  await expect(a.getByTestId('my-answer')).toHaveText('Your answer: Going');

  await b.goto(`/i/${token}`);
  await expect(b.getByTestId('answer-going')).toHaveText('Full — join waitlist');
  await answer(b, 'Bo');
  await expect(b.getByTestId('my-answer')).toHaveText("You're on the waitlist — #1");

  await a.getByRole('button', { name: 'Remove my reply' }).click();
  await expect(a.getByTestId('my-answer')).toHaveCount(0);

  await b.reload();
  await expect(b.getByTestId('got-a-spot')).toHaveText('You got a spot!');
  await expect(b.getByTestId('my-answer')).toHaveText('Your answer: Going');
  await expect(b.getByTestId('going-count')).toHaveText('1 person going');
  expect(await statusOf(token, 'Bo')).toEqual({ status: 'going', plus_ones: 0 });

  // Previews never show capacity or "full" (spec: out of scope), so they are identical when full.
  const ogAfter = await ogTags(request, token);
  expect(ogAfter).toEqual(ogBefore);
  expect(ogAfter.join('\n')).not.toMatch(/full|waitlist|capacity/i);

  await a.context().close();
  await b.context().close();
});

async function ogTags(request: APIRequestContext, token: string): Promise<string[]> {
  const html = await (await request.get(`/i/${token}`, { headers: { 'user-agent': 'WhatsApp/2.23' } })).text();
  const head = html.slice(0, html.indexOf('</head>'));
  return [...head.matchAll(/<meta (?:property|name)="(?:og|twitter):[^>]+>|<meta name="description"[^>]+>/g)]
    .map((m) => m[0])
    .sort();
}

test('a promoted web guest who opted in gets exactly one "You got a spot" email', async ({ request }) => {
  test.setTimeout(120_000);
  const title = `Tiny room ${Date.now()}`;
  const token = await createEvent({ title, capacity: 1 });
  const email = `promoted-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  const first = guestToken('first');
  await rsvp(request, { token, guestToken: first, displayName: 'First' });
  const joined = await rsvp(request, {
    token, guestToken: guestToken('waiting'), displayName: 'Waiting', email, emailConsent: true,
  });
  expect(joined.body).toMatchObject({ status: 'waitlisted', email_updates: { state: 'on' } });

  const res = await request.delete('/api/rsvp', { data: { token, guestToken: first } });
  expect(res.status()).toBe(200);
  expect(await statusOf(token, 'Waiting')).toEqual({ status: 'going', plus_ones: 0 });

  // waitlist_promoted is not urgent, so quiet hours apply: fan out at the next Stockholm noon (never in
  // the past) so the test doesn't depend on the time of day, then let the worker send it.
  const eventId = await eventIdFor(token);
  await sql`
    with noon as (
      select (date_trunc('day', now() at time zone 'Europe/Stockholm') + interval '12 hours') at time zone 'Europe/Stockholm' as t
    )
    select public.fan_out_due_notifications(100, case when t >= now() then t else t + interval '1 day' end) from noon`;
  const [n] = await sql`select count(*)::int as c from public.notifications where event_id = ${eventId} and kind = 'waitlist_promoted'`;
  expect(n!.c).toBe(1);
  await runWorker();
  await waitForMail(email, new RegExp(`^You got a spot: ${title}`), 60_000);
  await runWorker();
  expect((await mailsTo(email)).filter((m) => m.Subject.startsWith('You got a spot')).length).toBe(1);
});
