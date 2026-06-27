#!/usr/bin/env node
// Migration secret gate: fails (exit 1) if any NEW migration hardcodes the
// local-only ctgov worker secret `local-dev-ctgov-secret`.
//
// Why this exists
// ---------------
// The ctgov worker secret lives in Postgres `vault` (entry `ctgov_worker_secret`).
// Local `supabase db reset` seeds the placeholder `local-dev-ctgov-secret`
// (migration 20260502120300, create-if-not-exists); dev/prod use a real rotated
// secret. The worker-callable RPCs (`ingest_ctgov_snapshot`, `get_trials_for_polling`,
// `record_sync_run`) call `_verify_ctgov_worker_secret(p_secret)` first, which raises
// `42501 unauthorized` on mismatch.
//
// So an in-migration smoke that calls those RPCs with the hardcoded placeholder
// PASSES on local `db reset` but ABORTS `supabase db push` on any environment whose
// secret has been rotated off the placeholder. This is exactly what broke the dev
// deploy (PR #126): the secret was rotated, and the first new ctgov migration to
// deploy failed at its smoke.
//
// The fix for a smoke is to drive the internal SECURITY DEFINER functions directly
// (`_seed_ctgov_markers`, `_materialize_trial_from_snapshot`) -- no secret gate -- or
// to read the configured secret from `vault.decrypted_secrets`. See
// docs/supabase-guides/database-create-migration.md.
//
// Usage:  npm run migrations:check-secrets   (static file scan; no database needed)

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORBIDDEN = 'local-dev-ctgov-secret';

// Pre-existing migrations that contain the literal and are already applied to
// dev/prod (they ran while the remote secret was still the placeholder, so they
// are inert -- applied migrations never re-run). They CANNOT be edited (the
// "never edit an applied migration" rule). New migrations must not join this list.
//   - 20260502120300: legitimately DEFINES the placeholder (vault.create_secret).
//   - the rest: historical smoke blocks, grandfathered.
const ALLOWLIST = new Set([
  '20260502120300_ctgov_worker_secret.sql',
  '20260502120500_ctgov_ingest_rpc.sql',
  '20260502120600_ctgov_polling_rpcs.sql',
  '20260503060000_seed_ctgov_markers_on_sync.sql',
  '20260625200000_ctgov_withdrawn_trials.sql',
]);

// Strip a SQL `--` line comment from a single line. We only care about the
// secret appearing in EXECUTABLE SQL (e.g. passed as a string argument), not in
// an explanatory comment that merely names it. Block comments are stripped
// separately, file-wide, before line scanning.
function stripLineComment(line) {
  const i = line.indexOf('--');
  return i === -1 ? line : line.slice(0, i);
}

export function findHardcodedSecretViolations(migrationsDir) {
  const violations = [];
  const files = readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.sql'))
    .map((d) => d.name)
    .sort();

  for (const name of files) {
    if (ALLOWLIST.has(name)) continue;
    const raw = readFileSync(resolve(migrationsDir, name), 'utf8');
    // Blank out block comments (preserving newlines so line numbers stay exact)
    // so a /* ... */ mention is ignored too.
    const body = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const hits = [];
    body.split('\n').forEach((line, i) => {
      if (stripLineComment(line).includes(FORBIDDEN)) hits.push(i + 1);
    });
    if (hits.length > 0) violations.push({ file: name, lines: hits });
  }
  return violations;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(here, '../../../supabase/migrations');
  const violations = findHardcodedSecretViolations(migrationsDir);

  if (violations.length === 0) {
    console.log('migrations:check-secrets: OK (no new migration hardcodes the ctgov placeholder secret)');
    return;
  }

  console.error('migrations:check-secrets FAILED\n');
  console.error(
    `A migration hardcodes the local-only ctgov secret "${FORBIDDEN}". This PASSES on\n` +
      'local `db reset` but ABORTS `supabase db push` (42501 unauthorized) once the remote\n' +
      'vault secret is rotated off the placeholder -- blocking dev/prod deploys.\n'
  );
  for (const v of violations) {
    console.error(`  ${v.file}  (line${v.lines.length > 1 ? 's' : ''} ${v.lines.join(', ')})`);
  }
  console.error(
    '\nFix: in an in-migration smoke, do NOT call ingest_ctgov_snapshot / get_trials_for_polling /\n' +
      'record_sync_run with a hardcoded secret. Drive the internal functions directly\n' +
      '(_seed_ctgov_markers, _materialize_trial_from_snapshot), or read the real secret from\n' +
      'vault.decrypted_secrets. See docs/supabase-guides/database-create-migration.md.\n'
  );
  process.exit(1);
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  main();
}
