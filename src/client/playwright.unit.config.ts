import { defineConfig } from '@playwright/test';

// testDir is set to '.' so that testMatch globs resolve against the whole
// src/client tree. All existing e2e/tests specs use a path-anchored glob;
// utility unit tests under src/ use a recursive '**/' glob.
export default defineConfig({
  testDir: '.',
  testMatch: [
    'e2e/tests/grid-url-codec.spec.ts',
    'e2e/tests/grid-filter-algebra.spec.ts',
    'e2e/tests/palette-prefix-token.spec.ts',
    'e2e/tests/palette-hotkey.spec.ts',
    'e2e/tests/palette-service-debounce.spec.ts',
    'e2e/tests/palette-command-registry.spec.ts',
    '**/error-message.spec.ts',
  ],
  reporter: [['list']],
  fullyParallel: true,
});
