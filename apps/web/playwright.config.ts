import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, locale: 'en-GB', timezoneId: 'Europe/Stockholm' },
  projects: [{ name: 'mobile-safari-like', use: { ...devices['iPhone 13'], browserName: 'chromium' } }],
  webServer: {
    command: `next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}`, NEXT_PUBLIC_EMAIL_UPDATES: 'true' },
  },
});
