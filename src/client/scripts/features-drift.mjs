#!/usr/bin/env node
// CLI dispatcher for the feature matrix.
// Subcommands: check, stub, near, surfaces-index.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { parseAll } from './features/parse-all.mjs';
import { extractRoutes } from './features/extract-routes.mjs';
import { extractRpcs, extractTables } from './features/extract-db.mjs';
import { checkDrift } from './features/drift.mjs';
import { generateStubs } from './features/stub.mjs';
import { findNear } from './features/near.mjs';
import { renderSurfacesIndex } from './features/render-surfaces-index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const FEATURES_DIR = process.env.FEATURES_DIR || resolve(REPO_ROOT, 'docs/runbook/features');
const ROUTES_TS = resolve(REPO_ROOT, 'src/client/src/app/app.routes.ts');
const INDEX_MD = resolve(REPO_ROOT, 'docs/runbook/03-features.md');
const DB_URL = process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const [, , subcommand, ...rawArgs] = process.argv;
const args = parseArgs(rawArgs);

(async () => {
  switch (subcommand) {
    case 'check':
      await cmdCheck();
      break;
    case 'stub':
      await cmdStub();
      break;
    case 'near':
      await cmdNear();
      break;
    case 'surfaces-index':
      await cmdSurfacesIndex();
      break;
    default:
      process.stderr.write(
        `usage: features-drift.mjs <check|stub|near|surfaces-index> [options]\n` +
          `  --tables a,b      (near)\n` +
          `  --rpcs   a,b      (near)\n` +
          `  --routes a,b      (near)\n` +
          `  --no-db           skip live RPC/table checks (for tests/offline)\n`,
      );
      process.exit(2);
  }
})().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});

function parseArgs(arr) {
  const out = { flags: new Set() };
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i];
    if (a === '--no-db') {
      out.flags.add('no-db');
    } else if (a.startsWith('--')) {
      out[a.slice(2)] = arr[++i];
    }
  }
  return out;
}

async function loadLive() {
  let routes = new Set();
  try {
    routes = new Set(await extractRoutes(ROUTES_TS));
  } catch {
    /* leave empty */
  }
  if (args.flags.has('no-db')) {
    return { routes, rpcs: new Set(), tables: new Set() };
  }
  try {
    const [rpcs, tables] = await Promise.all([extractRpcs(DB_URL), extractTables(DB_URL)]);
    return { routes, rpcs, tables };
  } catch (err) {
    process.stderr.write(
      `warning: could not query Supabase (${err.message}); use --no-db to silence.\n`,
    );
    return { routes, rpcs: new Set(), tables: new Set() };
  }
}

async function cmdCheck() {
  const collection = await parseAll(FEATURES_DIR);
  const live = await loadLive();
  const report = checkDrift(collection, live);

  if (report.errors.length === 0 && report.warnings.length === 0) {
    process.stdout.write('features-drift: clean\n');
    process.exit(0);
  }

  if (report.errors.length) {
    process.stdout.write(`\nERRORS (${report.errors.length}):\n`);
    for (const e of report.errors) {
      process.stdout.write(`  [${e.kind}] ${e.message}${e.file ? `  (${e.file})` : ''}\n`);
    }
  }
  if (report.warnings.length) {
    process.stdout.write(`\nWARNINGS (${report.warnings.length}):\n`);
    for (const w of report.warnings) {
      process.stdout.write(`  [${w.kind}] ${w.message}\n`);
    }
  }
  if (report.skipped.length) {
    process.stdout.write(`\nSKIPPED (${report.skipped.length}):\n`);
    for (const s of report.skipped) {
      process.stdout.write(`  [${s.kind}] ${s.target}: ${s.reason}\n`);
    }
  }

  process.exit(report.errors.length > 0 ? 1 : 0);
}

async function cmdStub() {
  const collection = await parseAll(FEATURES_DIR);
  const live = await loadLive();
  const report = checkDrift(collection, live);
  const { stubsBySurface, unsorted } = generateStubs(report, collection.surfaces);

  for (const [file, blocks] of Object.entries(stubsBySurface)) {
    const path = resolve(FEATURES_DIR, file);
    const existing = await readFile(path, 'utf8');
    const newBlocks = blocks.map((b) => `\n${b}`).join('\n');
    const updated = existing.replace(/```yaml([\s\S]*?)```/m, (match, body) => {
      return '```yaml' + body.trimEnd() + newBlocks + '\n```';
    });
    await writeFile(path, updated);
    process.stdout.write(`stubbed ${blocks.length} into ${file}\n`);
  }

  if (unsorted.length) {
    const unsortedPath = resolve(FEATURES_DIR, '_unsorted.md');
    let header = '';
    try {
      await readFile(unsortedPath, 'utf8');
    } catch {
      header =
        '---\nsurface: _Unsorted\n---\n\n# _Unsorted\n\nStubs for capabilities not yet assigned to a surface.\n\n## Capabilities\n\n```yaml\n';
    }
    await appendFile(unsortedPath, header + unsorted.join('\n\n') + '\n');
    process.stdout.write(`appended ${unsorted.length} stub(s) to _unsorted.md\n`);
  }
}

async function cmdNear() {
  const collection = await parseAll(FEATURES_DIR);
  const filters = {};
  if (args.tables) filters.tables = args.tables.split(',');
  if (args.rpcs) filters.rpcs = args.rpcs.split(',');
  if (args.routes) filters.routes = args.routes.split(',');
  const hits = findNear(collection, filters);

  if (hits.length === 0) {
    process.stdout.write('no overlapping capabilities found\n');
    return;
  }
  for (const h of hits) {
    process.stdout.write(`${h.id.padEnd(40)} surface: ${h.surface.padEnd(28)} (overlap: ${h.reasons.join('; ')})\n`);
  }
}

async function cmdSurfacesIndex() {
  const collection = await parseAll(FEATURES_DIR);
  const table = renderSurfacesIndex(collection);
  const existing = await readFile(INDEX_MD, 'utf8');
  const start = '<!-- AUTO-GEN:SURFACES -->';
  const end = '<!-- /AUTO-GEN:SURFACES -->';
  const sIdx = existing.indexOf(start);
  const eIdx = existing.indexOf(end);
  if (sIdx === -1 || eIdx === -1) {
    throw new Error(`${INDEX_MD}: AUTO-GEN:SURFACES markers not found`);
  }
  const updated =
    existing.slice(0, sIdx + start.length) + '\n' + table + '\n' + existing.slice(eIdx);
  await writeFile(INDEX_MD, updated);
  process.stdout.write(`updated AUTO-GEN:SURFACES in ${INDEX_MD}\n`);
}
