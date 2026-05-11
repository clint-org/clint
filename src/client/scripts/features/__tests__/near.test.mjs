import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findNear } from '../near.mjs';

const baseCap = (over) => ({
  id: 'x',
  summary: 's',
  routes: [],
  rpcs: [],
  tables: [],
  related: [],
  user_facing: true,
  role: 'viewer',
  status: 'active',
  surface: 'S',
  sourceFile: 'f.md',
  ...over,
});

test('returns capabilities ranked by overlap count', () => {
  const collection = {
    surfaces: [],
    capabilities: [
      baseCap({ id: 'a', tables: ['markers'] }),
      baseCap({ id: 'b', tables: ['markers'], rpcs: ['get_dashboard_data'] }),
      baseCap({ id: 'c', tables: ['trials'] }),
    ],
    errors: [],
  };
  const hits = findNear(collection, { tables: ['markers'], rpcs: ['get_dashboard_data'] });
  assert.equal(hits.length, 2);
  assert.equal(hits[0].id, 'b'); // two overlaps
  assert.equal(hits[1].id, 'a'); // one overlap
});

test('returns empty list when nothing matches', () => {
  const collection = { surfaces: [], capabilities: [baseCap({ id: 'a' })], errors: [] };
  const hits = findNear(collection, { tables: ['no-such-table'] });
  assert.deepEqual(hits, []);
});

test('records the reasons for each hit', () => {
  const collection = {
    surfaces: [],
    capabilities: [baseCap({ id: 'a', rpcs: ['fn1'], routes: ['/r1'] })],
    errors: [],
  };
  const hits = findNear(collection, { rpcs: ['fn1'], routes: ['/r1'] });
  assert.equal(hits.length, 1);
  assert.ok(hits[0].reasons.some((r) => r.startsWith('rpcs=')));
  assert.ok(hits[0].reasons.some((r) => r.startsWith('routes=')));
});
