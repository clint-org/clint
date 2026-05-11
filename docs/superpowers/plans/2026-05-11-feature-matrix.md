# Feature Matrix and Empty-State Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a developer-facing capability matrix stored as per-surface markdown files (each with a structured YAML block), an enforcement CLI (`features-drift.mjs`) integrated with stop hook + CI, and add an empty-state audit policy to `src/client/CLAUDE.md`.

**Architecture:** Per-surface markdown files under `docs/runbook/features/<slug>.md` carry narrative prose plus a fenced ```yaml``` block listing capabilities. A standalone Node script `features-drift.mjs` parses all surface files and compares against live sources (`app.routes.ts`, Postgres `pg_proc` / `pg_class`) for drift. The CLI exposes subcommands `check`, `stub`, `near`, and `surfaces-index`. The script logic is split into small importable modules (parse, extract, drift, render) so each is unit-testable with the Node built-in test runner. Bootstrap content is migrated from existing `03-features.md` prose into per-surface files, with the drift CLI driving completeness.

**Tech Stack:** Node 20, ESM modules (`*.mjs`), `gray-matter` (frontmatter), `pg` (already a dep), `typescript` compiler API (already used in `gen-architecture.mjs`), `node:test` + `node:assert` for unit tests.

**Spec reference:** `docs/superpowers/specs/2026-05-11-feature-matrix-design.md`

**Note on validation:** Verification commands run from `src/client/` unless otherwise noted. The drift CLI queries local Supabase, so `supabase start` must be running before `features:check` against live RPC/table lists. Tests for parser/extractor/drift logic use fixtures, so they do not require Supabase to be running.

---

## Task 1: Add dependencies and npm scripts

**Files:**
- Modify: `src/client/package.json`
- Modify: `src/client/package-lock.json` (via `npm install`)

- [ ] **Step 1: Add `gray-matter` devDependency and four npm scripts**

Edit `src/client/package.json`. In the `scripts` block, after the `docs:arch` line, add:

```json
    "docs:arch": "node scripts/gen-architecture.mjs",
    "features:check": "node scripts/features-drift.mjs check",
    "features:stub": "node scripts/features-drift.mjs stub",
    "features:near": "node scripts/features-drift.mjs near",
    "features:surfaces-index": "node scripts/features-drift.mjs surfaces-index",
    "test:scripts": "node --test scripts/features/__tests__/*.test.mjs"
```

In `devDependencies` (alphabetical with other `g*` deps), add:

```json
    "gray-matter": "^4.0.3",
```

- [ ] **Step 2: Install**

Run from `src/client/`:
```bash
npm install
```
Expected: lockfile updates; no peer warnings beyond existing baseline.

- [ ] **Step 3: Verify script wiring**

Run:
```bash
npm run features:check 2>&1 | head -5
```
Expected: error (script file does not exist yet). Wiring is correct; we will create the file in later tasks.

- [ ] **Step 4: Commit**

```bash
git add src/client/package.json src/client/package-lock.json
git commit -m "chore(features-matrix): add gray-matter dep and features:* scripts"
```

---

## Task 2: Surface parser module

**Files:**
- Create: `src/client/scripts/features/parse-surface.mjs`
- Create: `src/client/scripts/features/__tests__/fixtures/timeline-dashboard.md`
- Create: `src/client/scripts/features/__tests__/fixtures/empty-capabilities.md`
- Create: `src/client/scripts/features/__tests__/fixtures/missing-block.md`
- Create: `src/client/scripts/features/__tests__/parse-surface.test.mjs`

This module parses a single surface file and returns `{ filePath, surfaceName, frontmatter, narrative, capabilities }`. The capabilities array is the parsed YAML block under `## Capabilities`.

- [ ] **Step 1: Write the fixture files (used by tests in step 2)**

Create `src/client/scripts/features/__tests__/fixtures/timeline-dashboard.md`:

````markdown
---
surface: Timeline Dashboard
spec: docs/superpowers/specs/2026-04-12-unified-landscape-design.md
---

# Timeline Dashboard

The primary view of an engagement.

## Capabilities

```yaml
- id: timeline-grid
  summary: Hierarchical company to product to trial.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - trials
  related: []
  user_facing: true
  role: viewer
  status: active

- id: timeline-zoom
  summary: Four zoom levels.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables: []
  related:
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
```
````

Create `src/client/scripts/features/__tests__/fixtures/empty-capabilities.md`:

````markdown
---
surface: Empty Surface
---

# Empty Surface

Prose only.

## Capabilities

```yaml
[]
```
````

Create `src/client/scripts/features/__tests__/fixtures/missing-block.md`:

```markdown
---
surface: Missing Block
---

# Missing Block

Prose only. No capabilities section at all.
```

- [ ] **Step 2: Write the failing test**

Create `src/client/scripts/features/__tests__/parse-surface.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseSurface } from '../parse-surface.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => resolve(__dirname, 'fixtures', name);

test('parses surface frontmatter, name, and capabilities', async () => {
  const result = await parseSurface(fixture('timeline-dashboard.md'));
  assert.equal(result.surfaceName, 'Timeline Dashboard');
  assert.equal(
    result.frontmatter.spec,
    'docs/superpowers/specs/2026-04-12-unified-landscape-design.md',
  );
  assert.equal(result.capabilities.length, 2);
  assert.equal(result.capabilities[0].id, 'timeline-grid');
  assert.deepEqual(result.capabilities[0].routes, ['/t/:tenantId/s/:spaceId/timeline']);
  assert.deepEqual(result.capabilities[1].related, ['timeline-grid']);
});

test('returns empty capabilities array for empty yaml block', async () => {
  const result = await parseSurface(fixture('empty-capabilities.md'));
  assert.equal(result.surfaceName, 'Empty Surface');
  assert.deepEqual(result.capabilities, []);
});

test('throws when ## Capabilities block is missing', async () => {
  await assert.rejects(() => parseSurface(fixture('missing-block.md')), {
    message: /missing.*Capabilities/i,
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run from `src/client/`:
```bash
node --test scripts/features/__tests__/parse-surface.test.mjs
```
Expected: FAIL (cannot find module `../parse-surface.mjs`).

- [ ] **Step 4: Write the implementation**

Create `src/client/scripts/features/parse-surface.mjs`:

```js
// Parse a single surface markdown file:
//   - YAML frontmatter (via gray-matter)
//   - Surface name (first # heading or frontmatter.surface)
//   - A fenced ```yaml block immediately under a `## Capabilities` heading
//
// Returns: { filePath, surfaceName, frontmatter, narrative, capabilities }

import { readFile } from 'node:fs/promises';
import matter from 'gray-matter';
import { parse as parseYaml } from './yaml-mini.mjs';

const CAPABILITIES_BLOCK_RE =
  /^##\s+Capabilities\s*\n+```yaml\s*\n([\s\S]*?)\n```/m;

export async function parseSurface(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const { data: frontmatter, content } = matter(raw);

  const h1Match = content.match(/^#\s+(.+)$/m);
  const surfaceName = (frontmatter.surface ?? h1Match?.[1] ?? '').trim();
  if (!surfaceName) {
    throw new Error(`${filePath}: surface name missing (no frontmatter.surface and no H1)`);
  }

  const blockMatch = content.match(CAPABILITIES_BLOCK_RE);
  if (!blockMatch) {
    throw new Error(`${filePath}: missing \`## Capabilities\` fenced yaml block`);
  }

  const yamlText = blockMatch[1].trim();
  const capabilities = yamlText === '' || yamlText === '[]' ? [] : parseYaml(yamlText);

  if (!Array.isArray(capabilities)) {
    throw new Error(`${filePath}: capabilities block must be a YAML array`);
  }

  const narrative = content.slice(0, blockMatch.index ?? content.length).trim();

  return { filePath, surfaceName, frontmatter, narrative, capabilities };
}
```

The `yaml-mini.mjs` helper is the YAML parser we use across the feature modules. Create it now so this file compiles:

Create `src/client/scripts/features/yaml-mini.mjs`:

```js
// Tiny YAML parser wrapper. gray-matter pulls js-yaml in transitively,
// so we reuse it rather than adding another dep.
import yaml from 'js-yaml';

export function parse(text) {
  return yaml.load(text);
}
```

- [ ] **Step 5: Run test to verify pass**

Run from `src/client/`:
```bash
node --test scripts/features/__tests__/parse-surface.test.mjs
```
Expected: PASS — 3/3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/scripts/features/parse-surface.mjs \
        src/client/scripts/features/yaml-mini.mjs \
        src/client/scripts/features/__tests__/
git commit -m "feat(features-matrix): add parse-surface module for per-surface md files"
```

---

## Task 3: Walk all surfaces, detect duplicates

**Files:**
- Create: `src/client/scripts/features/parse-all.mjs`
- Create: `src/client/scripts/features/__tests__/fixtures/dup-ids-a.md`
- Create: `src/client/scripts/features/__tests__/fixtures/dup-ids-b.md`
- Create: `src/client/scripts/features/__tests__/parse-all.test.mjs`

This module walks `docs/runbook/features/*.md`, parses each, and produces a normalized collection with duplicate-id and missing-required-field errors.

- [ ] **Step 1: Add duplicate-id fixtures**

Create `src/client/scripts/features/__tests__/fixtures/dup-ids-a.md`:

````markdown
---
surface: Dup A
---

# Dup A

## Capabilities

```yaml
- id: shared-id
  summary: First.
  routes: []
  rpcs: []
  tables: []
  related: []
  user_facing: true
  role: viewer
  status: active
```
````

Create `src/client/scripts/features/__tests__/fixtures/dup-ids-b.md`:

````markdown
---
surface: Dup B
---

# Dup B

## Capabilities

```yaml
- id: shared-id
  summary: Second.
  routes: []
  rpcs: []
  tables: []
  related: []
  user_facing: true
  role: viewer
  status: active
```
````

- [ ] **Step 2: Write the failing test**

Create `src/client/scripts/features/__tests__/parse-all.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseAll } from '../parse-all.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = resolve(__dirname, 'fixtures');

test('walks all surface files and collects capabilities', async () => {
  const result = await parseAll(fixtureDir, ['timeline-dashboard.md']);
  assert.equal(result.surfaces.length, 1);
  assert.equal(result.capabilities.length, 2);
  assert.equal(result.errors.length, 0);
});

test('reports duplicate-id errors across files', async () => {
  const result = await parseAll(fixtureDir, ['dup-ids-a.md', 'dup-ids-b.md']);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /duplicate id.*shared-id/i);
});

test('reports missing required fields', async () => {
  const result = await parseAll(fixtureDir, ['empty-capabilities.md']);
  // No capabilities means no field errors; just zero rows.
  assert.equal(result.capabilities.length, 0);
  assert.equal(result.errors.length, 0);
});
```

- [ ] **Step 3: Run test to verify failure**

Run:
```bash
node --test scripts/features/__tests__/parse-all.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement parse-all**

Create `src/client/scripts/features/parse-all.mjs`:

```js
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSurface } from './parse-surface.mjs';

const REQUIRED_FIELDS = [
  'id',
  'summary',
  'routes',
  'rpcs',
  'tables',
  'related',
  'user_facing',
  'role',
  'status',
];

const VALID_ROLES = new Set(['viewer', 'editor', 'owner', 'agency', 'super-admin']);
const VALID_STATUSES = new Set(['active', 'experimental', 'deprecated']);

export async function parseAll(featuresDir, fileWhitelist = null) {
  const all = await readdir(featuresDir);
  const files = (fileWhitelist ?? all.filter((f) => f.endsWith('.md'))).sort();

  const surfaces = [];
  const capabilities = [];
  const errors = [];
  const idSeen = new Map();

  for (const file of files) {
    const filePath = resolve(featuresDir, file);
    let parsed;
    try {
      parsed = await parseSurface(filePath);
    } catch (err) {
      errors.push({ file, message: err.message });
      continue;
    }

    surfaces.push({
      file,
      filePath,
      name: parsed.surfaceName,
      frontmatter: parsed.frontmatter,
    });

    for (const cap of parsed.capabilities) {
      for (const field of REQUIRED_FIELDS) {
        if (!(field in cap)) {
          errors.push({
            file,
            id: cap.id ?? '(unknown)',
            message: `capability missing required field: ${field}`,
          });
        }
      }
      if (cap.role && !VALID_ROLES.has(cap.role)) {
        errors.push({
          file,
          id: cap.id,
          message: `invalid role: ${cap.role} (allowed: ${[...VALID_ROLES].join(', ')})`,
        });
      }
      if (cap.status && !VALID_STATUSES.has(cap.status)) {
        errors.push({
          file,
          id: cap.id,
          message: `invalid status: ${cap.status} (allowed: ${[...VALID_STATUSES].join(', ')})`,
        });
      }
      if (cap.id) {
        if (idSeen.has(cap.id)) {
          errors.push({
            file,
            id: cap.id,
            message: `duplicate id ${cap.id} (also defined in ${idSeen.get(cap.id)})`,
          });
        } else {
          idSeen.set(cap.id, file);
        }
      }
      capabilities.push({ ...cap, surface: parsed.surfaceName, sourceFile: file });
    }
  }

  return { surfaces, capabilities, errors };
}
```

- [ ] **Step 5: Verify pass**

```bash
node --test scripts/features/__tests__/parse-all.test.mjs
```
Expected: PASS — 3/3.

- [ ] **Step 6: Commit**

```bash
git add src/client/scripts/features/parse-all.mjs \
        src/client/scripts/features/__tests__/parse-all.test.mjs \
        src/client/scripts/features/__tests__/fixtures/dup-ids-a.md \
        src/client/scripts/features/__tests__/fixtures/dup-ids-b.md
git commit -m "feat(features-matrix): add parse-all with duplicate-id and field validation"
```

---

## Task 4: Route extractor

**Files:**
- Create: `src/client/scripts/features/extract-routes.mjs`
- Create: `src/client/scripts/features/__tests__/extract-routes.test.mjs`
- Create: `src/client/scripts/features/__tests__/fixtures/sample-routes.ts`

Extract route path strings from a TypeScript routes file using the TypeScript compiler API (same library `gen-architecture.mjs` already uses). Returns a deduplicated array of route patterns reconstructed from nested `children`.

- [ ] **Step 1: Add fixture**

Create `src/client/scripts/features/__tests__/fixtures/sample-routes.ts`:

```ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'login', loadComponent: () => null as never },
  {
    path: 't/:tenantId',
    children: [
      {
        path: 's/:spaceId',
        children: [
          { path: '', pathMatch: 'full', loadComponent: () => null as never },
          { path: 'timeline', loadComponent: () => null as never },
          { path: 'manage/trials', loadComponent: () => null as never },
          { path: 'old-route', redirectTo: 'timeline' },
        ],
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
```

- [ ] **Step 2: Write failing test**

Create `src/client/scripts/features/__tests__/extract-routes.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { extractRoutes } from '../extract-routes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(__dirname, 'fixtures', 'sample-routes.ts');

test('extracts nested route paths with parent prefixes', async () => {
  const routes = await extractRoutes(fixture);
  // Concrete paths only; wildcards and pure redirects excluded.
  assert.ok(routes.includes('login'));
  assert.ok(routes.includes('t/:tenantId/s/:spaceId'));
  assert.ok(routes.includes('t/:tenantId/s/:spaceId/timeline'));
  assert.ok(routes.includes('t/:tenantId/s/:spaceId/manage/trials'));
});

test('omits the catch-all wildcard route', async () => {
  const routes = await extractRoutes(fixture);
  assert.ok(!routes.includes('**'));
});

test('returns redirect entries alongside loaded routes', async () => {
  // The extractor does not distinguish redirects from loadComponent routes.
  // Drift downgrades severity per skip-flag in the source file, not here.
  const routes = await extractRoutes(fixture);
  assert.ok(routes.includes('t/:tenantId/s/:spaceId/old-route'));
});
```

- [ ] **Step 3: Run test to verify failure**

```bash
node --test scripts/features/__tests__/extract-routes.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 4: Implement extract-routes**

Create `src/client/scripts/features/extract-routes.mjs`:

```js
// Walk a routes.ts file and return all concrete route patterns,
// joining nested children with their parent path. Wildcards ('**')
// and the empty-path siblings are excluded; redirects are included
// because they are still mappable capabilities.

import { readFile } from 'node:fs/promises';
import ts from 'typescript';

export async function extractRoutes(filePath) {
  const src = await readFile(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, src, ts.ScriptTarget.Latest, true);

  const routesArray = findRoutesArray(sourceFile);
  if (!routesArray) {
    throw new Error(`${filePath}: could not find an exported Routes array`);
  }

  const collected = new Set();
  walk(routesArray, '', collected);
  return [...collected].sort();
}

function findRoutesArray(node) {
  let result = null;
  ts.forEachChild(node, (child) => {
    if (result) return;
    if (
      ts.isVariableStatement(child) &&
      child.declarationList.declarations.some(
        (d) =>
          ts.isVariableDeclaration(d) &&
          d.initializer &&
          ts.isArrayLiteralExpression(d.initializer),
      )
    ) {
      const decl = child.declarationList.declarations.find(
        (d) => d.initializer && ts.isArrayLiteralExpression(d.initializer),
      );
      result = decl.initializer;
    }
  });
  return result;
}

function walk(arrayLit, parentPath, out) {
  for (const el of arrayLit.elements) {
    if (!ts.isObjectLiteralExpression(el)) continue;
    let path = null;
    let children = null;
    for (const prop of el.properties) {
      if (!ts.isPropertyAssignment(prop)) continue;
      const key = prop.name && (prop.name.text ?? prop.name.escapedText);
      if (key === 'path' && ts.isStringLiteral(prop.initializer)) {
        path = prop.initializer.text;
      } else if (key === 'children' && ts.isArrayLiteralExpression(prop.initializer)) {
        children = prop.initializer;
      }
    }
    if (path === null) continue;
    const joined = path === '' ? parentPath : parentPath ? `${parentPath}/${path}` : path;
    if (path !== '**' && joined) {
      out.add(joined);
    }
    if (children) {
      walk(children, joined, out);
    }
  }
}
```

- [ ] **Step 5: Verify pass**

```bash
node --test scripts/features/__tests__/extract-routes.test.mjs
```
Expected: PASS — 3/3.

- [ ] **Step 6: Commit**

```bash
git add src/client/scripts/features/extract-routes.mjs \
        src/client/scripts/features/__tests__/extract-routes.test.mjs \
        src/client/scripts/features/__tests__/fixtures/sample-routes.ts
git commit -m "feat(features-matrix): add extract-routes via typescript AST walk"
```

---

## Task 5: Live RPC and table extractor (Postgres)

**Files:**
- Create: `src/client/scripts/features/extract-db.mjs`
- Create: `src/client/scripts/features/__tests__/extract-db.test.mjs`

Queries local Supabase for the list of RPCs (`pg_proc` in the `public` schema) and tables (`pg_class` where `relkind = 'r'` and `relnamespace = public`). Returns sets of names. Tests are integration-style and require `supabase start` to be running; they skip cleanly when no DB is reachable.

- [ ] **Step 1: Write test**

Create `src/client/scripts/features/__tests__/extract-db.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { extractRpcs, extractTables } from '../extract-db.mjs';

const DB_URL =
  process.env.SUPABASE_DB_URL ||
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function isDbReachable() {
  const client = new pg.Client({ connectionString: DB_URL });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

test('returns the live list of public RPCs', { skip: !(await isDbReachable()) }, async () => {
  const rpcs = await extractRpcs(DB_URL);
  assert.ok(rpcs instanceof Set);
  assert.ok(rpcs.size > 0, 'expected at least one public RPC');
  // Spot-check: get_brand_by_host is a foundational RPC that ships with this app.
  assert.ok(rpcs.has('get_brand_by_host'), 'expected get_brand_by_host in pg_proc');
});

test('returns the live list of public tables', { skip: !(await isDbReachable()) }, async () => {
  const tables = await extractTables(DB_URL);
  assert.ok(tables instanceof Set);
  assert.ok(tables.has('tenants'), 'expected tenants table');
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --test scripts/features/__tests__/extract-db.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement extract-db**

Create `src/client/scripts/features/extract-db.mjs`:

```js
// Live extractors for public-schema RPCs and tables.
// Used by the drift CLI to compare against capabilities.yaml mappings.

import pg from 'pg';

async function withClient(connectionString, fn) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function extractRpcs(connectionString) {
  return withClient(connectionString, async (client) => {
    const { rows } = await client.query(`
      select p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
      order by p.proname
    `);
    return new Set(rows.map((r) => r.proname));
  });
}

export async function extractTables(connectionString) {
  return withClient(connectionString, async (client) => {
    const { rows } = await client.query(`
      select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `);
    return new Set(rows.map((r) => r.relname));
  });
}
```

- [ ] **Step 4: Verify pass with Supabase running**

If local Supabase is not running, start it from the repo root first:
```bash
supabase start
```

Then from `src/client/`:
```bash
node --test scripts/features/__tests__/extract-db.test.mjs
```
Expected: PASS — 2/2 (tests auto-skip if Supabase is unreachable).

- [ ] **Step 5: Commit**

```bash
git add src/client/scripts/features/extract-db.mjs \
        src/client/scripts/features/__tests__/extract-db.test.mjs
git commit -m "feat(features-matrix): add live RPC/table extractors via pg_proc"
```

---

## Task 6: Drift check module

**Files:**
- Create: `src/client/scripts/features/drift.mjs`
- Create: `src/client/scripts/features/__tests__/drift.test.mjs`

The core comparison engine. Takes the parsed capabilities collection and the live sources (routes, rpcs, tables), returns a categorized report:

```
{
  errors: [{ kind, message, file?, id? }],
  warnings: [{ kind, message, file?, id? }],
  skipped: [{ kind, target, reason }],
}
```

The CLI exits non-zero when `errors.length > 0`.

- [ ] **Step 1: Write failing test**

Create `src/client/scripts/features/__tests__/drift.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --test scripts/features/__tests__/drift.test.mjs
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement drift**

Create `src/client/scripts/features/drift.mjs`:

```js
// Compare parsed capabilities against live sources.
// Returns { errors, warnings, skipped }.

export function checkDrift(collection, live, opts = {}) {
  const skipTags = opts.skipTags || { routes: {}, rpcs: {}, tables: {} };

  const errors = [];
  const warnings = [];
  const skipped = [];

  // Lift parse-time errors first.
  for (const e of collection.errors) {
    errors.push({ kind: 'parse-error', message: e.message, file: e.file, id: e.id });
  }

  const allIds = new Set(collection.capabilities.map((c) => c.id));
  const mappedRoutes = new Set();
  const mappedRpcs = new Set();
  const mappedTables = new Set();

  // Per-capability checks.
  for (const cap of collection.capabilities) {
    if (/^TODO/i.test(cap.id)) {
      errors.push({
        kind: 'todo-id',
        id: cap.id,
        file: cap.sourceFile,
        message: `capability has TODO id; rename before merging`,
      });
    }

    for (const r of cap.routes || []) {
      mappedRoutes.add(r);
      if (!live.routes.has(stripLeadingSlash(r))) {
        errors.push({
          kind: 'route-not-in-code',
          id: cap.id,
          file: cap.sourceFile,
          message: `capability ${cap.id}: route ${r} does not exist in app.routes.ts`,
        });
      }
    }
    for (const rpc of cap.rpcs || []) {
      mappedRpcs.add(rpc);
      if (!live.rpcs.has(rpc)) {
        errors.push({
          kind: 'rpc-not-in-db',
          id: cap.id,
          file: cap.sourceFile,
          message: `capability ${cap.id}: rpc ${rpc} does not exist in pg_proc`,
        });
      }
    }
    for (const t of cap.tables || []) {
      mappedTables.add(t);
      if (!live.tables.has(t)) {
        errors.push({
          kind: 'table-not-in-db',
          id: cap.id,
          file: cap.sourceFile,
          message: `capability ${cap.id}: table ${t} does not exist in pg_class`,
        });
      }
    }
    for (const ref of cap.related || []) {
      if (!allIds.has(ref)) {
        errors.push({
          kind: 'related-broken',
          id: cap.id,
          file: cap.sourceFile,
          message: `capability ${cap.id}: related id ${ref} does not exist`,
        });
      }
    }
  }

  // Reverse checks: live source has something not mapped by any capability.
  for (const r of live.routes) {
    if (skipTags.routes[r]) {
      skipped.push({ kind: 'route', target: r, reason: skipTags.routes[r] });
      continue;
    }
    if (!mappedRoutes.has('/' + r) && !mappedRoutes.has(r)) {
      warnings.push({
        kind: 'route-unmapped',
        message: `route /${r} exists in code but no capability maps it`,
      });
    }
  }
  for (const rpc of live.rpcs) {
    if (skipTags.rpcs[rpc]) {
      skipped.push({ kind: 'rpc', target: rpc, reason: skipTags.rpcs[rpc] });
      continue;
    }
    if (!mappedRpcs.has(rpc)) {
      errors.push({
        kind: 'rpc-unmapped',
        message: `rpc ${rpc} exists in pg_proc but no capability maps it`,
      });
    }
  }
  for (const t of live.tables) {
    if (skipTags.tables[t]) {
      skipped.push({ kind: 'table', target: t, reason: skipTags.tables[t] });
      continue;
    }
    if (!mappedTables.has(t)) {
      warnings.push({
        kind: 'table-unmapped',
        message: `table ${t} exists in pg_class but no capability maps it`,
      });
    }
  }

  return { errors, warnings, skipped };
}

function stripLeadingSlash(s) {
  return s.startsWith('/') ? s.slice(1) : s;
}
```

- [ ] **Step 4: Verify pass**

```bash
node --test scripts/features/__tests__/drift.test.mjs
```
Expected: PASS — 7/7.

- [ ] **Step 5: Commit**

```bash
git add src/client/scripts/features/drift.mjs \
        src/client/scripts/features/__tests__/drift.test.mjs
git commit -m "feat(features-matrix): add drift comparison engine with skip support"
```

---

## Task 7: Surfaces-index renderer

**Files:**
- Create: `src/client/scripts/features/render-surfaces-index.mjs`
- Create: `src/client/scripts/features/__tests__/render-surfaces-index.test.mjs`

Produces the markdown table that fills the `AUTO-GEN:SURFACES` block in `03-features.md`. One row per surface file: surface name, summary (from the frontmatter or first capability), and a relative link.

- [ ] **Step 1: Write failing test**

Create `src/client/scripts/features/__tests__/render-surfaces-index.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSurfacesIndex } from '../render-surfaces-index.mjs';

test('renders a sorted markdown table of surfaces', () => {
  const collection = {
    surfaces: [
      { file: 'timeline-dashboard.md', name: 'Timeline Dashboard', frontmatter: { summary: 'Primary view.' } },
      { file: 'command-palette.md', name: 'Command Palette', frontmatter: { summary: 'Cmd+K finder.' } },
    ],
    capabilities: [],
    errors: [],
  };
  const md = renderSurfacesIndex(collection);
  assert.match(md, /\| Surface \| Summary \| File \|/);
  // Sorted by surface name; Command Palette comes before Timeline Dashboard.
  const cpIdx = md.indexOf('Command Palette');
  const tdIdx = md.indexOf('Timeline Dashboard');
  assert.ok(cpIdx > 0 && cpIdx < tdIdx);
  assert.match(md, /\[command-palette\.md\]\(features\/command-palette\.md\)/);
});

test('falls back to derived summary when frontmatter has none', () => {
  const collection = {
    surfaces: [{ file: 'foo.md', name: 'Foo', frontmatter: {} }],
    capabilities: [{ surface: 'Foo', summary: 'First capability does X.', sourceFile: 'foo.md' }],
    errors: [],
  };
  const md = renderSurfacesIndex(collection);
  assert.match(md, /First capability does X\./);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --test scripts/features/__tests__/render-surfaces-index.test.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement render-surfaces-index**

Create `src/client/scripts/features/render-surfaces-index.mjs`:

```js
export function renderSurfacesIndex(collection) {
  const rows = collection.surfaces
    .map((surf) => {
      const summary =
        surf.frontmatter?.summary ??
        collection.capabilities.find((c) => c.surface === surf.name)?.summary ??
        '_(no summary)_';
      return {
        name: surf.name,
        summary,
        file: surf.file,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const header = '| Surface | Summary | File |\n|---|---|---|';
  const body = rows
    .map((r) => `| ${r.name} | ${r.summary} | [${r.file}](features/${r.file}) |`)
    .join('\n');

  return `${header}\n${body}`;
}
```

- [ ] **Step 4: Verify pass**

```bash
node --test scripts/features/__tests__/render-surfaces-index.test.mjs
```
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/client/scripts/features/render-surfaces-index.mjs \
        src/client/scripts/features/__tests__/render-surfaces-index.test.mjs
git commit -m "feat(features-matrix): add surfaces-index markdown renderer"
```

---

## Task 8: Auto-stub generator

**Files:**
- Create: `src/client/scripts/features/stub.mjs`
- Create: `src/client/scripts/features/__tests__/stub.test.mjs`

Given a drift report, builds stub YAML blocks for unmapped routes and RPCs. Returns a structured object `{ stubsBySurface, unsorted }` so the CLI can append to the right file. Routing logic: a route like `t/:tenantId/s/:spaceId/timeline` infers surface `timeline`; an RPC like `get_dashboard_data` is unsorted unless the user has a matching surface.

- [ ] **Step 1: Write failing test**

Create `src/client/scripts/features/__tests__/stub.test.mjs`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateStubs } from '../stub.mjs';

test('infers surface from route segment', () => {
  const report = {
    errors: [],
    warnings: [{ kind: 'route-unmapped', message: 'route /t/:tenantId/s/:spaceId/intelligence exists in code but no capability maps it' }],
    skipped: [],
  };
  const surfaces = [
    { file: 'intelligence.md', name: 'Intelligence' },
    { file: 'timeline-dashboard.md', name: 'Timeline Dashboard' },
  ];
  const result = generateStubs(report, surfaces);
  assert.ok(result.stubsBySurface['intelligence.md']);
  assert.match(result.stubsBySurface['intelligence.md'][0], /id:\s+TODO/);
  assert.match(result.stubsBySurface['intelligence.md'][0], /routes:\s*\n\s*-\s+\/t\/:tenantId\/s\/:spaceId\/intelligence/);
});

test('puts unsortable RPCs in _unsorted', () => {
  const report = {
    errors: [{ kind: 'rpc-unmapped', message: 'rpc new_widget_thing exists in pg_proc but no capability maps it' }],
    warnings: [],
    skipped: [],
  };
  const surfaces = [{ file: 'intelligence.md', name: 'Intelligence' }];
  const result = generateStubs(report, surfaces);
  assert.equal(result.unsorted.length, 1);
  assert.match(result.unsorted[0], /rpcs:\s*\n\s*-\s+new_widget_thing/);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --test scripts/features/__tests__/stub.test.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement stub**

Create `src/client/scripts/features/stub.mjs`:

```js
// Build YAML stub blocks for unmapped routes/RPCs found by drift.
// Returns { stubsBySurface: { 'surface-file.md': [yamlBlock, ...] }, unsorted: [yamlBlock, ...] }.

const ROUTE_RE = /route \/(\S+) exists in code/;
const RPC_RE = /rpc (\w+) exists in pg_proc/;

export function generateStubs(report, surfaces) {
  const stubsBySurface = {};
  const unsorted = [];

  for (const entry of [...report.warnings, ...report.errors]) {
    const routeMatch = entry.message.match(ROUTE_RE);
    if (routeMatch) {
      const route = '/' + routeMatch[1];
      const surface = inferSurfaceFromRoute(route, surfaces);
      const block = stubBlock({ routes: [route] });
      if (surface) {
        (stubsBySurface[surface.file] ??= []).push(block);
      } else {
        unsorted.push(block);
      }
      continue;
    }
    const rpcMatch = entry.message.match(RPC_RE);
    if (rpcMatch) {
      const block = stubBlock({ rpcs: [rpcMatch[1]] });
      unsorted.push(block);
    }
  }

  return { stubsBySurface, unsorted };
}

function inferSurfaceFromRoute(route, surfaces) {
  // Try matching the last segment of the route to a surface file slug.
  const segments = route.split('/').filter((s) => s && !s.startsWith(':'));
  const tail = segments[segments.length - 1];
  if (!tail) return null;
  return surfaces.find((s) => s.file === `${tail}.md` || s.name.toLowerCase().includes(tail));
}

function stubBlock({ routes = [], rpcs = [], tables = [] }) {
  return [
    `- id: TODO-rename`,
    `  summary: TODO`,
    `  routes:${routes.length ? '\n    - ' + routes.join('\n    - ') : ' []'}`,
    `  rpcs:${rpcs.length ? '\n    - ' + rpcs.join('\n    - ') : ' []'}`,
    `  tables:${tables.length ? '\n    - ' + tables.join('\n    - ') : ' []'}`,
    `  related: []`,
    `  user_facing: true`,
    `  role: viewer`,
    `  status: experimental`,
  ].join('\n');
}
```

- [ ] **Step 4: Verify pass**

```bash
node --test scripts/features/__tests__/stub.test.mjs
```
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/client/scripts/features/stub.mjs \
        src/client/scripts/features/__tests__/stub.test.mjs
git commit -m "feat(features-matrix): add auto-stub generator for unmapped routes/rpcs"
```

---

## Task 9: Near query

**Files:**
- Create: `src/client/scripts/features/near.mjs`
- Create: `src/client/scripts/features/__tests__/near.test.mjs`

Filters capabilities by overlapping tables, rpcs, or routes. Used by `npm run features:near` and called pre-design to surface adjacent capabilities.

- [ ] **Step 1: Write failing test**

Create `src/client/scripts/features/__tests__/near.test.mjs`:

```js
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
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --test scripts/features/__tests__/near.test.mjs
```
Expected: FAIL.

- [ ] **Step 3: Implement near**

Create `src/client/scripts/features/near.mjs`:

```js
export function findNear(collection, filters) {
  const hits = [];
  for (const cap of collection.capabilities) {
    let overlap = 0;
    const reasons = [];
    if (filters.tables) {
      const matches = (cap.tables || []).filter((t) => filters.tables.includes(t));
      overlap += matches.length;
      if (matches.length) reasons.push(`tables=${matches.join(',')}`);
    }
    if (filters.rpcs) {
      const matches = (cap.rpcs || []).filter((r) => filters.rpcs.includes(r));
      overlap += matches.length;
      if (matches.length) reasons.push(`rpcs=${matches.join(',')}`);
    }
    if (filters.routes) {
      const matches = (cap.routes || []).filter((r) => filters.routes.includes(r));
      overlap += matches.length;
      if (matches.length) reasons.push(`routes=${matches.join(',')}`);
    }
    if (overlap > 0) {
      hits.push({ id: cap.id, surface: cap.surface, overlap, reasons });
    }
  }
  hits.sort((a, b) => b.overlap - a.overlap);
  return hits;
}
```

- [ ] **Step 4: Verify pass**

```bash
node --test scripts/features/__tests__/near.test.mjs
```
Expected: PASS — 2/2.

- [ ] **Step 5: Commit**

```bash
git add src/client/scripts/features/near.mjs \
        src/client/scripts/features/__tests__/near.test.mjs
git commit -m "feat(features-matrix): add near query for overlap detection"
```

---

## Task 10: CLI entrypoint

**Files:**
- Create: `src/client/scripts/features-drift.mjs`
- Create: `src/client/scripts/features/__tests__/cli.test.mjs`

Thin shell that dispatches to the modules. Subcommands: `check`, `stub`, `near`, `surfaces-index`. Uses minimal `process.argv` parsing (no commander dep needed). Exit code 1 on error-level drift; 0 otherwise. Output is colored only when stdout is a TTY.

- [ ] **Step 1: Write the CLI integration test**

Create `src/client/scripts/features/__tests__/cli.test.mjs`:

```js
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
  // The fixture dir has dup-ids-a + dup-ids-b which collide.
  const { code, stdout } = await run(['check', '--no-db']);
  assert.equal(code, 1);
  assert.match(stdout, /duplicate id/);
});

test('near returns the expected overlap list', async () => {
  const { code, stdout } = await run(['near', '--tables', 'trials', '--no-db']);
  assert.equal(code, 0);
  // timeline-grid in the fixture has tables: [trials]
  assert.match(stdout, /timeline-grid/);
});

test('unknown subcommand exits with usage', async () => {
  const { code, stderr } = await run(['nonsense']);
  assert.equal(code, 2);
  assert.match(stderr, /usage|unknown/i);
});
```

- [ ] **Step 2: Run test to verify failure**

```bash
node --test scripts/features/__tests__/cli.test.mjs
```
Expected: FAIL — `features-drift.mjs` not found.

- [ ] **Step 3: Implement the CLI**

Create `src/client/scripts/features-drift.mjs`:

```js
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
  const routes = new Set(await extractRoutes(ROUTES_TS).catch(() => []));
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
```

- [ ] **Step 4: Verify pass**

```bash
node --test scripts/features/__tests__/cli.test.mjs
```
Expected: PASS — 3/3.

- [ ] **Step 5: Verify all script tests pass together**

```bash
npm run test:scripts
```
Expected: all 21+ tests across 8 files pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/scripts/features-drift.mjs \
        src/client/scripts/features/__tests__/cli.test.mjs
git commit -m "feat(features-matrix): add CLI dispatcher for check/stub/near/surfaces-index"
```

---

## Task 11: Convert `03-features.md` to an auto-generated index

**Files:**
- Modify: `docs/runbook/03-features.md`

Replace the current prose content with a thin index template (intro paragraph + `AUTO-GEN:SURFACES` block). The body content is being moved to per-surface files in the next task, so the existing prose is removed here. Drop the existing `AUTO-GEN:DRIFT` block.

- [ ] **Step 1: Read current `03-features.md` to confirm state**

Run from repo root:
```bash
wc -l docs/runbook/03-features.md
```
Expected: ~469 lines (current state).

- [ ] **Step 2: Rewrite the file**

Replace the entire contents of `docs/runbook/03-features.md` with:

```markdown
# Features

[Back to index](README.md)

---

Clint's feature inventory, broken down by surface. Each surface has a
dedicated page under `features/` with narrative and a structured
capability block. The list below is regenerated from those files.

To explore the matrix structurally:

- `npm run features:near -- --tables <name>` — find capabilities touching a table
- `npm run features:near -- --rpcs <name>` — find capabilities calling an RPC
- `npm run features:check` — verify the matrix against live code

<!-- AUTO-GEN:SURFACES -->
<!-- /AUTO-GEN:SURFACES -->
```

- [ ] **Step 3: Verify the file still resolves drift markers**

The block markers exist; the `surfaces-index` subcommand can populate them in the next task once features files are created. No surface files exist yet, so the block stays empty for now.

- [ ] **Step 4: Commit**

```bash
git add docs/runbook/03-features.md
git commit -m "refactor(features-matrix): convert 03-features.md to thin index template"
```

Note: the previous prose content is gone from this commit but recoverable via `git log`. The next task migrates it to the per-surface files.

---

## Task 12: Bootstrap per-surface files

**Files:**
- Create: `docs/runbook/features/*.md` (one per H2 section in the pre-refactor `03-features.md`)

This is a content-migration task. The pre-refactor file had ~30 H2 sections (visible in the previous commit). Each H2 becomes one file under `docs/runbook/features/<slug>.md`. The prose body is preserved verbatim; the YAML capabilities block is drafted from the routes / RPCs / tables mentioned in the prose.

This task is verified by `npm run features:check` reaching a clean (or warn-only) state.

- [ ] **Step 1: Recover the pre-refactor prose**

Run from repo root:
```bash
git show HEAD~1:docs/runbook/03-features.md > /tmp/03-features-original.md
```
Expected: the original ~469-line file written to `/tmp/`.

- [ ] **Step 2: Create the features directory**

```bash
mkdir -p docs/runbook/features
```

- [ ] **Step 3: Split each H2 section into a separate file**

For each H2 heading in `/tmp/03-features-original.md`, create a file under `docs/runbook/features/`. The slug is the kebab-cased heading (e.g., "Timeline Dashboard" → `timeline-dashboard.md`).

Example output for the first surface — create `docs/runbook/features/engagement-landing.md`:

````markdown
---
surface: Engagement Landing
spec: docs/specs/engagement-landing/spec.md
---

# Engagement Landing

[Verbatim prose from the original "## Engagement Landing (Default Space Surface)"
section, including the bullet list of composition, the onboarding tooltip
paragraph, the routing change details, the stats RPC paragraph, and the
drafts RPC paragraph. Preserve any internal links and Mermaid blocks.]

## Capabilities

```yaml
- id: engagement-landing-pulse-header
  summary: Tracked eyebrow, engagement title, and five integrated stat tiles linking to browse pages.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_space_landing_stats
  tables:
    - primary_intelligence
    - markers
    - trials
    - products
    - companies
  related:
    - engagement-landing-today-brief
    - engagement-landing-what-changed
  user_facing: true
  role: viewer
  status: active

- id: engagement-landing-today-brief
  summary: Teal-accented one-line rollup for catalysts this week and drafts in progress.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_space_landing_stats
  tables: []
  related:
    - engagement-landing-pulse-header
  user_facing: true
  role: viewer
  status: active

- id: engagement-landing-what-changed
  summary: High-signal change events from the past 7 days, capped at five.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_activity_feed
  tables:
    - trial_change_events
  related:
    - trial-change-feed
    - activity-page
  user_facing: true
  role: viewer
  status: active

- id: engagement-landing-next-14-days
  summary: Inline calendar showing up to seven upcoming markers within 14 days.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_dashboard_data
  tables:
    - markers
  related:
    - timeline-grid
    - catalysts-grouping
  user_facing: true
  role: viewer
  status: active

- id: engagement-landing-drafts-widget
  summary: Agency-only drafts widget on the engagement landing.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - list_draft_intelligence_for_space
  tables:
    - primary_intelligence
  related:
    - intelligence-drawer
  user_facing: true
  role: agency
  status: active

- id: engagement-landing-latest-from-stout
  summary: Most recently published primary intelligence rows with entity-type filter chips.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - list_primary_intelligence
  tables:
    - primary_intelligence
  related:
    - intelligence-browse
  user_facing: true
  role: viewer
  status: active

- id: engagement-landing-recent-materials
  summary: Recent materials feed below the fold, hidden when empty.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - list_recent_materials_for_space
  tables:
    - materials
  related:
    - materials-section
  user_facing: true
  role: viewer
  status: active
```
````

Repeat for every H2 section. The expected per-surface slug list (based on the pre-refactor prose):

```
engagement-landing.md
timeline-dashboard.md
timeline-zoom.md (or merged into timeline-dashboard.md as a capability)
filtering.md
legend.md
data-management.md
command-palette.md
events.md
catalysts.md
pptx-export.md
trial-change-feed.md
ctgov-integration.md
multi-tenant-workspaces.md
whitelabel-brand-resolution.md
branded-login.md
agency-portal.md
super-admin-portal.md
domain-allowlist-self-join.md
branded-invite-emails.md
primary-intelligence.md
materials-registry.md
branded-pptx-exports.md
marketing-landing.md
authentication.md
in-app-help-pages.md
```

Decision rule when an H2 in the original prose is a small section that arguably belongs as a capability under a larger surface (e.g., "Timeline Zoom" under "Timeline Dashboard"): merge it as a capability row rather than its own file. Use judgment; the drift CLI will catch broken cross-references.

This is the longest sub-step. Allow 60-90 minutes for ~30 files. Use the original prose's mentions of routes, RPC names, and tables to populate the YAML blocks.

- [ ] **Step 4: Run drift with `--no-db` first to catch parser issues**

From `src/client/`:
```bash
npm run features:check -- --no-db
```
Iterate until parse-time errors are gone. Expected output once clean: only `route-unmapped` warnings remain (resolved when DB checks run too).

- [ ] **Step 5: Run drift against live DB**

Ensure local Supabase is running:
```bash
supabase start
```

From `src/client/`:
```bash
npm run features:check
```

Iterate on YAML blocks: add missing RPCs/tables, fix typos. The CLI lists what's missing.

For routes that are pure redirects (e.g., `landscape/by-therapy-area` redirecting to `bullseye/by-therapy-area`), add a `// @matrix-skip: redirect` comment on the route line in `app.routes.ts` to exempt it. Each skip must carry a one-line reason.

Acceptable end state for this task:
- `errors.length === 0`
- Warnings only for routes/tables intentionally skipped or pending deliberate deferral; document the reason in PR description.

- [ ] **Step 6: Populate the surfaces index**

From `src/client/`:
```bash
npm run features:surfaces-index
```
Expected: `docs/runbook/03-features.md` is updated with the surfaces table inside the AUTO-GEN block.

- [ ] **Step 7: Commit**

```bash
git add docs/runbook/features/ docs/runbook/03-features.md src/client/src/app/app.routes.ts
git commit -m "feat(features-matrix): bootstrap per-surface files from existing prose"
```

---

## Task 13: Extend the stop hook

**Files:**
- Modify: `.claude/hooks/runbook-review-guard.sh`

Add a rule that surfaces `features.yaml`-relevant files when migrations, routes, or feature components change in a session.

- [ ] **Step 1: Add the features rule**

Edit `.claude/hooks/runbook-review-guard.sh`. After the existing `helpRules` array closing `];` and before the `for (const rule of helpRules)` loop, insert this block:

```js
// path-pattern -> features matrix files that may need review.
const featuresRules = [
  {
    patterns: [/supabase\/migrations\//, /\.sql$/i],
    msg: "Migration changed. Review docs/runbook/features/*.md — add/update the capability row(s) for affected RPCs or tables.",
  },
  {
    patterns: [/src\/client\/src\/app\/app\.routes\.ts/],
    msg: "Routes changed. Review docs/runbook/features/*.md — update routes: arrays on the affected capability rows.",
  },
  {
    patterns: [/src\/client\/src\/app\/features\/[^/]+\//],
    msg: "Feature folder touched. Confirm the matching docs/runbook/features/<slug>.md exists and that its YAML capabilities block reflects the change.",
  },
];

const featuresFlags = [];
for (const rule of featuresRules) {
  if (rule.patterns.some((re) => re.test(changed))) {
    featuresFlags.push(rule.msg);
  }
}
```

Then, before the `process.stdout.write(JSON.stringify(...))` line at the end, append the features flags onto `reason`:

```js
if (featuresFlags.length > 0) {
  reason += "\n\nFeatures matrix files that may need review:\n" + featuresFlags.join("\n");
}
```

- [ ] **Step 2: Manually trigger the hook**

```bash
echo "src/client/src/app/app.routes.ts" >> .claude/.runbook-dirty
bash .claude/hooks/runbook-review-guard.sh
```
Expected: JSON output with a `decision: block` and a `reason` that includes the features-matrix message. Clear the marker:
```bash
> .claude/.runbook-dirty
```

- [ ] **Step 3: Commit**

```bash
git add .claude/hooks/runbook-review-guard.sh
git commit -m "feat(features-matrix): extend stop hook to flag features matrix updates"
```

---

## Task 14: CI features-drift job

**Files:**
- Modify: `.github/workflows/ci.yml`

The drift CLI needs Supabase running for the live RPC/table checks. The existing `tests` job already starts Supabase; add the drift step to that job after the Supabase-running steps.

- [ ] **Step 1: Add the drift step**

Edit `.github/workflows/ci.yml`. In the `tests` job, after the existing `Run Supabase advisors (gate on WARN)` step (around line 66) and before the `Get Supabase keys` step, insert:

```yaml
      - name: Run features-drift check
        run: cd src/client && npm run features:check
```

Also add the `test:scripts` step to the `lint-and-build` job. After the existing `npx ng build` step:

```yaml
      - run: cd src/client && npm run test:scripts
```

- [ ] **Step 2: Smoke-test locally**

```bash
cd src/client && npm run test:scripts
```
Expected: all script tests pass.

If local Supabase is running:
```bash
npm run features:check
```
Expected: clean (matches what Task 12 left).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(features-matrix): add features-drift + test:scripts jobs"
```

---

## Task 15: Empty-state audit policy

**Files:**
- Modify: `src/client/CLAUDE.md`

Add Section 13 with the empty-state audit checklist. Lands after the existing Section 12 (Verification) and before the unnumbered "## Tooling available in-session" block.

- [ ] **Step 1: Insert the section**

Edit `src/client/CLAUDE.md`. After the line `For UI changes, exercise the feature in a browser. Type checks verify code, not behavior.` (end of section 12), and before the line `## Tooling available in-session`, insert:

```markdown

## 13. Empty-state audit

Every user-facing surface must answer these questions in the UI itself, not in a help page:

1. **First-row state.** When data exists, the row labels and primary value column communicate what each row is without external context. Column headers use domain vocabulary (Marker, Trial, Catalyst), never generic ones (Item, Record).
2. **Empty state.** When there is no data, the empty state names what goes here and how to add one. For viewer-role surfaces (read-only), the empty state explains why it is empty without offering an action the role cannot take.
3. **Action labels.** Every button and link uses domain vocabulary in imperative form (Register material, Open command palette, Publish intelligence). No generic CTAs (Submit, Click here, Add).
4. **Tooltips on icon-only buttons.** Every button without text uses `pTooltip` from `primeng/tooltip`. Position right for nav rails, top for inline badges, bottom for editor toolbars.
5. **Role-appropriate affordances.** Surfaces shown to multiple roles hide actions the current role cannot take. No greyed-out buttons; no permission-denied toasts after click.
6. **Loading and error states.** Skeleton placeholder during fetch. Errors name what failed and what to do (retry, contact owner). Never silent empty.

**Exception.** Three editorial conventions cannot be carried by the UI alone and have dedicated help pages: marker color rules (`help/markers`), phase color rules (`help/phases`), role and permission model (`help/roles`). Adding a fourth requires a deliberate decision. By default, work harder on the surface first.

**When adding a new feature:** run `npm run features:near -- --tables <touched-tables> --rpcs <touched-rpcs>` to surface adjacent capabilities. Reference any hits in the spec under a "Related capabilities" header.

```

- [ ] **Step 2: Verify the file**

Read the file and confirm Section 12 still ends correctly and Section 13 lands at the right position with the empty-state content intact.

- [ ] **Step 3: Commit**

```bash
git add src/client/CLAUDE.md
git commit -m "docs(features-matrix): add empty-state audit policy as Section 13"
```

---

## Task 16: End-to-end verification

**Files:** none (validation only)

Confirm the complete pipeline works: hooks fire, CI commands pass, drift catches injected regressions, near returns useful overlap.

- [ ] **Step 1: Run all script tests**

From `src/client/`:
```bash
npm run test:scripts
```
Expected: all tests pass.

- [ ] **Step 2: Run drift against live state**

Ensure Supabase is running. From `src/client/`:
```bash
npm run features:check
```
Expected: exit code 0; clean or warn-only output.

- [ ] **Step 3: Verify near returns useful results**

```bash
npm run features:near -- --tables markers
```
Expected: at least three capability rows listed (e.g., timeline-grid, catalysts-grouping, engagement-landing-next-14-days).

- [ ] **Step 4: Verify surfaces index regen**

```bash
npm run features:surfaces-index
```
Expected: `docs/runbook/03-features.md` AUTO-GEN block is filled with one row per surface file.

```bash
git diff docs/runbook/03-features.md
```
Expected: no diff (already in sync from Task 12).

- [ ] **Step 5: Manually inject a regression to confirm CI would catch it**

Add a fake RPC reference to one of the surface files:

```bash
# pick any features file and append a fake rpc to one capability
```

Then:
```bash
npm run features:check
```
Expected: exit code 1; `rpc-not-in-db` error listed.

Revert the injection:
```bash
git checkout docs/runbook/features/
```

- [ ] **Step 6: Run the broader lint/build**

```bash
cd src/client && ng lint && ng build
```
Expected: existing checks still pass; nothing in the matrix work disturbs them.

- [ ] **Step 7: Final commit (if any cleanup needed)**

If any small fix-ups remain:
```bash
git add -A
git commit -m "chore(features-matrix): verification fixups"
```

Otherwise no commit needed.

---

## Done

Verification at this point:

- `npm run test:scripts` passes
- `npm run features:check` exits 0 with clean output
- `npm run features:near -- --tables markers` returns ≥3 capabilities
- `npm run features:surfaces-index` is idempotent
- CI pipeline (lint-and-build + tests) is green
- Stop hook surfaces features matrix files when migrations/routes/features change
- `src/client/CLAUDE.md` carries Section 13
- `docs/runbook/03-features.md` is the thin index; per-surface content lives under `docs/runbook/features/`

The matrix is now active: design-time queries via `features:near`, CI-gated currency, low-friction additions via `features:stub`.
