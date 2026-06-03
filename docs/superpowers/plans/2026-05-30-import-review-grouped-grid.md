# Import Review Grouped Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the import-review screen as a grouped grid (PrimeNG TreeTable) that suppresses routine rows and surfaces only the entities that need review, with indication as a first-class attribute.

**Architecture:** Extract all review decision logic (entity state, flag derivation, within-batch duplicate detection, readable selection summary, blocking reason) into a pure, Vitest-tested module `review-grid.logic.ts`. Then rebuild the `review-page.component.ts` template from a hand-rolled nested `ng-template` tree into a PrimeNG TreeTable whose rows are built from that pure logic, with per-row detail in the row-expansion slot. No backend, RPC, schema, or proposal-shape changes.

**Tech Stack:** Angular 21 (standalone, OnPush, signals, native control flow), PrimeNG 21.2.1 TreeTable, Tailwind v4 (brand tokens), Vitest (`npm run test:units`).

---

## Background the engineer needs

The screen lives in one 1584-line standalone component with an inline template:
`src/app/features/source-import/review-page.component.ts`. It has no separate
`.html`/`.scss`. Route: `/t/:tenantId/s/:spaceId/import/:aiCallId/review`.

The proposal data is held in `SourceImportService` (`source-import.service.ts`)
and copied into the component's `proposal` signal in `ngOnInit`. Entities are
five flat arrays inside `proposal().proposals`: `companies`, `assets`, `trials`,
`markers`, `events`. Each entity is a loose `Record<string, unknown>`. Entities
reference each other by index-based refs (`company_ref`, `asset_ref`,
`trial_refs`) and carry `match` / `existing_id` when they resolve to an existing
record. A flat selection map keyed by `entityKey(type, idx)` = `"trials_2"`
tracks checkboxes.

Key existing methods you will reuse (do NOT rewrite their internals unless a task
says so), all in `review-page.component.ts`:

- `entityKey(type, idx)` -> `"trials_2"` (line ~829)
- `entitiesOf(type)` -> the array for a type (line ~833)
- `isNew(type, idx)` -> `!match && !existing_id` (line ~882)
- `entityName(type, idx)` (line ~887)
- `trialPhase(idx)`, `trialStatus(idx)` (~line 1100s)
- `isObservationalTrial(idx)` currently a proxy: `!asset_ref && !existing_id` (line 1140) — Task 6 fixes this
- `assetGenericName(idx)`, `assetMoas(idx)`, `assetRoas(idx)` (lines 1147-1166)
- `editableFields(type, idx)` dynamic string fields, skip-list at line 1185 (note: `indication` is NOT in the skip list, so it already surfaces as a generic field)
- `trialMissingAsset(trial)` (line 1220)
- `hierarchicalTree()` builds `CompanyNode[]` (line 1229)
- `canConfirm()` (line 870), `selectedCount()` (846), `selectionSummary()` (863) producing `"3C/6A/6T/0M/0E"`
- `ctgovCandidatesFor(idx)`, `trialCtgovStatus(idx)`, `fuzzyAlternatesFor(type, idx)`

Test runner facts (critical):
- Run unit tests with `npm run test:units` (Vitest, config `vitest.units.config.ts`).
- The units glob is `src/**/*.spec.ts` but EXCLUDES `*.component.spec.ts`. So pure-logic specs MUST be named `*.logic.spec.ts` (or any `.spec.ts` that is not `.component.spec.ts`) to be picked up. Environment is `node` (no DOM) — keep logic specs DOM-free.
- There is NO `ng test` target. Never run `npx ng test` or bare `npx vitest run` (the latter sweeps Playwright specs and fails).
- Build/lint: `npx ng build` and `npx ng lint` from `src/client`.

Brand/lint rules that will bite you:
- Brand tokens only: `bg-brand-*` / `text-brand-*` etc. Data colors slate/amber/cyan/violet/green are allowed hard-coded. Never `bg-teal-*`.
- Standalone + `ChangeDetectionStrategy.OnPush` + `inject()` + signals + native control flow (`@if`/`@for`). No `*ngIf`, no `ngClass`/`ngStyle`, no constructor DI.
- Any plain prop bound via `[(ngModel)]` that feeds a `computed()` MUST be a signal.
- `pTooltip` from `primeng/tooltip`, never native `title=`.

---

## File Structure

- **Create** `src/app/features/source-import/review-grid.logic.ts` — pure functions and types: entity state, flag derivation, within-batch duplicate detection, readable selection summary, blocking reason. No Angular imports. One responsibility: turn proposal data into review decisions.
- **Create** `src/app/features/source-import/review-grid.logic.spec.ts` — Vitest unit tests for the above (picked up by `test:units`).
- **Modify** `src/app/features/source-import/review-page.component.ts` — consume the logic module; replace the nested `ng-template` tree with a PrimeNG TreeTable; replace `selectionSummary()` output and footer; add the filter control; surface indication; fix `isObservationalTrial`.

The component stays one file (it is already the established shape here, and the template + its thin adapters belong together). The pure logic moves OUT so it is testable and so the component shrinks.

---

## Task 1: TreeTable spike — prove nesting + row expansion coexist

**Files:**
- Modify: `src/app/features/source-import/review-page.component.ts` (imports + a throwaway block at the top of the template, removed in Task 4)

This is a throwaway proof. The spec locked TreeTable; this task only de-risks that one `p-treeTable` can carry BOTH tree nesting AND a separate detail row-expansion before we build the real thing.

- [ ] **Step 1: Add TreeTableModule import**

In `review-page.component.ts`, add to the imports list in the `@Component` decorator and the TS import block:

```ts
import { TreeTableModule } from 'primeng/treetable';
import { TreeNode } from 'primeng/api';
```

Add `TreeTableModule` to the `imports: [...]` array.

- [ ] **Step 2: Add a temporary spike block at the very top of the template**

Immediately inside the root `<div class="flex h-full flex-col">`, before `<header>`, add:

```html
<!-- SPIKE: remove in Task 4 -->
<p-treeTable [value]="spikeNodes" [scrollable]="true" dataKey="key">
  <ng-template pTemplate="header">
    <tr><th>Entity</th><th>Phase</th></tr>
  </ng-template>
  <ng-template pTemplate="body" let-rowNode let-rowData="rowData">
    <tr>
      <td>
        <p-treeTableToggler [rowNode]="rowNode" />
        {{ rowData.name }}
        @if (rowData.hasDetail) {
          <button type="button" (click)="spikeToggle(rowData.key)">detail</button>
        }
      </td>
      <td>{{ rowData.phase }}</td>
    </tr>
    @if (spikeExpanded[rowData.key]) {
      <tr><td colspan="2">DETAIL for {{ rowData.name }}</td></tr>
    }
  </ng-template>
</p-treeTable>
```

- [ ] **Step 3: Add temporary spike members to the class**

```ts
protected spikeExpanded: Record<string, boolean> = {};
protected spikeToggle(k: string): void { this.spikeExpanded[k] = !this.spikeExpanded[k]; }
protected spikeNodes: TreeNode[] = [
  { key: 'a', data: { key: 'a', name: 'Semaglutide', phase: '', hasDetail: true },
    expanded: true,
    children: [{ key: 'a-t', data: { key: 'a-t', name: 'NCT03548935', phase: 'P3', hasDetail: true } }] },
];
```

- [ ] **Step 4: Build and run the app, confirm both behaviours**

Run: `npx ng build`
Expected: build succeeds.

Then verify in the browser (the importer flow, or temporarily hard-code the spike): the child row (NCT...) renders nested under the parent, the toggler expands/collapses the tree, AND clicking "detail" shows the extra DETAIL row independently. If both work, the mechanism is confirmed. If row-expansion fights the tree toggler, STOP and switch the plan to PrimeNG `TableModule` with manual grouping rows (note it in the plan and continue Task 2 unchanged — only the template tasks change).

- [ ] **Step 5: Commit the spike**

```bash
git add src/app/features/source-import/review-page.component.ts
git commit -m "Spike: confirm TreeTable supports nesting plus row-detail expansion"
```

---

## Task 2: Pure logic module — entity state and the flag taxonomy

**Files:**
- Create: `src/app/features/source-import/review-grid.logic.ts`
- Test: `src/app/features/source-import/review-grid.logic.spec.ts`

This module is DOM-free and holds every review decision. Tasks 5-8 wire the
component to it.

- [ ] **Step 1: Write the failing test**

Create `src/app/features/source-import/review-grid.logic.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { entityState, deriveTrialFlags, deriveAssetFlags } from './review-grid.logic';

describe('entityState', () => {
  it('is existing when the entity has a match', () => {
    expect(entityState({ match: 'abc' })).toBe('existing');
  });
  it('is existing when the entity has an existing_id', () => {
    expect(entityState({ existing_id: 'id-1' })).toBe('existing');
  });
  it('is new when neither match nor existing_id is present', () => {
    expect(entityState({ name: 'Foo' })).toBe('new');
  });
});

describe('deriveTrialFlags', () => {
  it('flags a trial with no asset link as blocking', () => {
    const flags = deriveTrialFlags({ name: 'NCT1' });
    expect(flags).toContainEqual({ id: 'no-asset', tier: 'blocking', label: 'No asset' });
  });
  it('does not flag a trial that has asset_ref', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0 });
    expect(flags.some((f) => f.id === 'no-asset')).toBe(false);
  });
  it('flags missing indication as attention', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0 });
    expect(flags).toContainEqual({ id: 'no-indication', tier: 'attention', label: 'No indication' });
  });
  it('does not flag missing indication when indication is present', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0, indication: 'Obesity' });
    expect(flags.some((f) => f.id === 'no-indication')).toBe(false);
  });
  it('flags observational study_type as attention', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0, indication: 'X', study_type: 'Observational' });
    expect(flags).toContainEqual({ id: 'observational', tier: 'attention', label: 'Observational' });
  });
  it('flags missing phase or status as attention', () => {
    const flags = deriveTrialFlags({ name: 'NCT1', asset_ref: 0, indication: 'X', phase: '' });
    expect(flags.some((f) => f.id === 'missing-phase-status')).toBe(true);
  });
});

describe('deriveAssetFlags', () => {
  it('flags an asset with no moa and no roa as attention', () => {
    const flags = deriveAssetFlags({ name: 'Foo' });
    expect(flags).toContainEqual({ id: 'no-moa-roa', tier: 'attention', label: 'No MOA/ROA' });
  });
  it('does not flag when moa is present', () => {
    const flags = deriveAssetFlags({ name: 'Foo', moa: 'GLP-1' });
    expect(flags.some((f) => f.id === 'no-moa-roa')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:units -- review-grid.logic`
Expected: FAIL — cannot find module `./review-grid.logic`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/app/features/source-import/review-grid.logic.ts`:

```ts
// Pure review-decision logic for the import-review grouped grid.
// No Angular imports: unit-tested via vitest (npm run test:units).

export type EntityState = 'new' | 'existing';
export type FlagTier = 'blocking' | 'attention' | 'info';

export interface ReviewFlag {
  id: string;
  tier: FlagTier;
  label: string;
}

type Entity = Record<string, unknown>;

export function entityState(entity: Entity): EntityState {
  return entity['match'] || entity['existing_id'] ? 'existing' : 'new';
}

function trialMissingAsset(trial: Entity): boolean {
  return trial['asset_ref'] == null && trial['existing_id'] == null && trial['asset_match'] == null;
}

function isObservational(trial: Entity): boolean {
  const t = String(trial['study_type'] ?? '').toLowerCase();
  return t.includes('observational');
}

export function deriveTrialFlags(trial: Entity): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  if (trialMissingAsset(trial)) {
    flags.push({ id: 'no-asset', tier: 'blocking', label: 'No asset' });
  }
  if (!trial['indication']) {
    flags.push({ id: 'no-indication', tier: 'attention', label: 'No indication' });
  }
  if (isObservational(trial)) {
    flags.push({ id: 'observational', tier: 'attention', label: 'Observational' });
  }
  if (!trial['phase'] || !trial['status']) {
    flags.push({ id: 'missing-phase-status', tier: 'attention', label: 'Missing phase/status' });
  }
  return flags;
}

export function deriveAssetFlags(asset: Entity): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  const moa = asset['moa'];
  const roa = asset['roa'];
  const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
  if (empty(moa) && empty(roa)) {
    flags.push({ id: 'no-moa-roa', tier: 'attention', label: 'No MOA/ROA' });
  }
  return flags;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:units -- review-grid.logic`
Expected: PASS (all cases above).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/source-import/review-grid.logic.ts src/app/features/source-import/review-grid.logic.spec.ts
git commit -m "Add pure review-grid flag/state logic with unit tests"
```

---

## Task 3: Pure logic — within-batch duplicate detection and ctgov/fuzzy attention flags

**Files:**
- Modify: `src/app/features/source-import/review-grid.logic.ts`
- Modify: `src/app/features/source-import/review-grid.logic.spec.ts`

The blocking "within-batch duplicate" check and the two match-ambiguity
attention flags need cross-entity context, so they take extra args.

- [ ] **Step 1: Add failing tests**

Append to `review-grid.logic.spec.ts`:

```ts
import { duplicateTrialIndexes, deriveCtgovFlag, deriveFuzzyFlag } from './review-grid.logic';

describe('duplicateTrialIndexes', () => {
  it('returns indexes of trials sharing the same identifier', () => {
    const trials = [
      { identifier: 'NCT1' }, { identifier: 'NCT2' }, { identifier: 'NCT1' },
    ];
    expect(duplicateTrialIndexes(trials)).toEqual(new Set([0, 2]));
  });
  it('ignores blank identifiers', () => {
    const trials = [{ identifier: '' }, { identifier: '' }];
    expect(duplicateTrialIndexes(trials)).toEqual(new Set());
  });
  it('returns empty when all identifiers are unique', () => {
    const trials = [{ identifier: 'NCT1' }, { identifier: 'NCT2' }];
    expect(duplicateTrialIndexes(trials)).toEqual(new Set());
  });
});

describe('deriveCtgovFlag', () => {
  it('flags when more than one ctgov candidate needs a pick', () => {
    expect(deriveCtgovFlag(2)).toEqual({ id: 'ctgov-pick', tier: 'attention', label: 'CT.gov: pick match' });
  });
  it('returns null for one or zero candidates', () => {
    expect(deriveCtgovFlag(1)).toBeNull();
    expect(deriveCtgovFlag(0)).toBeNull();
  });
});

describe('deriveFuzzyFlag', () => {
  it('flags when fuzzy alternates exist', () => {
    expect(deriveFuzzyFlag(3)).toEqual({ id: 'fuzzy', tier: 'attention', label: 'Uncertain match' });
  });
  it('returns null when no alternates', () => {
    expect(deriveFuzzyFlag(0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:units -- review-grid.logic`
Expected: FAIL — exports not defined.

- [ ] **Step 3: Implement**

Append to `review-grid.logic.ts`:

```ts
export function duplicateTrialIndexes(trials: Entity[]): Set<number> {
  const seen = new Map<string, number[]>();
  trials.forEach((t, idx) => {
    const id = String(t['identifier'] ?? '').trim();
    if (!id) return;
    const arr = seen.get(id) ?? [];
    arr.push(idx);
    seen.set(id, arr);
  });
  const dupes = new Set<number>();
  for (const arr of seen.values()) {
    if (arr.length > 1) arr.forEach((i) => dupes.add(i));
  }
  return dupes;
}

export function deriveCtgovFlag(candidateCount: number): ReviewFlag | null {
  return candidateCount > 1
    ? { id: 'ctgov-pick', tier: 'attention', label: 'CT.gov: pick match' }
    : null;
}

export function deriveFuzzyFlag(alternateCount: number): ReviewFlag | null {
  return alternateCount > 0
    ? { id: 'fuzzy', tier: 'attention', label: 'Uncertain match' }
    : null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:units -- review-grid.logic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/source-import/review-grid.logic.ts src/app/features/source-import/review-grid.logic.spec.ts
git commit -m "Add within-batch duplicate detection and match-ambiguity flags"
```

---

## Task 4: Pure logic — readable selection summary and blocking reason

**Files:**
- Modify: `src/app/features/source-import/review-grid.logic.ts`
- Modify: `src/app/features/source-import/review-grid.logic.spec.ts`

Replaces the cryptic `"3C/6A/6T/0M/0E"` footer and computes the human blocking
message.

- [ ] **Step 1: Add failing tests**

Append to `review-grid.logic.spec.ts`:

```ts
import { readableSummary, blockingReason } from './review-grid.logic';

describe('readableSummary', () => {
  it('formats selected counts in domain words, omitting zero buckets', () => {
    expect(readableSummary({ companies: 3, assets: 6, trials: 6, markers: 0, events: 0 }))
      .toBe('3 companies, 6 assets, 6 trials');
  });
  it('singularises counts of one', () => {
    expect(readableSummary({ companies: 1, assets: 1, trials: 0, markers: 0, events: 0 }))
      .toBe('1 company, 1 asset');
  });
  it('returns "nothing selected" when all zero', () => {
    expect(readableSummary({ companies: 0, assets: 0, trials: 0, markers: 0, events: 0 }))
      .toBe('nothing selected');
  });
});

describe('blockingReason', () => {
  it('reports the count of trials missing an asset', () => {
    expect(blockingReason({ noAsset: 2, duplicates: 0 })).toBe('2 trials need an asset');
  });
  it('reports duplicates', () => {
    expect(blockingReason({ noAsset: 0, duplicates: 3 })).toBe('3 duplicate trials in this batch');
  });
  it('returns null when nothing blocks', () => {
    expect(blockingReason({ noAsset: 0, duplicates: 0 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test:units -- review-grid.logic`
Expected: FAIL.

- [ ] **Step 3: Implement**

Append to `review-grid.logic.ts`:

```ts
export interface SelectionCounts {
  companies: number; assets: number; trials: number; markers: number; events: number;
}

const LABELS: Record<keyof SelectionCounts, [string, string]> = {
  companies: ['company', 'companies'],
  assets: ['asset', 'assets'],
  trials: ['trial', 'trials'],
  markers: ['marker', 'markers'],
  events: ['event', 'events'],
};

export function readableSummary(counts: SelectionCounts): string {
  const parts: string[] = [];
  (Object.keys(LABELS) as (keyof SelectionCounts)[]).forEach((k) => {
    const n = counts[k];
    if (n > 0) parts.push(`${n} ${n === 1 ? LABELS[k][0] : LABELS[k][1]}`);
  });
  return parts.length ? parts.join(', ') : 'nothing selected';
}

export function blockingReason(b: { noAsset: number; duplicates: number }): string | null {
  if (b.noAsset > 0) {
    return `${b.noAsset} ${b.noAsset === 1 ? 'trial needs' : 'trials need'} an asset`;
  }
  if (b.duplicates > 0) {
    return `${b.duplicates} duplicate ${b.duplicates === 1 ? 'trial' : 'trials'} in this batch`;
  }
  return null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test:units -- review-grid.logic`
Expected: PASS (full file green).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/source-import/review-grid.logic.ts src/app/features/source-import/review-grid.logic.spec.ts
git commit -m "Add readable selection summary and blocking reason logic"
```

---

## Task 5: Component — build TreeNode rows from the proposal and remove the spike

**Files:**
- Modify: `src/app/features/source-import/review-page.component.ts`

Build the TreeTable's `TreeNode[]` from the existing `hierarchicalTree()` plus
the Task 2-3 logic. Remove the Task 1 spike.

- [ ] **Step 1: Remove the spike block**

Delete the `<!-- SPIKE -->` `<p-treeTable>` block from the template and the
`spikeNodes` / `spikeExpanded` / `spikeToggle` members from the class.

- [ ] **Step 2: Add a row-model type and a `gridNodes` computed**

In the class, import the logic and add a `computed` that maps companies/assets/
trials into `TreeNode`s. Each node's `data` is a flat row object the template
renders. Add near the other computed signals:

```ts
import {
  entityState, deriveTrialFlags, deriveAssetFlags,
  duplicateTrialIndexes, deriveCtgovFlag, deriveFuzzyFlag,
  readableSummary, blockingReason, ReviewFlag,
} from './review-grid.logic';

interface GridRow {
  key: string;            // entityKey, e.g. "trials_2"
  type: EntityType;
  idx: number;
  kind: 'company' | 'asset' | 'trial';
  name: string;
  state: 'new' | 'existing';
  phase: string | null;
  status: string | null;
  moaRoa: string;
  indication: string | null;
  flags: ReviewFlag[];
  hasDetail: boolean;
}
```

```ts
protected readonly gridNodes = computed<TreeNode[]>(() => {
  const tree = this.hierarchicalTree();
  const trials = this.entitiesOf('trials');
  const dupes = duplicateTrialIndexes(trials);

  const trialRow = (idx: number): TreeNode => {
    const t = trials[idx];
    const flags = [
      ...deriveTrialFlags(t),
      deriveCtgovFlag(this.ctgovCandidatesFor(idx).length),
      deriveFuzzyFlag(this.fuzzyAlternatesFor('trials', idx).length),
    ].filter((f): f is ReviewFlag => f !== null);
    if (dupes.has(idx)) flags.unshift({ id: 'duplicate', tier: 'blocking', label: 'Duplicate in batch' });
    return {
      key: this.entityKey('trials', idx),
      data: {
        key: this.entityKey('trials', idx), type: 'trials', idx, kind: 'trial',
        name: this.entityName('trials', idx),
        state: entityState(t),
        phase: this.trialPhase(idx), status: this.trialStatus(idx),
        moaRoa: '', indication: (t['indication'] as string) ?? null,
        flags, hasDetail: flags.length > 0 || this.editableFields('trials', idx).length > 0,
      } as GridRow,
    };
  };

  const assetRow = (an: { assetIdx: number; trials: { trialIdx: number }[] }): TreeNode => {
    const idx = an.assetIdx;
    const a = this.entitiesOf('assets')[idx];
    const flags = [
      ...deriveAssetFlags(a),
      deriveFuzzyFlag(this.fuzzyAlternatesFor('assets', idx).length),
    ].filter((f): f is ReviewFlag => f !== null);
    return {
      key: this.entityKey('assets', idx),
      expanded: true,
      data: {
        key: this.entityKey('assets', idx), type: 'assets', idx, kind: 'asset',
        name: this.entityName('assets', idx),
        state: entityState(a),
        phase: null, status: null,
        moaRoa: [...this.assetMoas(idx), ...this.assetRoas(idx)].join(' / '),
        indication: null,
        flags, hasDetail: flags.length > 0 || this.editableFields('assets', idx).length > 0,
      } as GridRow,
      children: an.trials.map((tn) => trialRow(tn.trialIdx)),
    };
  };

  return tree.companies.map((cn) => ({
    key: this.entityKey('companies', cn.companyIdx),
    expanded: true,
    data: {
      key: this.entityKey('companies', cn.companyIdx), type: 'companies', idx: cn.companyIdx,
      kind: 'company', name: this.entityName('companies', cn.companyIdx),
      state: entityState(this.entitiesOf('companies')[cn.companyIdx]),
      phase: null, status: null, moaRoa: '', indication: null,
      flags: [], hasDetail: false,
    } as GridRow,
    children: cn.assets.map((an) => assetRow(an)),
  }));
});
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npx ng build`
Expected: build succeeds (the computed is not yet used by the template; that is Task 6). If TS complains about unused, temporarily reference it in the existing template with `@if (gridNodes()) {}` — removed in Task 6.

- [ ] **Step 4: Commit**

```bash
git add src/app/features/source-import/review-page.component.ts
git commit -m "Build TreeTable row nodes from proposal and review logic"
```

---

## Task 6: Component — replace the tree template with the TreeTable grid

**Files:**
- Modify: `src/app/features/source-import/review-page.component.ts`

Swap the hand-rolled `@for` company/asset/trial blocks (and the `#entityRow`
`ng-template`) for the TreeTable. Keep the header, warnings, dropped disclosure,
orphan markers/events sections, and footer.

- [ ] **Step 1: Replace the hierarchical tree markup**

Remove the `@for (cn of tree.companies …)` block (the company card loop). Replace
with the TreeTable bound to `gridNodes()`. Columns: select, entity (with toggler
+ indent + state tag + flag chips), type, phase, status, MOA/ROA, indication,
source, and an inline detail row gated on a per-row expansion signal.

```html
<p-treeTable [value]="gridNodes()" dataKey="key" [scrollable]="true">
  <ng-template pTemplate="header">
    <tr class="font-mono text-[10px] uppercase tracking-[0.06em] text-slate-400">
      <th class="w-10"></th>
      <th>Entity</th><th>Type</th><th>Phase</th><th>Status</th>
      <th>MOA / ROA</th><th>Indication</th><th>Source</th>
    </tr>
  </ng-template>
  <ng-template pTemplate="body" let-rowNode let-row="rowData">
    <tr
      [class.opacity-50]="!isSelected(row.key)"
      [class.bg-amber-50]="hasBlockingFlag(row)"
    >
      <td>
        <p-checkbox [ngModel]="isSelected(row.key)" (ngModelChange)="toggleSelection(row.key, $event)" [binary]="true" size="small" />
      </td>
      <td>
        <div class="flex items-center gap-2">
          <p-treeTableToggler [rowNode]="rowNode" />
          <span
            class="truncate"
            [class.font-mono]="row.kind === 'company'"
            [class.font-bold]="row.kind === 'company'"
            [class.uppercase]="row.kind === 'company'"
            [class.font-semibold]="row.kind === 'asset'"
            [class.text-brand-600]="row.kind === 'trial'"
          >{{ row.name }}</span>
          @if (row.state === 'existing') {
            <span class="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500">existing</span>
          }
          @for (f of row.flags; track f.id) {
            <span
              class="rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase"
              [class.bg-amber-50]="true"
              [class.border-amber-200]="true"
              [class.text-amber-700]="true"
            >{{ f.label }}</span>
          }
          @if (row.hasDetail) {
            <button type="button" class="ml-auto text-slate-400 hover:text-brand-600"
              [attr.aria-expanded]="isDetailOpen(row.key)"
              (click)="toggleDetail(row.key)"
              pTooltip="Show review detail" tooltipPosition="top">
              <i class="pi" [class.pi-chevron-down]="isDetailOpen(row.key)" [class.pi-chevron-right]="!isDetailOpen(row.key)"></i>
            </button>
          }
        </div>
      </td>
      <td class="font-mono text-[10px] uppercase text-slate-400">{{ row.type === 'companies' ? '' : row.kind }}</td>
      <td>
        @if (row.phase) {
          <span class="rounded border border-brand-200 bg-brand-50 px-1 py-0.5 font-mono text-[10px] uppercase text-brand-700">{{ row.phase }}</span>
        }
      </td>
      <td class="text-slate-500">{{ row.status }}</td>
      <td class="text-slate-500">{{ row.moaRoa }}</td>
      <td class="text-slate-500">{{ row.indication }}</td>
      <td>
        @if (row.kind === 'trial') {
          <span class="rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-cyan-700">ct.gov</span>
        }
      </td>
    </tr>
    @if (isDetailOpen(row.key)) {
      <tr>
        <td></td>
        <td [attr.colspan]="7">
          <ng-container [ngTemplateOutlet]="rowDetail" [ngTemplateOutletContext]="{ type: row.type, idx: row.idx, key: row.key }" />
        </td>
      </tr>
    }
  </ng-template>
</p-treeTable>
```

- [ ] **Step 2: Add a `#rowDetail` template reusing existing affordances**

Above the TreeTable, add a `#rowDetail` `ng-template` that contains, in this order
(reusing the existing markup blocks lifted from `#entityRow`): the CT.gov
candidate radio picker (`ctgovCandidatesFor`, `getTrialNctOverride`,
`setTrialNctOverride`), the fuzzy alternate chips (`fuzzyAlternatesFor`,
`getMatchOverride`, `setMatchOverride`, `clearMatchOverride`), the
missing-asset `p-message`, and the inline `editableFields` inputs (which include
`indication`). Lift these blocks verbatim from the current `#entityRow` template
(lines ~412-549) so behaviour is preserved.

- [ ] **Step 3: Add the detail-expansion state and helpers to the class**

```ts
protected readonly openDetails = signal<Record<string, boolean>>({});
protected isDetailOpen(key: string): boolean { return this.openDetails()[key] ?? false; }
protected toggleDetail(key: string): void {
  this.openDetails.update((o) => ({ ...o, [key]: !o[key] }));
}
protected hasBlockingFlag(row: GridRow): boolean {
  return row.flags.some((f) => f.tier === 'blocking');
}
```

- [ ] **Step 4: Fix `isObservationalTrial` to use study_type**

Replace the body of `isObservationalTrial` (line 1140) so it matches the logic
module rather than the `asset_ref` proxy:

```ts
protected isObservationalTrial(idx: number): boolean {
  const trial = this.entitiesOf('trials')[idx];
  return String(trial?.['study_type'] ?? '').toLowerCase().includes('observational');
}
```

- [ ] **Step 5: Delete the now-dead `#entityRow` template and `hierarchicalTree` consumers if unused**

Remove the `#entityRow` `ng-template` only after its reusable blocks were lifted
into `#rowDetail`. Keep `hierarchicalTree()` (still used by `gridNodes`).

- [ ] **Step 6: Build and lint**

Run: `npx ng build && npx ng lint`
Expected: build succeeds; lint shows no NEW errors (pre-existing `trial.service.ts` warning is acceptable).

- [ ] **Step 7: Verify in the browser**

Run the importer flow to the review screen. Confirm: companies group with assets
nested and trials nested under assets; only flagged/editable rows show a detail
chevron; the existing tag shows on existing matches; new rows carry no badge;
indication shows in its column; the ct.gov picker still works in the detail row.

- [ ] **Step 8: Commit**

```bash
git add src/app/features/source-import/review-page.component.ts
git commit -m "Replace import-review tree with grouped TreeTable grid"
```

---

## Task 7: Component — readable footer and blocking gate

**Files:**
- Modify: `src/app/features/source-import/review-page.component.ts`

- [ ] **Step 1: Add a `footerSummary` and `blockingMessage` computed**

```ts
protected readonly footerSummary = computed(() => {
  const sel = this.selections();
  const count = (type: EntityType) =>
    Object.entries(sel).filter(([k, v]) => v && k.startsWith(`${type}_`)).length;
  return readableSummary({
    companies: count('companies'), assets: count('assets'), trials: count('trials'),
    markers: count('markers'), events: count('events'),
  });
});

protected readonly blockingMessage = computed(() => {
  const trials = this.entitiesOf('trials');
  const dupes = duplicateTrialIndexes(trials);
  let noAsset = 0;
  trials.forEach((t, idx) => {
    if (this.isSelected(this.entityKey('trials', idx)) && this.trialMissingAsset(t)) noAsset++;
  });
  let duplicates = 0;
  dupes.forEach((idx) => { if (this.isSelected(this.entityKey('trials', idx))) duplicates++; });
  return blockingReason({ noAsset, duplicates });
});
```

- [ ] **Step 2: Update the footer template**

Replace the `{{ selectedCount() }} of {{ totalCount() }} selected ({{ selectionSummary() }})`
line with:

```html
<span class="text-xs text-slate-500">
  {{ selectedCount() }} of {{ totalCount() }} selected: {{ footerSummary() }}
</span>
@if (blockingMessage(); as msg) {
  <span class="text-xs text-amber-700">{{ msg }}</span>
}
```

- [ ] **Step 3: Gate `canConfirm` on duplicates too**

Update `canConfirm()` to also fail when a selected trial is a within-batch
duplicate:

```ts
protected canConfirm(): boolean {
  if (this.selectedCount() === 0) return false;
  const trials = this.entitiesOf('trials');
  const dupes = duplicateTrialIndexes(trials);
  for (let idx = 0; idx < trials.length; idx++) {
    if (!this.isSelected(this.entityKey('trials', idx))) continue;
    if (this.trialMissingAsset(trials[idx])) return false;
    if (dupes.has(idx)) return false;
  }
  return true;
}
```

- [ ] **Step 4: Build, lint, and verify**

Run: `npx ng build && npx ng lint`
Expected: succeeds. In the browser, footer reads e.g. "15 of 15 selected: 3 companies, 6 assets, 6 trials".

- [ ] **Step 5: Commit**

```bash
git add src/app/features/source-import/review-page.component.ts
git commit -m "Readable footer summary and duplicate-aware confirm gate"
```

---

## Task 8: Component — the All / Needs review / New filter

**Files:**
- Modify: `src/app/features/source-import/review-page.component.ts`

- [ ] **Step 1: Add a filter signal and a filtered nodes computed**

```ts
protected readonly gridFilter = signal<'all' | 'flagged' | 'new'>('all');

protected readonly filteredNodes = computed<TreeNode[]>(() => {
  const f = this.gridFilter();
  if (f === 'all') return this.gridNodes();
  const keep = (row: GridRow) =>
    f === 'flagged' ? row.flags.length > 0 : row.state === 'new';
  // Keep a parent if it or any descendant matches; preserves linkage context.
  const filterNode = (node: TreeNode): TreeNode | null => {
    const children = (node.children ?? []).map(filterNode).filter((n): n is TreeNode => n !== null);
    const selfKeep = keep(node.data as GridRow);
    if (!selfKeep && children.length === 0) return null;
    return { ...node, children, expanded: true };
  };
  return this.gridNodes().map(filterNode).filter((n): n is TreeNode => n !== null);
});
```

- [ ] **Step 2: Point the TreeTable at `filteredNodes()`**

Change `[value]="gridNodes()"` to `[value]="filteredNodes()"` in the template.

- [ ] **Step 3: Add the segmented filter control to the toolbar**

Add above the TreeTable (and below the warnings/dropped blocks):

```html
<div class="mb-3 inline-flex rounded border border-slate-200 bg-white text-xs">
  @for (opt of filterOptions; track opt.value) {
    <button type="button"
      class="border-r border-slate-200 px-3 py-1.5 last:border-r-0"
      [class.bg-brand-50]="gridFilter() === opt.value"
      [class.text-brand-800]="gridFilter() === opt.value"
      [class.font-semibold]="gridFilter() === opt.value"
      [class.text-slate-500]="gridFilter() !== opt.value"
      (click)="gridFilter.set(opt.value)"
    >{{ opt.label }}</button>
  }
</div>
```

Add to the class:

```ts
protected readonly filterOptions = [
  { value: 'all' as const, label: 'All' },
  { value: 'flagged' as const, label: 'Needs review' },
  { value: 'new' as const, label: 'New' },
];
```

- [ ] **Step 4: Build, lint, verify**

Run: `npx ng build && npx ng lint`
Expected: succeeds. In the browser, "Needs review" collapses the grid to flagged
rows plus their parent assets/companies; "All" restores the full grid.

- [ ] **Step 5: Commit**

```bash
git add src/app/features/source-import/review-page.component.ts
git commit -m "Add All / Needs review / New filter to import-review grid"
```

---

## Task 9: Cleanup, full verification, and dead-code removal

**Files:**
- Modify: `src/app/features/source-import/review-page.component.ts`

- [ ] **Step 1: Remove now-unused members**

Delete `selectionSummary()` (replaced by `footerSummary`) and `collapsedRows` /
`isCollapsed` / `toggleCollapsed` if the new template no longer uses them (the
old per-trial collapse was for the NCT-import layout being replaced). Confirm
each is unreferenced with a grep before deleting:

Run: `grep -n "selectionSummary\|collapsedRows\|isCollapsed\|toggleCollapsed" src/app/features/source-import/review-page.component.ts`
Delete only those with no template/class references remaining.

- [ ] **Step 2: Full unit suite**

Run: `npm run test:units`
Expected: all pass, including the new `review-grid.logic` cases.

- [ ] **Step 3: Full build + lint**

Run: `npx ng build && npx ng lint`
Expected: build clean; no new lint errors.

- [ ] **Step 4: Confirm no proposal-shape or commit-path change**

Run: `git diff --stat develop -- src/app/features/source-import/`
Expected: only `review-page.component.ts`, `review-grid.logic.ts`,
`review-grid.logic.spec.ts` changed. `source-import.service.ts` and any commit
RPC are untouched (indication flows through the existing `editableFields` ->
`buildCommitProposal` path unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/features/source-import/review-page.component.ts
git commit -m "Remove dead import-review members after grid migration"
```

---

## Task 10: Docs and final review

**Files:**
- Modify: help/runbook only if drift detected (likely none)

- [ ] **Step 1: Check for help-page drift**

The redesign is presentational and touches `features/source-import`. Confirm
whether any help page references the import-review layout:

Run: `grep -rni "review import\|import proposal" src/app/features/help docs/runbook 2>/dev/null`
If a help/runbook page describes the old layout, update its prose (outside any
AUTO-GEN markers). If none, no doc change is needed (no schema/RPC/route change,
so no `docs:arch` regen).

- [ ] **Step 2: Run the request-code-review skill**

Use superpowers:requesting-code-review against the branch diff before finishing.

- [ ] **Step 3: Final commit if docs changed**

```bash
git add -A
git commit -m "Docs: note import-review grouped-grid layout"
```

---

## Self-review notes (author)

- Spec coverage: signal economy (Tasks 2,6), grouped grid + nesting + row-expand
  (Tasks 1,5,6), flag taxonomy incl. blocking/attention/info (Tasks 2,3,7),
  indication in-scope as attribute + flag (Tasks 2,5,6), observational study_type
  fix (Task 6), filters (Task 8), readable footer + blocking gate (Task 7),
  duplicate detection (Tasks 3,7). All covered.
- TreeTable decision locked; Task 1 is the de-risking spike with a Table fallback
  noted inline.
- Tests pair with each behavioural task (Tasks 2-4 are pure-logic TDD; component
  template tasks are verified by build + browser, consistent with this repo where
  `test:units` is node-environment pure-logic only and DOM specs are Playwright).
- No backend change: Task 9 Step 4 asserts the proposal/commit path is untouched.
