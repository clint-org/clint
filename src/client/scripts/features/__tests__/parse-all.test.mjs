import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseAll } from '../parse-all.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures');

test('walks all surface files and collects capabilities', async () => {
  const result = await parseAll(fixtureDir, ['timeline-dashboard.md']);
  assert.equal(result.surfaces.length, 1);
  assert.equal(result.capabilities.length, 2);
  assert.equal(result.errors.length, 0);
});

test('reports duplicate-id errors across files', async () => {
  const result = await parseAll(fixtureDir, ['dup-ids-a.md', 'dup-ids-b.md']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /duplicate id.*shared-id/i);
});

test('reports missing required fields', async () => {
  const result = await parseAll(fixtureDir, ['empty-capabilities.md']);
  assert.equal(result.capabilities.length, 0);
  assert.equal(result.errors.length, 0);
});

test('reports missing required fields per capability', async () => {
  const result = await parseAll(fixtureDir, ['missing-required-field.md']);
  assert.ok(
    result.errors.some((e) => /missing required field: status/i.test(e.message)),
    'expected a missing-status error',
  );
});

test('reports invalid role values', async () => {
  const result = await parseAll(fixtureDir, ['bad-role.md']);
  assert.ok(
    result.errors.some((e) => /invalid role: superuser/i.test(e.message)),
    'expected an invalid-role error',
  );
});

test('reports invalid status values', async () => {
  const result = await parseAll(fixtureDir, ['bad-status.md']);
  assert.ok(
    result.errors.some((e) => /invalid status: retired/i.test(e.message)),
    'expected an invalid-status error',
  );
});
