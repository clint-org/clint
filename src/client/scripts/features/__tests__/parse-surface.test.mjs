import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseSurface } from '../parse-surface.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(__dirname, 'fixtures', name);

test('parses surface frontmatter, name, and capabilities', async () => {
  const result = await parseSurface(fixture('timeline-dashboard.md'));
  assert.equal(result.surfaceName, 'Timeline Dashboard');
  assert.equal(
    result.frontmatter.spec,
    'docs/superpowers/specs/2026-04-12-unified-landscape-design.md',
  );
  assert.equal(result.capabilities.length, 2);
  assert.equal(result.capabilities[0].id, 'timeline-grid');
  assert.deepEqual(result.capabilities[0].routes, ['/t/:tenantId/s/:spaceId/timeline']);
  assert.deepEqual(result.capabilities[1].related, ['timeline-grid']);
});

test('returns empty capabilities array for empty yaml block', async () => {
  const result = await parseSurface(fixture('empty-capabilities.md'));
  assert.equal(result.surfaceName, 'Empty Surface');
  assert.deepEqual(result.capabilities, []);
});

test('throws when ## Capabilities block is missing', async () => {
  await assert.rejects(() => parseSurface(fixture('missing-block.md')), {
    message: /missing.*Capabilities/i,
  });
});
