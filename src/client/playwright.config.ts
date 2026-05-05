import { defineConfig, devices } from '@playwright/test';

const baseURL = 'http://localhost:4201';

// Pure-logic specs that live under e2e/tests/ but never drive a browser.
// They run via the test:unit script (playwright.unit.config.ts) and must be
// excluded here so the e2e job does not double-execute them.
const UNIT_SPECS_IN_E2E_DIR = [
  '**/grid-filter-algebra.spec.ts',
  '**/grid-url-codec.spec.ts',
  '**/palette-command-registry.spec.ts',
  '**/palette-hotkey.spec.ts',
  '**/palette-prefix-token.spec.ts',
  '**/palette-service-debounce.spec.ts',
];

export default defineConfig({
  testDir: './e2e/tests',
  testIgnore: UNIT_SPECS_IN_E2E_DIR,
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
