import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRedefViolations } from '../check-migration-redefs.mjs';

const f = (name, sql) => ({ name, sql });
const def = (fn) => `create or replace function public.${fn}(p uuid) returns void language sql as $$ select 1 $$;`;

test('flags a new migration that redefines a function below a deployed definition', () => {
  // base already has get_dashboard_data at 150000; PR adds a redefinition at 130600
  const baseFiles = [f('20260627150000_x.sql', def('get_dashboard_data'))];
  const headFiles = [
    f('20260627150000_x.sql', def('get_dashboard_data')),
    f('20260627130600_y.sql', def('get_dashboard_data')),
  ];
  const v = findRedefViolations({ baseFiles, headFiles });
  assert.equal(v.length, 1);
  assert.deepEqual(v[0], { fn: 'get_dashboard_data', newMax: '20260627130600', baseMax: '20260627150000' });
});

test('passes when the new migration sits above the deployed definition (the fix shape)', () => {
  // base has both the clobbering 130600 and the fix 150000; PR adds 180000 on top
  const baseFiles = [
    f('20260627130600_y.sql', def('get_dashboard_data')),
    f('20260627150000_x.sql', def('get_dashboard_data')),
  ];
  const headFiles = [
    ...baseFiles,
    f('20260627180000_fix.sql', def('get_dashboard_data')),
  ];
  assert.deepEqual(findRedefViolations({ baseFiles, headFiles }), []);
});

test('passes for an intra-PR redefinition series (all new, none below a deployed def)', () => {
  // function first introduced in this PR across three iterations -- no base definition
  const baseFiles = [];
  const headFiles = [
    f('20260627130300_a.sql', def('build_payload')),
    f('20260627130350_b.sql', def('build_payload')),
    f('20260627130400_c.sql', def('build_payload')),
  ];
  assert.deepEqual(findRedefViolations({ baseFiles, headFiles }), []);
});

test('passes when a new migration also adds a redefinition above the deployed one', () => {
  // PR adds BOTH a low (130600) and a high (190000) redefinition: db push applies
  // 190000 last, so live == db reset. newMax (190000) >= baseMax (150000): safe.
  const baseFiles = [f('20260627150000_x.sql', def('get_dashboard_data'))];
  const headFiles = [
    ...baseFiles,
    f('20260627130600_y.sql', def('get_dashboard_data')),
    f('20260627190000_z.sql', def('get_dashboard_data')),
  ];
  assert.deepEqual(findRedefViolations({ baseFiles, headFiles }), []);
});

test('ignores function names that appear only in comments', () => {
  const baseFiles = [f('20260627150000_x.sql', def('get_dashboard_data'))];
  const headFiles = [
    f('20260627150000_x.sql', def('get_dashboard_data')),
    f('20260627130600_y.sql', '-- create or replace function public.get_dashboard_data(...)\nselect 1;'),
  ];
  assert.deepEqual(findRedefViolations({ baseFiles, headFiles }), []);
});

test('does not flag distinct functions that never collide', () => {
  const baseFiles = [f('20260627150000_x.sql', def('get_dashboard_data'))];
  const headFiles = [
    f('20260627150000_x.sql', def('get_dashboard_data')),
    f('20260627130600_y.sql', def('get_bullseye_assets')),
  ];
  assert.deepEqual(findRedefViolations({ baseFiles, headFiles }), []);
});
