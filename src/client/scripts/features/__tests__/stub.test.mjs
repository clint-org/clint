import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStubs } from '../stub.mjs';

test('infers surface from route segment', () => {
  const report = {
    errors: [],
    warnings: [{ kind: 'route-unmapped', message: 'route /t/:tenantId/s/:spaceId/intelligence exists in code but no capability maps it' }],
    skipped: [],
  };
  const surfaces = [
    { file: 'intelligence.md', name: 'Intelligence' },
    { file: 'timeline-dashboard.md', name: 'Timeline Dashboard' },
  ];
  const result = generateStubs(report, surfaces);
  assert.ok(result.stubsBySurface['intelligence.md']);
  assert.match(result.stubsBySurface['intelligence.md'][0], /id:\s+TODO/);
  assert.match(result.stubsBySurface['intelligence.md'][0], /routes:\s*\n\s*-\s+\/t\/:tenantId\/s\/:spaceId\/intelligence/);
});

test('puts unsortable RPCs in _unsorted', () => {
  const report = {
    errors: [{ kind: 'rpc-unmapped', message: 'rpc new_widget_thing exists in pg_proc but no capability maps it' }],
    warnings: [],
    skipped: [],
  };
  const surfaces = [{ file: 'intelligence.md', name: 'Intelligence' }];
  const result = generateStubs(report, surfaces);
  assert.equal(result.unsorted.length, 1);
  assert.match(result.unsorted[0], /rpcs:\s*\n\s*-\s+new_widget_thing/);
});

test('returns empty result when nothing unmapped', () => {
  const report = { errors: [], warnings: [], skipped: [] };
  const result = generateStubs(report, []);
  assert.deepEqual(result.stubsBySurface, {});
  assert.deepEqual(result.unsorted, []);
});
