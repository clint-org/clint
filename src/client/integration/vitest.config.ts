import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['integration/tests/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    environment: 'node',
    globals: true,
    pool: 'forks',
    fileParallel: false,
    forks: { singleFork: true },
  },
});
