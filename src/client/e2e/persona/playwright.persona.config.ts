import { defineConfig } from '@playwright/test';
import { join } from 'path';

export default defineConfig({
  testDir: './tests',
  outputDir: './reports/test-results',
  retries: 0,
  workers: 1,
  reporter: [['html', { outputFolder: join(__dirname, 'reports', 'html') }], ['list']],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    screenshot: 'on',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
});
