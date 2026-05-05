import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/tests/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    environment: 'node',
    globals: true,
    pool: 'forks',
    // Sequential file execution: integration tests share Postgres state via
    // the persona graph fixture, so concurrent files would race on
    // buildPersonas() (both wipe + createUser at the same time on the same
    // emails). The vitest 3->4 rename moved this knob from `fileParallel`
    // to `fileParallelism`; passing both makes it work on either version.
    fileParallelism: false,
    forks: { singleFork: true },
  },
});
