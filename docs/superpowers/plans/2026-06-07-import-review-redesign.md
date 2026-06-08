# Import Review Grid Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the import review grid's ad-hoc inline editing (free-text reference data, bespoke chip+star control, resizable columns, inconsistent name-links) with a clean read-only grid whose rows open a dialog that reuses the app's real form controls, operating on the in-memory proposal.

**Architecture:** Extract the Manage form bodies into three presentational components (`CompanyEditForm`, `AssetEditForm`, `TrialEditForm`) with no persistence; Manage dialogs and a new review-edit dialog both consume them. The review dialog sources options from the proposal (space records ∪ proposed entities), edits via pure mapping functions in `review-edit.logic.ts`, and writes back to `SourceImportService`. Confirm/commit is unchanged.

**Tech Stack:** Angular 19 (standalone, signals, OnPush), PrimeNG 21 (Select/MultiSelect/DatePicker/InputText/InputNumber), Tailwind v4, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-07-import-review-redesign-design.md`

**Working dir:** `src/client`. Run unit tests with `npm run test:units`. Lint/build with `npx ng lint && npx ng build --configuration local`. A local review-grid repro harness (auth + seeded space + injected proposal) is documented at the end of this plan.

**Decisions baked in (stated defaults, not open questions):**
- NCT identifier is **read-only** in the review trial dialog (identity comes from the import; change identity via the Match control). The Manage trial dialog keeps NCT editable as today.
- Trial **status** is not editable (Manage's trial dialog has no status control); it stays a read-only grid column carrying the proposed value.
- **Indication** is a working `Select` of (space indications ∪ proposed value), value = the indication **name**; `commit_source_import` resolves create/match by name. The Manage trial dialog keeps its current behaviour (indication shown but not persisted) — do not change Manage's save.

---

## File Structure

Create:
- `src/app/features/source-import/review-edit.logic.ts` — pure proposal⇄form mappings, option builders, match-override application.
- `src/app/features/source-import/review-edit.logic.spec.ts` — unit tests for the above.
- `src/app/features/source-import/review-edit-dialog.component.ts` — review-side dialog hosting a form body by entity type + the Match control; reads/writes the proposal.
- `src/app/features/manage/companies/company-edit-form.component.ts` — presentational company form body.
- `src/app/features/manage/assets/asset-edit-form.component.ts` — presentational asset form body.
- `src/app/features/manage/trials/trial-edit-form.component.ts` — presentational trial form body.

Modify:
- `src/app/features/manage/companies/company-form.component.{ts,html}` — consume `CompanyEditFormComponent`.
- `src/app/features/manage/assets/asset-form.component.{ts,html}` — consume `AssetEditFormComponent`.
- `src/app/features/manage/trials/trial-edit-dialog.component.{ts,html}` and `trial-create-dialog.component.{ts,html}` — consume `TrialEditFormComponent`.
- `src/app/features/source-import/review-page.component.ts` — read-only grid + Edit actions; remove inline editing, name-links, resize, rowDetail editing controls; remove now-dead helpers.
- `src/app/features/source-import/review-grid.logic.ts` + `.spec.ts` — remove `resolveEntityLink`/`trialIsMultiAsset` and their tests if no longer referenced (verify with grep first).
- `src/app/shared/styles/primeng-overrides.css` — remove the TreeTable resize block (keep `p-treetable { display: block }` only if the grid still needs it).

---

## Task 1: Pure logic — option builders + trial mapping

**Files:**
- Create: `src/app/features/source-import/review-edit.logic.ts`
- Test: `src/app/features/source-import/review-edit.logic.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest';
import {
  type FormOption,
  assetOptionsFromProposal,
  companyOptionsFromProposal,
  proposalTrialToForm,
  applyTrialForm,
} from './review-edit.logic';

const proposal = () => ({
  proposals: {
    companies: [{ match: { kind: 'existing', id: 'co-1' }, name: 'Lilly' }],
    assets: [
      { match: { kind: 'existing', id: 'as-t' }, name: 'Tirzepatide', company_ref: 0 },
      { match: { kind: 'new', name: 'Retatrutide' }, name: 'Retatrutide', company_ref: 0 },
    ],
    trials: [
      { match: { kind: 'new', name: 'NCT07165028' }, name: 'SYNERGY-Outcomes', identifier: 'NCT07165028',
        phase: 'P3', status: 'Active', indication: 'MASLD', asset_refs: [0, 1], primary_asset_ref: 0,
        phase_start_date: '2025-10-15', phase_end_date: null },
    ],
  },
});

describe('option builders', () => {
  it('asset options are indexed by position with display names', () => {
    expect(assetOptionsFromProposal(proposal())).toEqual<FormOption[]>([
      { id: '0', name: 'Tirzepatide' },
      { id: '1', name: 'Retatrutide' },
    ]);
  });
  it('company options are indexed by position', () => {
    expect(companyOptionsFromProposal(proposal())).toEqual<FormOption[]>([{ id: '0', name: 'Lilly' }]);
  });
});

describe('proposalTrialToForm', () => {
  it('maps refs to string ids and carries fields', () => {
    expect(proposalTrialToForm(0, proposal())).toEqual({
      name: 'SYNERGY-Outcomes',
      identifier: 'NCT07165028',
      assetIds: ['0', '1'],
      primaryAssetId: '0',
      indication: 'MASLD',
      phase: 'P3',
      phaseStart: '2025-10-15',
      phaseEnd: null,
    });
  });
  it('falls back primary to first ref when unset', () => {
    const p = proposal();
    delete (p.proposals.trials[0] as Record<string, unknown>)['primary_asset_ref'];
    expect(proposalTrialToForm(0, p).primaryAssetId).toBe('0');
  });
});

describe('applyTrialForm', () => {
  it('writes refs back as numbers and updates editable fields, leaving status/match intact', () => {
    const p = proposal();
    const next = applyTrialForm(
      { name: 'SYNERGY-Outcomes', identifier: 'NCT07165028', assetIds: ['1'], primaryAssetId: '1',
        indication: 'NASH', phase: 'P2', phaseStart: null, phaseEnd: null },
      0,
      p,
    );
    const t = next.proposals.trials[0] as Record<string, unknown>;
    expect(t['asset_refs']).toEqual([1]);
    expect(t['primary_asset_ref']).toBe(1);
    expect(t['indication']).toBe('NASH');
    expect(t['phase']).toBe('P2');
    expect(t['status']).toBe('Active'); // untouched
    expect(t['match']).toEqual({ kind: 'new', name: 'NCT07165028' }); // untouched
    // input proposal not mutated
    expect((p.proposals.trials[0] as Record<string, unknown>)['asset_refs']).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `npm run test:units -- review-edit.logic` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// Pure proposal⇄form logic for the import-review edit dialog. No Angular imports;
// unit-tested via vitest. The proposal shape is the in-memory SourceImportProposal.

export interface FormOption {
  id: string;
  name: string;
}

type Entity = Record<string, unknown>;
interface Proposal {
  proposals: { companies: Entity[]; assets: Entity[]; trials: Entity[] };
}

export interface TrialFormValue {
  name: string;
  identifier: string | null;
  assetIds: string[];
  primaryAssetId: string | null;
  indication: string | null;
  phase: string | null;
  phaseStart: string | null;
  phaseEnd: string | null;
}

function entityName(e: Entity): string {
  return String(e['name'] ?? e['title'] ?? '');
}

export function assetOptionsFromProposal(p: Proposal): FormOption[] {
  return p.proposals.assets.map((a, i) => ({ id: String(i), name: entityName(a) }));
}

export function companyOptionsFromProposal(p: Proposal): FormOption[] {
  return p.proposals.companies.map((c, i) => ({ id: String(i), name: entityName(c) }));
}

function rawRefs(t: Entity): number[] {
  const refs = t['asset_refs'];
  if (Array.isArray(refs)) return refs.filter((r): r is number => typeof r === 'number');
  const single = t['asset_ref'];
  return typeof single === 'number' ? [single] : [];
}

export function proposalTrialToForm(idx: number, p: Proposal): TrialFormValue {
  const t = p.proposals.trials[idx];
  const refs = rawRefs(t);
  const primary = t['primary_asset_ref'];
  return {
    name: String(t['name'] ?? ''),
    identifier: (t['identifier'] as string) ?? null,
    assetIds: refs.map(String),
    primaryAssetId:
      typeof primary === 'number' ? String(primary) : refs.length ? String(refs[0]) : null,
    indication: (t['indication'] as string) ?? null,
    phase: (t['phase'] as string) ?? null,
    phaseStart: (t['phase_start_date'] as string) ?? null,
    phaseEnd: (t['phase_end_date'] as string) ?? null,
  };
}

export function applyTrialForm(value: TrialFormValue, idx: number, p: Proposal): Proposal {
  const trials = p.proposals.trials.map((t, i) => {
    if (i !== idx) return t;
    return {
      ...t,
      name: value.name,
      asset_refs: value.assetIds.map(Number),
      primary_asset_ref: value.primaryAssetId != null ? Number(value.primaryAssetId) : null,
      indication: value.indication,
      phase: value.phase,
      phase_start_date: value.phaseStart,
      phase_end_date: value.phaseEnd,
    };
  });
  return { ...p, proposals: { ...p.proposals, trials } };
}
```

- [ ] **Step 4: Run, verify pass** — `npm run test:units -- review-edit.logic` → PASS.
- [ ] **Step 5: Commit** — `git add src/app/features/source-import/review-edit.logic.* && git commit -m "Add review-edit pure logic: option builders + trial mapping"`

---

## Task 2: Pure logic — asset + company mapping

**Files:** Modify `review-edit.logic.ts` and its spec.

- [ ] **Step 1: Write failing tests** (append to spec)

```ts
import { proposalAssetToForm, applyAssetForm, proposalCompanyToForm, applyCompanyForm } from './review-edit.logic';

describe('asset mapping', () => {
  const p = () => ({ proposals: { companies: [{ match: { kind: 'existing', id: 'co' }, name: 'Lilly' }],
    assets: [{ match: { kind: 'new', name: 'Retatrutide' }, name: 'Retatrutide', generic_name: 'reta',
      company_ref: 0, moa: ['tri-agonist'], roa: ['Subcutaneous'] }], trials: [] } });
  it('maps to form value with company id and moa/roa names', () => {
    expect(proposalAssetToForm(0, p())).toEqual({
      name: 'Retatrutide', genericName: 'reta', companyId: '0', moa: ['tri-agonist'], roa: ['Subcutaneous'],
    });
  });
  it('writes form back without mutating input', () => {
    const src = p();
    const next = applyAssetForm({ name: 'Reta', genericName: null, companyId: '0', moa: ['X'], roa: [] }, 0, src);
    const a = next.proposals.assets[0] as Record<string, unknown>;
    expect(a['name']).toBe('Reta'); expect(a['moa']).toEqual(['X']); expect(a['roa']).toEqual([]);
    expect((src.proposals.assets[0] as Record<string, unknown>)['name']).toBe('Retatrutide');
  });
});

describe('company mapping', () => {
  const p = () => ({ proposals: { companies: [{ match: { kind: 'new', name: 'Lilly' }, name: 'Lilly', website: 'x.com' }], assets: [], trials: [] } });
  it('round-trips name + website', () => {
    expect(proposalCompanyToForm(0, p())).toEqual({ name: 'Lilly', website: 'x.com' });
    const next = applyCompanyForm({ name: 'Eli Lilly', website: null }, 0, p());
    expect((next.proposals.companies[0] as Record<string, unknown>)['name']).toBe('Eli Lilly');
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** (append to `review-edit.logic.ts`)

```ts
export interface AssetFormValue {
  name: string;
  genericName: string | null;
  companyId: string | null;
  moa: string[];
  roa: string[];
}

export function proposalAssetToForm(idx: number, p: Proposal): AssetFormValue {
  const a = p.proposals.assets[idx];
  const cref = a['company_ref'];
  return {
    name: String(a['name'] ?? ''),
    genericName: (a['generic_name'] as string) ?? null,
    companyId: typeof cref === 'number' ? String(cref) : null,
    moa: Array.isArray(a['moa']) ? (a['moa'] as string[]) : [],
    roa: Array.isArray(a['roa']) ? (a['roa'] as string[]) : [],
  };
}

export function applyAssetForm(value: AssetFormValue, idx: number, p: Proposal): Proposal {
  const assets = p.proposals.assets.map((a, i) =>
    i !== idx
      ? a
      : {
          ...a,
          name: value.name,
          generic_name: value.genericName,
          company_ref: value.companyId != null ? Number(value.companyId) : null,
          moa: value.moa,
          roa: value.roa,
        },
  );
  return { ...p, proposals: { ...p.proposals, assets } };
}

export interface CompanyFormValue {
  name: string;
  website: string | null;
}

export function proposalCompanyToForm(idx: number, p: Proposal): CompanyFormValue {
  const c = p.proposals.companies[idx];
  return { name: String(c['name'] ?? ''), website: (c['website'] as string) ?? null };
}

export function applyCompanyForm(value: CompanyFormValue, idx: number, p: Proposal): Proposal {
  const companies = p.proposals.companies.map((c, i) =>
    i !== idx ? c : { ...c, name: value.name, website: value.website },
  );
  return { ...p, proposals: { ...p.proposals, companies } };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "Add review-edit asset + company mapping"`

---

## Task 3: Pure logic — match options + override

Match resolution moves into the dialog. The proposal stores fuzzy candidates in
`proposal.fuzzy_alternates['<type>_<idx>']` (`{id,name,score}[]`) and the chosen match in the
entity's `match` (`{kind:'new', name}` or `{kind:'existing', id}`).

**Files:** Modify `review-edit.logic.ts` and its spec.

- [ ] **Step 1: Write failing tests** (append)

```ts
import { matchOptionsFor, currentMatchId, applyMatchOverride } from './review-edit.logic';

const fp = () => ({
  proposals: { companies: [], assets: [{ match: { kind: 'new', name: 'Reta' }, name: 'Reta' }], trials: [] },
  fuzzy_alternates: { assets_0: [{ id: 'as-9', name: 'Retatrutide (existing)', score: 0.82 }] },
});

describe('match options', () => {
  it('offers create-new plus fuzzy candidates with scores', () => {
    expect(matchOptionsFor('assets', 0, fp())).toEqual([
      { id: '__new__', name: 'Create new: Reta' },
      { id: 'as-9', name: 'Retatrutide (existing) (0.82)' },
    ]);
  });
  it('current match id is __new__ for a new entity', () => {
    expect(currentMatchId('assets', 0, fp())).toBe('__new__');
  });
  it('applies an existing override and clears it back to new', () => {
    const linked = applyMatchOverride('assets', 0, 'as-9', fp());
    expect((linked.proposals.assets[0] as Record<string, unknown>)['match']).toEqual({ kind: 'existing', id: 'as-9' });
    const reset = applyMatchOverride('assets', 0, '__new__', linked);
    expect((reset.proposals.assets[0] as Record<string, unknown>)['match']).toEqual({ kind: 'new', name: 'Reta' });
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** (append; note the proposal type now includes `fuzzy_alternates`)

```ts
type EntityType = 'companies' | 'assets' | 'trials';
interface FuzzyAlt { id: string; name: string; score: number; }
interface ProposalWithFuzzy extends Proposal {
  fuzzy_alternates?: Record<string, FuzzyAlt[]>;
}

export function matchOptionsFor(type: EntityType, idx: number, p: ProposalWithFuzzy): FormOption[] {
  const e = p.proposals[type][idx];
  const alts = p.fuzzy_alternates?.[`${type}_${idx}`] ?? [];
  return [
    { id: '__new__', name: `Create new: ${entityName(e)}` },
    ...alts.map((a) => ({ id: a.id, name: `${a.name} (${a.score.toFixed(2)})` })),
  ];
}

export function currentMatchId(type: EntityType, idx: number, p: ProposalWithFuzzy): string {
  const m = p.proposals[type][idx]['match'] as { kind?: string; id?: string } | undefined;
  return m?.kind === 'existing' && m.id ? m.id : '__new__';
}

export function applyMatchOverride(
  type: EntityType,
  idx: number,
  optionId: string,
  p: ProposalWithFuzzy,
): ProposalWithFuzzy {
  const list = p.proposals[type].map((e, i) => {
    if (i !== idx) return e;
    const match =
      optionId === '__new__' ? { kind: 'new', name: entityName(e) } : { kind: 'existing', id: optionId };
    return { ...e, match };
  });
  return { ...p, proposals: { ...p.proposals, [type]: list } };
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -am "Add review-edit match options + override logic"`

---

## Task 4: Extract `CompanyEditFormComponent` (simplest; proves the pattern)

The existing `company-form.component` has 3 fields (name, logoUrl, displayOrder) using
`FormFieldComponent` + InputText + InputNumber. Extract the field markup into a presentational
component; `company-form` keeps load/save and renders the new component.

**Files:**
- Create: `src/app/features/manage/companies/company-edit-form.component.{ts,html}`
- Modify: `company-form.component.{ts,html}`

- [ ] **Step 1: Create the presentational component.** Contract:

```ts
@Component({
  selector: 'app-company-edit-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, InputText, InputNumber, FormFieldComponent],
  templateUrl: './company-edit-form.component.html',
})
export class CompanyEditFormComponent {
  readonly name = model<string>('');
  readonly logoUrl = model<string>('');
  readonly displayOrder = model<number | null>(null);
  readonly nameInvalid = input<boolean>(false);
}
```

Move the three `app-form-field` blocks from `company-form.component.html` into
`company-edit-form.component.html`, binding `[(ngModel)]="name"` etc. to the models.

- [ ] **Step 2: Migrate `company-form`.** Replace the inline fields in `company-form.component.html` with
  `<app-company-edit-form [(name)]="name" [(logoUrl)]="logoUrl" [(displayOrder)]="displayOrder" [nameInvalid]="nameInvalid()" />`. Keep all existing signals, validation, and save logic. Add `CompanyEditFormComponent` to imports.

- [ ] **Step 3: Verify Manage company create/edit unchanged.** Run `npx ng build --configuration local` → success. Then in the app (or repro harness) open Manage > Companies → Add/Edit, confirm fields render and save works. Run `npm run test:units` → green.

- [ ] **Step 4: Commit** — `git commit -am "Extract CompanyEditFormComponent; migrate company-form"`

---

## Task 5: Extract `AssetEditFormComponent`

`asset-form.component` fields: name, genericName, company (Select), logoUrl, MOA (MultiSelect),
ROA (MultiSelect), displayOrder. Extract the field markup; `asset-form` keeps option loading +
save (`create_asset`, `update_asset_mechanisms`, `update_asset_routes`).

**Files:**
- Create: `src/app/features/manage/assets/asset-edit-form.component.{ts,html}`
- Modify: `asset-form.component.{ts,html}`

- [ ] **Step 1: Create presentational component.** Contract:

```ts
@Component({
  selector: 'app-asset-edit-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, InputText, InputNumber, Select, MultiSelect, FormFieldComponent],
  templateUrl: './asset-edit-form.component.html',
})
export class AssetEditFormComponent {
  readonly name = model<string>('');
  readonly genericName = model<string>('');
  readonly companyId = model<string | null>(null);
  readonly logoUrl = model<string>('');
  readonly moaIds = model<string[]>([]);
  readonly roaIds = model<string[]>([]);
  readonly displayOrder = model<number | null>(null);
  readonly companyOptions = input<{ id: string; name: string }[]>([]);
  readonly moaOptions = input<{ id: string; name: string }[]>([]);
  readonly roaOptions = input<{ id: string; name: string }[]>([]);
  readonly nameInvalid = input<boolean>(false);
  readonly showDisplayOrder = input<boolean>(true); // hide in review dialog
}
```

Move the field markup from `asset-form.component.html` into the new template, binding models +
`[options]` from the inputs. MultiSelect change handlers must coalesce null → [] (existing pattern).

- [ ] **Step 2: Migrate `asset-form`.** Replace inline fields with `<app-asset-edit-form ...>` wiring its
  existing signals and the option signals (`companies`, `moaOptions`, `roaOptions`). Keep save logic.

- [ ] **Step 3: Verify** — build green; Manage > Assets Add/Edit renders + saves (incl. MOA/ROA); `npm run test:units` green.
- [ ] **Step 4: Commit** — `git commit -am "Extract AssetEditFormComponent; migrate asset-form"`

---

## Task 6: Extract `TrialEditFormComponent`

`trial-edit-dialog` form: name, NCT (InputText), assets (MultiSelect), primary (Select, shown
when >1 asset), indication (Select), phase (Select), phaseStart/End (DatePicker). Extract the
field markup into a presentational component used by both `trial-edit-dialog` and
`trial-create-dialog`.

**Files:**
- Create: `src/app/features/manage/trials/trial-edit-form.component.{ts,html}`
- Modify: `trial-edit-dialog.component.{ts,html}`, `trial-create-dialog.component.{ts,html}`

- [ ] **Step 1: Create presentational component.** Contract:

```ts
@Component({
  selector: 'app-trial-edit-form',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, InputText, Select, MultiSelect, DatePicker, FormFieldComponent],
  templateUrl: './trial-edit-form.component.html',
})
export class TrialEditFormComponent {
  readonly name = model<string>('');
  readonly identifier = model<string | null>(null);
  readonly assetIds = model<string[]>([]);
  readonly primaryAssetId = model<string | null>(null);
  readonly indication = model<string | null>(null);
  readonly phaseType = model<string | null>(null);
  readonly phaseStart = model<string | null>(null); // YYYY-MM-DD
  readonly phaseEnd = model<string | null>(null);
  readonly assetOptions = input<{ id: string; name: string }[]>([]);
  readonly indicationOptions = input<{ id: string; name: string }[]>([]);
  readonly identifierReadonly = input<boolean>(false); // true in review dialog
  readonly nameInvalid = input<boolean>(false);
  // phase options are app constants owned by this component (move PHASE_OPTIONS here)
}
```

Move the field markup + the hard-coded phase option list from `trial-edit-dialog.component` into
the new component. Keep the "primary shown only when assetIds().length > 1" rule and the
date-string⇄Date conversion (move `parseDate`/`formatDate` helpers here, or pass YYYY-MM-DD and
convert inside). DatePicker binds the Date computed; on change writes YYYY-MM-DD to the model.

- [ ] **Step 2: Migrate `trial-edit-dialog`** to render `<app-trial-edit-form ...>` wired to its existing
  signals; keep DB load (`asset_id`/`trial_assets`) and save (`set_trial_assets` + `trialService.update`).
  Pass `assetOptions` from `products()`, `indicationOptions` from `indications()`. Leave Manage's
  indication-not-persisted behaviour as-is (bind indication model but do not add it to the update payload).

- [ ] **Step 3: Migrate `trial-create-dialog`** similarly (CT.gov prefill + lock logic stays in the
  container; the form just renders disabled controls when the container passes locked values — keep the
  existing disabled bindings by leaving lock handling in the container and passing through, or accept a
  `disabledFields` input). Simplest: keep create-dialog's own markup if sharing balloons the diff; in
  that case note it and only share with the edit dialog. Decide by diff size at implementation; default to
  sharing both.

- [ ] **Step 4: Verify** — build green; Manage > Trials Add (with NCT prefill) + Edit (assets/primary/phase/dates) render and save; `npm run test:units` green.
- [ ] **Step 5: Commit** — `git commit -am "Extract TrialEditFormComponent; migrate trial dialogs"`

---

## Task 7: Review edit dialog

**Files:**
- Create: `src/app/features/source-import/review-edit-dialog.component.ts`

A PrimeNG `Dialog` that, given `{ type, index }` and the current proposal, renders the Match
control (`Select` of `matchOptionsFor`) plus the matching form body (`app-company-edit-form` /
`app-asset-edit-form` / `app-trial-edit-form`) seeded via `proposal*ToForm`, with option lists
from `assetOptionsFromProposal` / `companyOptionsFromProposal` / space services
(indications, MOA, ROA via `IndicationService`/`MechanismOfActionService`/`RouteOfAdministrationService`,
unioned with the proposed values). On Save it applies `applyMatchOverride` then the matching
`apply*Form`, and emits the next proposal (or calls `SourceImportService.setProposal`).

- [ ] **Step 1:** Build the component shell (inputs: `type`, `index`; injects `SourceImportService`,
  the three ref-data services, `spaceId`). Compute form value + options in `ngOnChanges`/effects from the
  proposal. Render `app-dialog`/PrimeNG `Dialog` with header "Edit <type>".
- [ ] **Step 2:** Wire Save: `let p = applyMatchOverride(type, index, matchId(), proposal()); p = applyXForm(formValue(), index, p); this.sourceImportService.setProposal(p); close.emit();`
- [ ] **Step 3:** Verify build green. (Behaviour verified in Task 9 via the repro harness.)
- [ ] **Step 4: Commit** — `git commit -am "Add review-edit-dialog hosting shared form bodies + match control"`

---

## Task 8: Grid rework — read-only, scroll, Edit action

**Files:** Modify `review-page.component.ts`.

- [ ] **Step 1:** In the `<p-treeTable>`: remove `[resizableColumns]`, `columnResizeMode`, and all
  `ttResizableColumn`/width-class header attributes; wrap the table in
  `<div class="overflow-x-auto">` and give the table `class="min-w-[64rem]"` (or similar) so it scrolls
  rather than squeezes.
- [ ] **Step 2:** In the body entity cell: replace the link/plain-span `@if (row.link)` block with a plain
  span (keep the kind-based font classes); remove the `row.link` usage. Remove the
  `@if (row.hasDetail)` toggle button and the `@if (isDetailOpen(row.key))` detail `<tr>` (the whole
  rowDetail editing surface goes away).
- [ ] **Step 3:** Add an actions column: a header `<th>` and a body `<td>` with an Edit control
  (reuse `app-row-actions` or a simple `p-button` with `pTooltip="Edit"`) calling
  `openEdit(row.type, row.idx)`.
- [ ] **Step 4:** Add `openEdit`/dialog state to the component; render `<app-review-edit-dialog>` bound to
  the open `{type, index}`. Remove now-dead members: `link` on `GridRow` + `entityLink`, `resolveEntityLink`
  import, `isDetailOpen`/`toggleDetail`/`rowDetail`/`assetEditor`/`editableFields`/match-override methods
  and templates, and the `hasDetail`/`trialIsMultiAsset` wiring. Grep each symbol before deleting.
- [ ] **Step 5:** Verify build + lint green. Commit — `git commit -am "Review grid: read-only + horizontal scroll + Edit dialog; remove inline editing/links/resize"`

---

## Task 9: Cleanup dead code + CSS, then verify end-to-end

**Files:** `review-grid.logic.ts` (+spec), `primeng-overrides.css`.

- [ ] **Step 1:** Grep `resolveEntityLink` and `trialIsMultiAsset` across `src/`. If unreferenced after
  Task 8, remove them and their tests from `review-grid.logic.ts`/`.spec.ts`. Run `npm run test:units`.
- [ ] **Step 2:** Remove the `-- TreeTable: resizable columns --` block from `primeng-overrides.css`
  (keep `p-treetable { display: block }` only if the grid layout still needs it; otherwise remove the
  whole block).
- [ ] **Step 3:** Full verify: `npm run test:units` (green), `npx ng lint` (clean for changed files),
  `npx ng build --configuration local` (success).
- [ ] **Step 4: Runtime (repro harness).** Start `npx ng serve --configuration local --port 8101`.
  Seed a space (user + tenant with `ai_config.ai_enabled=true` + space owner membership + Lilly + 2
  assets), create a GoTrue session, inject it into `localStorage['sb-127-auth-token']`, navigate
  client-side to `/t/<t>/s/<s>/import` (role loads, importGuard passes), then via the Angular debug
  API set a fixture proposal on `SourceImportService.setProposal(...)` and navigate to
  `/t/<t>/s/<s>/import/<aiCallId>/review`. Confirm: grid is read-only and scrolls (no squeeze);
  each row's Edit opens the dialog with real Select/MultiSelect/DatePicker controls; the Match control
  lists create-new + fuzzy candidates; saving updates the grid; Confirm still commits. (Full harness
  commands are in this branch's history; replicate them.)
- [ ] **Step 5:** Manage regression in-app: Trials/Assets/Companies create + edit still work.
- [ ] **Step 6: Commit** — `git commit -am "Remove dead review-grid helpers + resize CSS"`

---

## Self-Review (completed)

- **Spec coverage:** read-only grid + scroll (Task 8/9); dialog editing with real controls (Tasks 4–7);
  match resolution in dialog (Task 3, 7); options = space ∪ proposal (Tasks 1, 7); shared forms reused by
  Manage (Tasks 4–6); proposal write-back pure + tested (Tasks 1–3); supersede Option A removals (Tasks 8–9).
- **Placeholders:** none (Task 6 Step 3 / Task 7 Step 3 note diff-size decisions with a stated default —
  share both; not a placeholder).
- **Type consistency:** `FormOption {id,name}`, `TrialFormValue`/`AssetFormValue`/`CompanyFormValue`,
  `matchOptionsFor`/`currentMatchId`/`applyMatchOverride`, `proposal*ToForm`/`apply*Form` used
  consistently across tasks and the dialog.
