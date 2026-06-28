import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { findHardcodedSecretViolations } from '../check-migration-secrets.mjs';

function withTempMigrations(files, fn) {
  const dir = mkdtempSync(resolve(tmpdir(), 'migsec-'));
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(resolve(dir, name), body, 'utf8');
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('passes when no migration references the placeholder secret', () => {
  withTempMigrations(
    {
      '20260701000000_clean.sql': "do $$ begin perform public._seed_ctgov_markers('x','{}'::jsonb, gen_random_uuid()); end $$;",
    },
    (dir) => {
      assert.deepEqual(findHardcodedSecretViolations(dir), []);
    }
  );
});

test('flags a NEW migration that hardcodes the placeholder secret', () => {
  withTempMigrations(
    {
      '20260701000000_bad.sql': "do $$ begin perform public.ingest_ctgov_snapshot('local-dev-ctgov-secret', 'x'); end $$;",
    },
    (dir) => {
      const v = findHardcodedSecretViolations(dir);
      assert.equal(v.length, 1);
      assert.equal(v[0].file, '20260701000000_bad.sql');
      assert.deepEqual(v[0].lines, [1]);
    }
  );
});

test('grandfathers the known pre-existing (applied) migrations', () => {
  withTempMigrations(
    {
      // an allowlisted historical file that legitimately contains the literal
      '20260502120300_ctgov_worker_secret.sql': "perform vault.create_secret('local-dev-ctgov-secret', 'ctgov_worker_secret');",
      '20260625200000_ctgov_withdrawn_trials.sql': "perform public.ingest_ctgov_snapshot('local-dev-ctgov-secret', 'x');",
    },
    (dir) => {
      assert.deepEqual(findHardcodedSecretViolations(dir), []);
    }
  );
});

test('reports every line where the literal appears', () => {
  withTempMigrations(
    {
      '20260701000000_multi.sql': [
        "perform public.ingest_ctgov_snapshot('local-dev-ctgov-secret', 'a');",
        'select 1;',
        "perform public.ingest_ctgov_snapshot('local-dev-ctgov-secret', 'b');",
      ].join('\n'),
    },
    (dir) => {
      const v = findHardcodedSecretViolations(dir);
      assert.equal(v.length, 1);
      assert.deepEqual(v[0].lines, [1, 3]);
    }
  );
});
