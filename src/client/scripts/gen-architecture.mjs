#!/usr/bin/env node
// Regenerates AUTO-GEN blocks in docs/runbook/*.md from live state:
// - Postgres schema via local Supabase (tables, foreign keys, pg_proc)
// - src/client/package.json (curated dependency versions)
// - src/client/src/app/app.routes.ts (route tree)
//
// Usage:
//   npm run docs:arch          (requires `supabase start`)
//   SUPABASE_DB_URL=... npm run docs:arch
//
// Walks runbook files for <!-- AUTO-GEN:NAME --> ... <!-- /AUTO-GEN:NAME -->
// markers and replaces the contents. Files without markers are left untouched.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import ts from 'typescript';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Script lives at src/client/scripts/, repo root is three levels up.
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const RUNBOOK = resolve(REPO_ROOT, 'docs/runbook');
const PKG_JSON = resolve(REPO_ROOT, 'src/client/package.json');
const ROUTES_TS = resolve(REPO_ROOT, 'src/client/src/app/app.routes.ts');

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// ---------- shared injection helper ----------

async function injectBlock(file, name, content) {
  const path = resolve(RUNBOOK, file);
  const text = await readFile(path, 'utf8');
  const start = `<!-- AUTO-GEN:${name} -->`;
  const end = `<!-- /AUTO-GEN:${name} -->`;
  const sIdx = text.indexOf(start);
  if (sIdx === -1) {
    console.warn(`  skip      ${file} :: ${name} (no start marker)`);
    return false;
  }
  const eIdx = text.indexOf(end, sIdx);
  if (eIdx === -1) {
    throw new Error(`Missing ${end} after ${start} in ${file}`);
  }
  const before = text.slice(0, sIdx + start.length);
  const after = text.slice(eIdx);
  const next = `${before}\n${content.trim()}\n${after}`;
  if (next === text) {
    console.log(`  unchanged ${file} :: ${name}`);
    return false;
  }
  await writeFile(path, next, 'utf8');
  console.log(`  updated   ${file} :: ${name}`);
  return true;
}

// ---------- 02-tech-stack.md :: VERSIONS ----------

async function genVersions() {
  const pkg = JSON.parse(await readFile(PKG_JSON, 'utf8'));
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  // Curated, ordered surface — the deps we actually want pinned in docs.
  // Edit this list when a new top-level dep deserves a callout.
  const surfaced = [
    '@angular/core',
    '@angular/cdk',
    'typescript',
    'rxjs',
    'zone.js',
    'tslib',
    'primeng',
    '@primeng/themes',
    'tailwindcss',
    'tailwindcss-primeui',
    '@supabase/supabase-js',
    'pptxgenjs',
    'prosemirror-state',
    'prosemirror-view',
    'prosemirror-model',
    '@fortawesome/fontawesome-free',
  ];
  const lines = ['| Package | Version |', '|---|---|'];
  for (const dep of surfaced) {
    if (all[dep]) lines.push(`| \`${dep}\` | ${all[dep]} |`);
  }
  return lines.join('\n');
}

// ---------- 05-frontend-architecture.md :: ROUTES ----------

function genRoutes() {
  const src = readFileSync(ROUTES_TS, 'utf8');
  const sf = ts.createSourceFile(
    'app.routes.ts',
    src,
    ts.ScriptTarget.Latest,
    true
  );

  let routesArray = null;
  sf.forEachChild((node) => {
    if (!ts.isVariableStatement(node)) return;
    for (const decl of node.declarationList.declarations) {
      if (
        ts.isIdentifier(decl.name) &&
        decl.name.text === 'routes' &&
        decl.initializer &&
        ts.isArrayLiteralExpression(decl.initializer)
      ) {
        routesArray = decl.initializer;
      }
    }
  });
  if (!routesArray) throw new Error('Could not find exported `routes` array');

  const lines = [];
  function walk(arrayNode, depth) {
    for (const elem of arrayNode.elements) {
      if (!ts.isObjectLiteralExpression(elem)) continue;
      let path = '';
      let comp = '';
      let redirectTo = '';
      let children = null;
      let pathMatch = '';
      const guards = [];

      for (const prop of elem.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const k =
          ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
            ? prop.name.text
            : '';
        if (k === 'path' && ts.isStringLiteral(prop.initializer)) {
          path = prop.initializer.text;
        } else if (k === 'redirectTo' && ts.isStringLiteral(prop.initializer)) {
          redirectTo = prop.initializer.text;
        } else if (k === 'pathMatch' && ts.isStringLiteral(prop.initializer)) {
          pathMatch = prop.initializer.text;
        } else if (
          k === 'children' &&
          ts.isArrayLiteralExpression(prop.initializer)
        ) {
          children = prop.initializer;
        } else if (k === 'loadComponent') {
          const txt = prop.initializer.getText();
          const m = txt.match(/m\.(\w+)/);
          if (m) comp = m[1];
        } else if (
          k === 'canActivate' &&
          ts.isArrayLiteralExpression(prop.initializer)
        ) {
          for (const el of prop.initializer.elements) {
            if (ts.isIdentifier(el)) guards.push(el.text);
          }
        }
      }

      const indent = '  '.repeat(depth);
      const seg = path === '' ? '(empty)' : `/${path}`;
      let line = `${indent}${seg}`;
      const tags = [];
      if (guards.length) tags.push(guards.join(' + '));
      if (comp) tags.push(comp);
      // redirectTo can be the empty string (redirect to the parent's empty path),
      // which is a valid Angular pattern — render it as `/` for clarity.
      const hasRedirect = redirectTo !== '' || elem.properties.some(
        (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'redirectTo'
      );
      if (hasRedirect) tags.push(`-> ${redirectTo === '' ? '/' : redirectTo}`);
      if (pathMatch === 'full' && !hasRedirect) tags.push('exact');
      if (tags.length) line += `   ${tags.join(' | ')}`;
      lines.push(line);

      if (children) walk(children, depth + 1);
    }
  }
  walk(routesArray, 0);

  return ['```', ...lines, '```'].join('\n');
}

// ---------- 07-database-schema.md :: ER ----------

async function genERDiagram(client) {
  const tablesQ = await client.query(`
    select table_name
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);

  const fkQ = await client.query(`
    select
      tc.table_name      as src_table,
      kcu.column_name    as src_column,
      ccu.table_name     as dst_table
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name
     and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name
     and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
    order by tc.table_name, kcu.column_name
  `);

  const lines = ['```mermaid', 'erDiagram'];
  for (const fk of fkQ.rows) {
    lines.push(
      `  ${fk.dst_table.toUpperCase()} ||--o{ ${fk.src_table.toUpperCase()} : "${fk.src_column}"`
    );
  }
  // Empty boxes for tables that aren't in any FK relationship.
  const inGraph = new Set();
  for (const fk of fkQ.rows) {
    inGraph.add(fk.src_table);
    inGraph.add(fk.dst_table);
  }
  for (const t of tablesQ.rows) {
    if (!inGraph.has(t.table_name)) {
      lines.push(`  ${t.table_name.toUpperCase()} { }`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}

// ---------- 06-backend-architecture.md :: RPC_TABLE_MATRIX ----------

async function genRPCMatrix(client) {
  const procsQ = await client.query(`
    select p.proname as name, p.prosrc as body
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public'
      and p.prokind = 'f'
      -- Exclude functions installed by extensions (pg_trgm, pgcrypto, etc.).
      -- pg_depend.deptype='e' marks an extension-owned object.
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
    order by p.proname
  `);
  const tablesQ = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  `);
  const tables = tablesQ.rows.map((r) => r.table_name);

  const lines = ['| RPC | Writes | Reads |', '|---|---|---|'];
  for (const p of procsQ.rows) {
    // Strip line comments so commented-out references don't pollute the matrix.
    const body = (p.body || '').replace(/--[^\n]*\n/g, '\n');
    const writes = new Set();
    const reads = new Set();
    for (const t of tables) {
      const tEsc = t.replace(/[$.]/g, '\\$&');
      const writeRe = new RegExp(
        `(?:insert\\s+into|update|delete\\s+from)\\s+(?:public\\.)?${tEsc}\\b`,
        'i'
      );
      const readRe = new RegExp(`\\b(?:public\\.)?${tEsc}\\b`, 'i');
      if (writeRe.test(body)) writes.add(t);
      else if (readRe.test(body)) reads.add(t);
    }
    if (writes.size === 0 && reads.size === 0) continue;
    const w = [...writes].sort().join(', ') || '-';
    const r = [...reads].sort().join(', ') || '-';
    lines.push(`| \`${p.name}\` | ${w} | ${r} |`);
  }
  return lines.join('\n');
}

// ---------- shared drift helpers ----------

async function readRunbookFile(name) {
  // Strip everything inside AUTO-GEN regions before drift search. Otherwise
  // the drift block lists missing items, those items get written into the
  // block, the next regen sees them as "documented", produces an empty drift
  // block, the run after that re-flags them — an oscillation loop.
  const text = await readFile(resolve(RUNBOOK, name), 'utf8');
  return text.replace(
    /<!--\s*AUTO-GEN:[^>]+-->[\s\S]*?<!--\s*\/AUTO-GEN:[^>]+-->/g,
    ''
  );
}

function asciiCamelToWordRegex(name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
}

function missingFromText(text, items) {
  return items.filter((item) => !asciiCamelToWordRegex(item).test(text));
}

function pascalFromKebab(base) {
  return base
    .split(/[-.]/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join('');
}

function camelFromKebab(base) {
  const pascal = pascalFromKebab(base);
  return pascal[0].toLowerCase() + pascal.slice(1);
}

function bulletList(items, emptyLabel = 'No drift detected.') {
  if (items.length === 0) return `_${emptyLabel}_`;
  return items.map((i) => `- \`${i}\``).join('\n');
}

// ---------- 02 :: DRIFT (deps not surfaced or rationaled) ----------

async function genDepsDrift() {
  const pkg = JSON.parse(await readFile(PKG_JSON, 'utf8'));
  const all = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  // Skip Angular sub-packages and toolchain noise — only the deps a reader
  // would expect a sentence about.
  const ignore = (name) =>
    name.startsWith('@angular/') && !['@angular/core', '@angular/cdk'].includes(name);
  const text = await readRunbookFile('02-tech-stack.md');
  const deps = Object.keys(all).filter((d) => !ignore(d));
  const missing = missingFromText(text, deps);
  return bulletList(
    missing,
    'Every dependency is mentioned somewhere in this file.'
  );
}

// ---------- 03 :: DRIFT (route paths not mentioned in features) ----------

async function genFeatureRouteDrift() {
  const src = readFileSync(ROUTES_TS, 'utf8');
  const sf = ts.createSourceFile('app.routes.ts', src, ts.ScriptTarget.Latest, true);
  const paths = new Set();
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'path' &&
      ts.isStringLiteral(node.initializer)
    ) {
      const p = node.initializer.text;
      if (p && p !== '**' && !p.startsWith('landscape')) paths.add(p);
    }
    node.forEachChild(visit);
  }
  sf.forEachChild(visit);
  const text = await readRunbookFile('03-features.md');
  const missing = [...paths].sort().filter((p) => !text.includes(p));
  return bulletList(missing, 'Every route path appears in the features doc.');
}

// ---------- 05 :: DRIFT (services / models / svg-icons not in doc) ----------

async function genFrontendDrift() {
  const text = await readRunbookFile('05-frontend-architecture.md');
  const APP = resolve(REPO_ROOT, 'src/client/src/app');

  const serviceFiles = (await readdir(resolve(APP, 'core/services')))
    .filter((f) => f.endsWith('.service.ts'))
    .map((f) => pascalFromKebab(f.replace(/\.service\.ts$/, '')) + 'Service');
  const modelFiles = (await readdir(resolve(APP, 'core/models')))
    .filter((f) => f.endsWith('.model.ts'))
    .map((f) => pascalFromKebab(f.replace(/\.model\.ts$/, '')));
  const iconFiles = (await readdir(resolve(APP, 'shared/components/svg-icons')))
    .filter((f) => f.endsWith('.component.ts'))
    .map((f) => pascalFromKebab(f.replace(/\.component\.ts$/, '')) + 'Component');

  const sections = [];
  const missingServices = missingFromText(text, serviceFiles);
  const missingModels = missingFromText(text, modelFiles);
  const missingIcons = missingFromText(text, iconFiles);
  sections.push('**Services:**');
  sections.push(bulletList(missingServices, 'All services documented.'));
  sections.push('');
  sections.push('**Models:**');
  sections.push(bulletList(missingModels, 'All models documented.'));
  sections.push('');
  sections.push('**SVG icon components:**');
  sections.push(bulletList(missingIcons, 'All svg-icon components documented.'));
  return sections.join('\n');
}

// ---------- 06 :: DRIFT (RPCs / edge functions not in doc) ----------

async function genBackendDrift(client) {
  const text = await readRunbookFile('06-backend-architecture.md');
  const procs = await client.query(`
    select p.proname as name
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public'
      and p.prokind = 'f'
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
    order by p.proname
  `);
  const rpcNames = procs.rows
    .map((r) => r.name)
    // Skip obvious helpers / triggers — their drift is tracked in 09.
    .filter(
      (n) =>
        !n.startsWith('_seed_demo') &&
        !n.startsWith('enforce_') &&
        !n.startsWith('handle_new_user') &&
        !n.startsWith('retire_hostname_on_change')
    );
  const missingRpcs = missingFromText(text, rpcNames);

  const fnDir = resolve(REPO_ROOT, 'supabase/functions');
  const edgeFns = (await readdir(fnDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => d.name);
  const missingEdge = missingFromText(text, edgeFns);

  return [
    '**RPCs in `pg_proc` not documented:**',
    bulletList(missingRpcs, 'All public RPCs documented.'),
    '',
    '**Edge functions in `supabase/functions/` not documented:**',
    bulletList(missingEdge, 'All edge functions documented.'),
  ].join('\n');
}

// ---------- 07 :: DRIFT (tables / migrations not in history) ----------

async function genSchemaDrift(client) {
  const text = await readRunbookFile('07-database-schema.md');
  const tablesQ = await client.query(`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name
  `);
  const tables = tablesQ.rows.map((r) => r.table_name);
  const missingTables = tables.filter((t) => !text.includes(t));

  const migDir = resolve(REPO_ROOT, 'supabase/migrations');
  const migFiles = (await readdir(migDir)).filter((f) => f.endsWith('.sql'));
  const missingMigs = migFiles.filter((f) => !text.includes(f));

  return [
    '**Tables in `public` schema not mentioned:**',
    bulletList(missingTables, 'All tables mentioned.'),
    '',
    '**Migration files not in history table:**',
    bulletList(missingMigs, 'All migration files in history.'),
  ].join('\n');
}

// ---------- 08 :: RLS_COVERAGE + DRIFT (guards) ----------

async function genRLSCoverage(client) {
  const tablesQ = await client.query(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled,
      coalesce(count(p.polname), 0) as policy_count
    from pg_class c
    join pg_namespace n on c.relnamespace = n.oid
    left join pg_policy p on p.polrelid = c.oid
    where n.nspname = 'public' and c.relkind = 'r'
    group by c.relname, c.relrowsecurity
    order by c.relname
  `);
  const lines = ['| Table | RLS enabled | Policies |', '|---|---|---|'];
  for (const r of tablesQ.rows) {
    const rls = r.rls_enabled ? 'yes' : '**no**';
    lines.push(`| \`${r.table_name}\` | ${rls} | ${r.policy_count} |`);
  }
  return lines.join('\n');
}

async function genGuardDrift() {
  const text = await readRunbookFile('08-authentication-security.md');
  const dir = resolve(REPO_ROOT, 'src/client/src/app/core/guards');
  const guards = (await readdir(dir))
    .filter((f) => f.endsWith('.guard.ts'))
    .map((f) => camelFromKebab(f.replace(/\.guard\.ts$/, '')) + 'Guard');
  const missing = missingFromText(text, guards);
  return bulletList(missing, 'All route guards documented.');
}

// ---------- 09 :: DRIFT (helpers not documented) ----------

async function genHelperDrift(client) {
  const text = await readRunbookFile('09-multi-tenant-model.md');
  const procs = await client.query(`
    select p.proname as name
    from pg_proc p
    join pg_namespace n on p.pronamespace = n.oid
    where n.nspname = 'public' and p.prokind = 'f'
      and (p.proname like 'is\\_%' or p.proname like 'has\\_%' or p.proname like 'enforce\\_%')
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
    order by p.proname
  `);
  const helpers = procs.rows.map((r) => r.name);
  const missing = missingFromText(text, helpers);
  return bulletList(missing, 'All multi-tenant helpers documented.');
}

// ---------- main ----------

async function main() {
  const client = new pg.Client({ connectionString: DB_URL });
  try {
    await client.connect();
  } catch (err) {
    console.error(
      `Failed to connect to ${DB_URL}.\n` +
        `Is local Supabase running? Try: supabase start\n` +
        `${err.message}`
    );
    process.exit(1);
  }

  console.log('Regenerating runbook auto-gen blocks…');
  // Phase 1: replacement-grade blocks
  await injectBlock('02-tech-stack.md', 'VERSIONS', await genVersions());
  await injectBlock('05-frontend-architecture.md', 'ROUTES', genRoutes());
  await injectBlock(
    '06-backend-architecture.md',
    'RPC_TABLE_MATRIX',
    await genRPCMatrix(client)
  );
  await injectBlock('07-database-schema.md', 'ER', await genERDiagram(client));

  // Phase 2: drift detection + RLS coverage
  await injectBlock('02-tech-stack.md', 'DRIFT', await genDepsDrift());
  await injectBlock('03-features.md', 'DRIFT', await genFeatureRouteDrift());
  await injectBlock('05-frontend-architecture.md', 'DRIFT', await genFrontendDrift());
  await injectBlock(
    '06-backend-architecture.md',
    'DRIFT',
    await genBackendDrift(client)
  );
  await injectBlock('07-database-schema.md', 'DRIFT', await genSchemaDrift(client));
  await injectBlock(
    '08-authentication-security.md',
    'RLS_COVERAGE',
    await genRLSCoverage(client)
  );
  await injectBlock('08-authentication-security.md', 'DRIFT', await genGuardDrift());
  await injectBlock('09-multi-tenant-model.md', 'DRIFT', await genHelperDrift(client));

  await client.end();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
