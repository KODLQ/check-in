// End-to-end against the local stack: web app -> Postgres outbox -> notifications-worker (Edge Function)
// -> Mailpit. Needs `supabase functions serve` (or `supabase start` with edge-runtime) and the worker
// secret in Vault (node supabase/scripts/configure-worker.mjs). See supabase/functions/notifications-worker/README.md.
import { expect, test } from '@playwright/test';

import { createEvent, eventIdFor, mailDetail, mailsTo, postAnnouncement, runWorker, sql, subscriptionFor, waitForMail } from './fixtures';

test.describe.configure({ timeout: 120_000 });

const unique = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

test('cancelling an event emails subscribed guests within a minute', async ({ request }) => {
  const token = await createEvent({ title: `Cancel me ${Date.now()}` });
  const email = unique('cancel');
  const res = await request.post('/api/rsvp', {
    data: { token, guestToken: `cancel-${Date.now()}-000000000`, displayName: 'Guest', status: 'going', email, emailConsent: true },
  });
  expect((await res.json()).email_updates.state).toBe('on');

  await sql`update events set cancelled_at = now() where id = ${await eventIdFor(token)}`;
  // No manual worker run: the cancellation trigger kicks the worker (and pg_cron runs it every minute).
  const mail = await waitForMail(email, /^Cancelled: Cancel me/, 60_000);
  const detail = await mailDetail(mail.ID);
  expect(detail.Text).toContain('cancelled the event');
  expect(detail.headers['List-Unsubscribe-Post']).toEqual(['List-Unsubscribe=One-Click']);
});

test.describe('Swedish guest', () => {
  test.use({ locale: 'sv-SE' });

  test('opt in -> Swedish confirmation -> unsubscribe from the email -> no further emails', async ({ page, request }) => {
    const title = `Kräftskiva ${Date.now()}`;
    const token = await createEvent({ title });
    const email = unique('sv');
    const control = unique('control');

    await page.goto(`/i/${token}`);
    await page.getByLabel('Ditt namn').fill('Saga');
    await page.getByLabel('Mejl (valfritt)').fill(email);
    await page.getByLabel('Mejla mig uppdateringar om det här eventet').check();
    await page.getByRole('button', { name: 'Kommer' }).click();
    await expect(page.getByTestId('email-status')).toContainText('Mejluppdateringar på');
    expect((await subscriptionFor(email))?.locale).toBe('sv');

    // A second subscribed guest proves announcements are still delivered to others.
    await request.post('/api/rsvp', {
      data: { token, guestToken: `control-${Date.now()}-00000000`, displayName: 'Bo', status: 'maybe', email: control, emailConsent: true },
    });

    const confirmation = await waitForMail(email, new RegExp(`^Du får uppdateringar om ${title}`), 60_000);
    const detail = await mailDetail(confirmation.ID);
    expect(detail.Text).toContain('Värden kan inte se din mejladress');
    expect(detail.Text).toContain(`/i/${token}`);
    expect(detail.headers['List-Unsubscribe']?.[0]).toMatch(/^<http[^>]+\/api\/unsubscribe\/[A-Za-z0-9_-]{22}>$/);
    const unsubscribePath = detail.Text.match(/\/u\/[A-Za-z0-9_-]{22}/)?.[0];
    expect(unsubscribePath).toBeTruthy();

    await page.goto(unsubscribePath!);
    await page.getByRole('button', { name: 'Avregistrera' }).click();
    await expect(page.getByRole('heading', { name: 'Du är avregistrerad' })).toBeVisible();
    expect(await subscriptionFor(email)).toBeUndefined();

    // Host posts an announcement. Fan it out at a daytime clock so quiet hours don't hide the result,
    // then let the worker send it.
    await waitForMail(control, /^Du får uppdateringar|^You'll get updates/, 60_000);
    await postAnnouncement(token, 'Ta med jacka, vi är på taket');
    await sql`select public.fan_out_due_notifications(100,
      (((now() at time zone 'Europe/Stockholm')::date + 1) + time '12:00') at time zone 'Europe/Stockholm')`;
    await runWorker();
    await waitForMail(control, /^New update about|^Ny uppdatering om/, 30_000);
    const after = await mailsTo(email);
    expect(after.map((m) => m.Subject)).toEqual([confirmation.Subject]);
  });
});
