import { defineConfig } from '@playwright/test';
import { DEV_APEX } from './e2e-dev/helpers/dev-env';

/**
 * Dev-targeted regression suite config. Runs against the DEPLOYED dev stack
 * (dev.clintapp.com) -- real Cloudflare edge, real auth, real workers -- NOT a
 * local server. See docs/notes/dev-regression-suite.md.
 *
 * MUST run HEADED: headless never clears the Cloudflare managed challenge.
 * Set PWDEV_HEADLESS=1 only on an environment with a Cloudflare WAF bypass.
 *
 * Run via: npm run test:dev-e2e  (wraps the command in `infisical run`).
 */
export default defineConfig({
  testDir: './e2e-dev/tests',
  globalSetup: './e2e-dev/global-setup.ts',
  // Each test provisions its own scratch tenant, so tests are isolated, but we
  // default to serial + 1 worker: headed windows + shared Cloudflare edge make
  // high parallelism flaky. Override with --workers=N once a CI bypass exists.
  fullyParallel: false,
  workers: process.env['PWDEV_WORKERS'] ? Number(process.env['PWDEV_WORKERS']) : 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['html', { open: 'never' }], ['list']],
  // Generous timeouts: real network + Cloudflare challenge + live provisioning.
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `https://${DEV_APEX}`,
    headless: process.env['PWDEV_HEADLESS'] === '1',
    channel: 'chrome',
    navigationTimeout: 60_000,
    actionTimeout: 20_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      // Cloudflare bot-detection fingerprint (real Chrome, no automation flags).
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    },
  },
  projects: [{ name: 'dev-chrome' }],
});
