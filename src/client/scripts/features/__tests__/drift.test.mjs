import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDrift } from '../drift.mjs';

const baseCap = {
  routes: [],
  rpcs: [],
  tables: [],
  related: [],
  user_facing: true,
  role: 'viewer',
  status: 'active',
};

test('flags rpc referenced by capability but missing from pg_proc as error', () => {
  const collection = {
    surfaces: [{ file: 'foo.md', name: 'Foo' }],
    capabilities: [{ ...baseCap, id: 'a', summary: 's', rpcs: ['missing_rpc'], surface: 'Foo', sourceFile: 'foo.md' }],
    errors: [],
  };
  const live = { routes: new Set(), rpcs: new Set(), tables: new Set() };
  const report = checkDrift(collection, live);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].kind, 'rpc-not-in-db');
});

test('flags rpc in db but not mapped to any capability as error', () => {
  const collection = { surfaces: [], capabilities: [], errors: [] };
  const live = { routes: new Set(), rpcs: new Set(['orphan_rpc']), tables: new Set() };
  const report = checkDrift(collection, live);
  assert.ok(report.errors.some((e) => e.kind === 'rpc-unmapped' && e.message.includes('orphan_rpc')));
});

test('flags route in code but not mapped as warning (not error)', () => {
  const collection = { surfaces: [], capabilities: [], errors: [] };
  const live = { routes: new Set(['orphan-route']), rpcs: new Set(), tables: new Set() };
  const report = checkDrift(collection, live);
  assert.equal(report.errors.length, 0);
  assert.ok(report.warnings.some((w) => w.kind === 'route-unmapped'));
});

test('flags related id pointing to nonexistent capability as error', () => {
  const collection = {
    surfaces: [{ file: 'foo.md', name: 'Foo' }],
    capabilities: [{ ...baseCap, id: 'a', summary: 's', related: ['ghost'], surface: 'Foo', sourceFile: 'foo.md' }],
    errors: [],
  };
  const live = { routes: new Set(), rpcs: new Set(), tables: new Set() };
  const report = checkDrift(collection, live);
  assert.ok(report.errors.some((e) => e.kind === 'related-broken' && e.message.includes('ghost')));
});

test('flags TODO ids as error', () => {
  const collection = {
    surfaces: [{ file: 'foo.md', name: 'Foo' }],
    capabilities: [{ ...baseCap, id: 'TODO-rename', summary: 'TODO', surface: 'Foo', sourceFile: 'foo.md' }],
    errors: [],
  };
  const live = { routes: new Set(), rpcs: new Set(), tables: new Set() };
  const report = checkDrift(collection, live);
  assert.ok(report.errors.some((e) => e.kind === 'todo-id'));
});

test('honors matrix-skip flag to exempt entries', () => {
  const collection = { surfaces: [], capabilities: [], errors: [] };
  const live = { routes: new Set(['orphan-route']), rpcs: new Set(), tables: new Set() };
  const skipTags = { routes: { 'orphan-route': 'redirect-only' } };
  const report = checkDrift(collection, live, { skipTags });
  assert.equal(report.warnings.filter((w) => w.kind === 'route-unmapped').length, 0);
  assert.equal(report.skipped.length, 1);
});

test('surfaces parse-time errors from collection.errors verbatim', () => {
  const collection = {
    surfaces: [],
    capabilities: [],
    errors: [{ file: 'x.md', message: 'duplicate id foo' }],
  };
  const live = { routes: new Set(), rpcs: new Set(), tables: new Set() };
  const report = checkDrift(collection, live);
  assert.ok(report.errors.some((e) => e.kind === 'parse-error'));
});
