#!/usr/bin/env node
// Migration redefinition gate: fails (exit 1) when a PR adds a migration that
// redefines a database function (CREATE OR REPLACE FUNCTION) whose ONLY new
// definitions all sort BEFORE an already-deployed (base-branch) definition of
// the same function.
//
// Why this exists
// ---------------
// `supabase db reset` (local + CI) replays every migration in VERSION order, so
// the highest-versioned definition of a function always wins. `supabase db push`
// (dev/prod deploy) only applies migrations not yet recorded, in version order
// AMONG the new ones -- but all of them land AFTER the migrations already applied
// in earlier deploys. So if a PR adds `..130600_x.sql` redefining get_dashboard_data
// while the deployed DB already has `..150000_y.sql` redefining it, db push applies
// the NEW 130600 last and silently reverts 150000's body. Local + CI stay green
// (db reset still lands 150000); only the deployed DB diverges.
//
// That is exactly how the get_dashboard_data "Unspecified indication node" fix got
// reverted on dev (restored by 20260627180000). Two separate files both doing
// `CREATE OR REPLACE FUNCTION f` produce NO git conflict, so merge review can't see
// it; this static+git check is the safeguard.
//
// The rule (precise, low false positive)
// --------------------------------------
// For each function F redefined by a file ADDED in this branch vs the base:
//   newMax  = highest migration version (in this branch) that redefines F
//   baseMax = highest migration version (in the base branch) that redefines F
// Flag F when baseMax exists AND newMax < baseMax -- i.e. the branch only adds
// redefinitions that sort before an already-deployed one. (If the branch also adds
// a redefinition above baseMax, db push applies THAT last, so live == db reset:
// safe, not flagged.)
//
// Fix for a flagged PR: re-author the redefinition at a version higher than the
// existing definer, or add a superseding migration at the top version (as
// 20260627180000 does). See docs/supabase-guides/database-create-migration.md.
//
// Usage:  npm run migrations:check-redefs
//   Base ref resolution order:
//     1. $MIGRATION_REDEF_BASE   (explicit)
//     2. origin/$GITHUB_BASE_REF (GitHub Actions PR base)
//     3. origin/develop          (default working base for this repo)
//   If no base ref resolves (e.g. a shallow clone missing the base), the check
//   prints a warning and exits 0 rather than failing CI spuriously.

import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const REDEF_RE = /create\s+or\s+replace\s+function\s+(?:public\.)?("?[a-z0-9_]+"?)/gi;
const VERSION_RE = /^(\d{14})_/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

function refExists(ref) {
  try {
    git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef() {
  const candidates = [];
  if (process.env.MIGRATION_REDEF_BASE) candidates.push(process.env.MIGRATION_REDEF_BASE);
  if (process.env.GITHUB_BASE_REF) candidates.push(`origin/${process.env.GITHUB_BASE_REF}`);
  candidates.push('origin/develop', 'origin/main');
  return candidates.find(refExists) ?? null;
}

// Blank out block comments (keep newlines) and strip -- line comments so a
// function name mentioned only in prose never counts as a redefinition.
function executableSql(raw) {
  const noBlock = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--');
      return i === -1 ? line : line.slice(0, i);
    })
    .join('\n');
}

function functionsDefinedIn(sql) {
  const fns = new Set();
  for (const m of executableSql(sql).matchAll(REDEF_RE)) {
    fns.add(m[1].replace(/"/g, '').toLowerCase());
  }
  return fns;
}

function versionOf(name) {
  const m = name.match(VERSION_RE);
  return m ? m[1] : null;
}

// Returns Map<functionName, maxVersionString> across the given files.
function maxVersionByFunction(fileEntries) {
  const out = new Map();
  for (const { name, sql } of fileEntries) {
    const v = versionOf(name);
    if (!v) continue;
    for (const fn of functionsDefinedIn(sql)) {
      const prev = out.get(fn);
      if (!prev || v > prev) out.set(fn, v);
    }
  }
  return out;
}

export function findRedefViolations({ baseFiles, headFiles }) {
  const baseNames = new Set(baseFiles.map((f) => f.name));
  const newFiles = headFiles.filter((f) => !baseNames.has(f.name));

  const baseMax = maxVersionByFunction(baseFiles);
  const newMax = maxVersionByFunction(newFiles);

  const violations = [];
  for (const [fn, nMax] of newMax) {
    const bMax = baseMax.get(fn);
    if (bMax && nMax < bMax) {
      violations.push({ fn, newMax: nMax, baseMax: bMax });
    }
  }
  return violations.sort((a, b) => a.fn.localeCompare(b.fn));
}

function readHeadFiles(migrationsDir) {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.sql'))
    .map((d) => ({ name: d.name, sql: readFileSync(resolve(migrationsDir, d.name), 'utf8') }));
}

function readBaseFiles(baseRef) {
  const listing = git(['ls-tree', '-r', '--name-only', baseRef, 'supabase/migrations/']);
  const files = listing
    .split('\n')
    .map((p) => p.trim())
    .filter((p) => p.endsWith('.sql'));
  return files.map((path) => ({
    name: path.split('/').pop(),
    sql: git(['show', `${baseRef}:${path}`]),
  }));
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const migrationsDir = resolve(here, '../../../supabase/migrations');

  const baseRef = resolveBaseRef();
  if (!baseRef) {
    console.warn(
      'migrations:check-redefs: SKIPPED (no base ref resolved; set MIGRATION_REDEF_BASE or fetch origin/develop)'
    );
    return;
  }

  const headFiles = readHeadFiles(migrationsDir);
  const baseFiles = readBaseFiles(baseRef);
  const violations = findRedefViolations({ baseFiles, headFiles });

  if (violations.length === 0) {
    console.log(`migrations:check-redefs: OK (vs ${baseRef}; no out-of-order function redefinition)`);
    return;
  }

  console.error(`migrations:check-redefs FAILED (base ${baseRef})\n`);
  console.error(
    'A new migration redefines a function whose newly-added definition(s) all sort\n' +
      'BEFORE an already-deployed definition of the same function. `db reset` (and CI)\n' +
      'will keep the higher-versioned body, but `supabase db push` applies the new lower-\n' +
      'versioned file LAST on dev/prod and silently reverts it.\n'
  );
  for (const v of violations) {
    console.error(
      `  ${v.fn}: new redefinition at ${v.newMax} sorts before deployed definition at ${v.baseMax}`
    );
  }
  console.error(
    '\nFix: re-author the redefinition at a version higher than the deployed one, or add a\n' +
      'superseding migration at the top version that re-applies the intended body (see\n' +
      '20260627180000_fix_get_dashboard_data_unspecified_clobber.sql and\n' +
      'docs/supabase-guides/database-create-migration.md).\n'
  );
  process.exit(1);
}

if (resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1] ?? '')) {
  main();
}
