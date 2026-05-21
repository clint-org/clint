import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      singleWorker: true,
      miniflare: {
        compatibilityDate: '2026-04-28',
        compatibilityFlags: ['nodejs_compat'],
        // R2 binding mirrors wrangler.jsonc r2_buckets.MATERIALS_BUCKET.
        // Miniflare emulates the bucket in-memory; tests can read, write,
        // and delete objects as if hitting a real R2 instance.
        r2Buckets: ['MATERIALS_BUCKET'],
      },
    }),
  ],
  test: {
    include: ['worker/test/**/*.spec.ts'],
  },
});
