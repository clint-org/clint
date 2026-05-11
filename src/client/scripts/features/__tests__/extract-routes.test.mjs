import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractRoutes } from '../extract-routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(__dirname, 'fixtures', 'sample-routes.ts');

test('extracts nested route paths with parent prefixes', async () => {
  const routes = await extractRoutes(fixture);
  assert.ok(routes.includes('login'));
  assert.ok(routes.includes('t/:tenantId/s/:spaceId'));
  assert.ok(routes.includes('t/:tenantId/s/:spaceId/timeline'));
  assert.ok(routes.includes('t/:tenantId/s/:spaceId/manage/trials'));
});

test('omits the catch-all wildcard route', async () => {
  const routes = await extractRoutes(fixture);
  assert.ok(!routes.includes('**'));
});

test('returns redirect entries alongside loaded routes', async () => {
  const routes = await extractRoutes(fixture);
  assert.ok(routes.includes('t/:tenantId/s/:spaceId/old-route'));
});
