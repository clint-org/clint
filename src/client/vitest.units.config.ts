import { defineConfig } from 'vitest/config';

/**
 * Node-environment unit tests for pure helpers under src/app. Distinct from:
 *   - worker/vitest.config.mts (Cloudflare workerd pool, for the Worker)
 *   - integration/vitest.config.ts (node, single-fork, hits live Postgres)
 *   - playwright.unit.config.ts (browser-pool component tests)
 *
 * Use this config for pure functions that don't depend on Angular DI, the
 * browser, or external services. Specs live next to the files they cover
 * (e.g. src/app/shared/utils/foo.ts -> src/app/shared/utils/foo.spec.ts).
 */
export default defineConfig({
  test: {
    include: ['src/app/**/*.spec.ts'],
    // error-message.spec.ts is a Playwright unit test (registered via
    // playwright.unit.config.ts -> npm run test:unit). It uses
    // @playwright/test's `test.describe` which throws if loaded outside
    // a Playwright runner. Exclude by name; if more Playwright unit
    // specs land, generalize this exclude pattern.
    exclude: ['**/error-message.spec.ts', 'node_modules/**'],
    environment: 'node',
    globals: true,
  },
});
