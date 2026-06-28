import test from 'node:test';
import assert from 'node:assert/strict';
import { diff, failsOn } from './reconcile.mjs';

test('a key in db but not r2 is dangling', () => {
  const r = diff(new Set(['a']), new Set(), new Set());
  assert.deepEqual(r.dangling, ['a']);
});

test('a key in r2 but not db is orphan', () => {
  const r = diff(new Set(), new Set(['b']), new Set(['b']));
  assert.deepEqual(r.orphan, ['b']);
});

test('a key in r2 but not b2 is mirror_gap', () => {
  const r = diff(new Set(['c']), new Set(['c']), new Set());
  assert.deepEqual(r.mirror_gap, ['c']);
});

test('an all-aligned set yields three empty arrays', () => {
  const keys = new Set(['x', 'y', 'z']);
  const r = diff(new Set(keys), new Set(keys), new Set(keys));
  assert.deepEqual(r.dangling, []);
  assert.deepEqual(r.orphan, []);
  assert.deepEqual(r.mirror_gap, []);
});

test('failsOn: dangling fails the job', () => {
  assert.equal(failsOn({ dangling: ['a'], orphan: [], mirror_gap: [] }), true);
});

test('failsOn: mirror_gap fails the job', () => {
  assert.equal(failsOn({ dangling: [], orphan: [], mirror_gap: ['c'] }), true);
});

test('failsOn: orphan alone does not fail the job', () => {
  assert.equal(failsOn({ dangling: [], orphan: ['b'], mirror_gap: [] }), false);
});

test('failsOn: all-clear does not fail', () => {
  assert.equal(failsOn({ dangling: [], orphan: [], mirror_gap: [] }), false);
});
