import { defineConfig } from '@playwright/test';

/**
 * Unit-test Playwright config for pure-function tests that never launch a
 * browser (no `page` fixture). Skips globalSetup/webServer/projects so they
 * run in milliseconds without requiring Supabase or the Angular dev server.
 *
 * Tests covered: e2e/tests/grid-*.spec.ts where * matches a pure-function
 * module (currently grid-url-codec, grid-filter-algebra).
 */
export default defineConfig({
  testDir: './e2e/tests',
  testMatch: ['grid-url-codec.spec.ts', 'grid-filter-algebra.spec.ts'],
  reporter: [['list']],
  fullyParallel: true,
});
