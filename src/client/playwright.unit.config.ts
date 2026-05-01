import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  testMatch: [
    'grid-url-codec.spec.ts',
    'grid-filter-algebra.spec.ts',
    'palette-prefix-token.spec.ts',
    'palette-hotkey.spec.ts',
    'palette-service-debounce.spec.ts',
    'palette-command-registry.spec.ts',
  ],
  reporter: [['list']],
  fullyParallel: true,
});
