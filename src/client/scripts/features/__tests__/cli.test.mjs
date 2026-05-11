import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '../../features-drift.mjs');
const FIXTURE_FEATURES_DIR = resolve(__dirname, 'fixtures');

function run(args, env = {}) {
  return new Promise((resolveProm) => {
    const child = spawn('node', [CLI, ...args], {
      env: { ...process.env, FEATURES_DIR: FIXTURE_FEATURES_DIR, ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolveProm({ code, stdout, stderr }));
  });
}

test('check exits non-zero on error-level drift', async () => {
  // Fixture dir has dup-ids-a + dup-ids-b which collide.
  const { code, stdout } = await run(['check', '--no-db']);
  assert.equal(code, 1);
  assert.match(stdout, /duplicate id/);
});

test('near returns the expected overlap list', async () => {
  // timeline-dashboard.md fixture has timeline-grid with tables: [trials]
  const { code, stdout } = await run(['near', '--tables', 'trials', '--no-db']);
  assert.equal(code, 0);
  assert.match(stdout, /timeline-grid/);
});

test('unknown subcommand exits with usage', async () => {
  const { code, stderr } = await run(['nonsense']);
  assert.equal(code, 2);
  assert.match(stderr, /usage|unknown/i);
});
