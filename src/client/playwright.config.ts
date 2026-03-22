import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:4201';

export default defineConfig({
  testDir: './e2e/tests',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  retries: process.env['CI'] ? 1 : 0,
  reporter: [['html'], ['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'ng serve --port 4201',
    port: 4201,
    reuseExistingServer: !process.env['CI'],
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
