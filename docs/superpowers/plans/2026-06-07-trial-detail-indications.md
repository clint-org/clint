# Trial Detail Indications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display a trial's assigned indications read-only as chips in the "Basic info" section of the trial detail page.

**Architecture:** Load indications via the existing `trialService.listIndications(trialId)` RPC into a new `indications` signal on `TrialDetailComponent`, reset on each load and error-swallowing (a failed indication fetch must not break the page). Render the list as chips in the existing Basic info definition list. The error-swallowing fetch logic is extracted into a pure, unit-tested helper because the unit-test runner uses a plain-node environment with no TestBed (see `engagement-landing.component.spec.ts` for the established pattern).

**Tech Stack:** Angular 19 (signals, standalone, OnPush), Vitest (plain-node unit runner), Tailwind v4.

---

## File Structure

- **Create:** `src/client/src/app/features/manage/trials/trial-indications.ts` — pure helper `fetchIndicationsSafe(fetcher)` returning the fetched list or `[]` on throw. One responsibility: encapsulate the silent-failure contract so it is testable without TestBed.
- **Create:** `src/client/src/app/features/manage/trials/trial-indications.spec.ts` — unit tests for the helper.
- **Modify:** `src/client/src/app/features/manage/trials/trial-detail.component.ts` — add `indications` signal, reset + load it in `loadTrial()` using the helper.
- **Modify:** `src/client/src/app/features/manage/trials/trial-detail.component.html` — render the Indications cell in Basic info.

---

## Task 1: Pure error-swallowing fetch helper (TDD)

**Files:**
- Create: `src/client/src/app/features/manage/trials/trial-indications.ts`
- Test: `src/client/src/app/features/manage/trials/trial-indications.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/features/manage/trials/trial-indications.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { fetchIndicationsSafe } from './trial-indications';

describe('fetchIndicationsSafe', () => {
  it('returns the fetched indications on success', async () => {
    const result = await fetchIndicationsSafe(async () => [
      { id: 'i1', name: 'NSCLC' },
      { id: 'i2', name: 'Melanoma' },
    ]);
    expect(result).toEqual([
      { id: 'i1', name: 'NSCLC' },
      { id: 'i2', name: 'Melanoma' },
    ]);
  });

  it('returns an empty array when the fetcher throws', async () => {
    const result = await fetchIndicationsSafe(async () => {
      throw new Error('network down');
    });
    expect(result).toEqual([]);
  });

  it('returns an empty array when the fetcher resolves empty', async () => {
    const result = await fetchIndicationsSafe(async () => []);
    expect(result).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/features/manage/trials/trial-indications.spec.ts`
Expected: FAIL — cannot resolve `./trial-indications` (module not found).

- [ ] **Step 3: Write minimal implementation**

Create `src/client/src/app/features/manage/trials/trial-indications.ts`:

```typescript
/**
 * Trial indications are supplementary context on the trial detail page; a
 * failed fetch must never blank the whole page. This helper runs the fetcher
 * and swallows any error into an empty list, keeping that silent-failure
 * contract in one unit-tested place (the component renders in a plain-node
 * test env with no TestBed, so the logic lives here, not in the component).
 */
export async function fetchIndicationsSafe(
  fetcher: () => Promise<{ id: string; name: string }[]>
): Promise<{ id: string; name: string }[]> {
  try {
    return await fetcher();
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npx vitest run --config vitest.units.config.ts src/app/features/manage/trials/trial-indications.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-indications.ts src/client/src/app/features/manage/trials/trial-indications.spec.ts
git commit -m "Add error-swallowing trial indications fetch helper"
```

---

## Task 2: Load indications into a signal on the detail component

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`

- [ ] **Step 1: Import the helper**

At the top of `trial-detail.component.ts`, immediately after the existing import on line 36 (`import { TrialEditDialogComponent } from './trial-edit-dialog.component';`), add:

```typescript
import { fetchIndicationsSafe } from './trial-indications';
```

(Place it alongside the other sibling-module imports in that import block; exact neighbor line may shift as imports are added — keep it grouped with the other `./` trial imports.)

- [ ] **Step 2: Add the `indications` signal**

In the signal block (currently lines 218-221, the `trial` / `trialId` / `loading` / `error` group), add a new signal directly after `readonly trial = signal<Trial | null>(null);`:

```typescript
  readonly indications = signal<{ id: string; name: string }[]>([]);
```

- [ ] **Step 3: Reset and load indications inside `loadTrial()`**

Replace the body of `loadTrial()` (currently lines 405-423) with the version below. Two changes only: reset `indications` to `[]` at the top, and fetch them after the trial resolves using the helper.

```typescript
  async loadTrial(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.indications.set([]);

    try {
      const trial = await this.trialService.getById(this.trialId());
      this.trial.set(trial);
      this.menuCache.clear();
      this.indications.set(
        await fetchIndicationsSafe(() => this.trialService.listIndications(this.trialId()))
      );
      // History panel depends on the loaded trial's space_id; refresh once
      // the trial resolves so the inline panel reflects the latest versions.
      await this.refreshHistory();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to load trial');
    } finally {
      this.loading.set(false);
    }
    // Run after loading flips false so the #markers div is in the DOM.
    this.applyMarkerQueryParam();
  }
```

- [ ] **Step 4: Verify lint and type-check pass**

Run: `cd src/client && npx eslint src/app/features/manage/trials/trial-detail.component.ts`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.ts
git commit -m "Load trial indications into a signal on the detail page"
```

---

## Task 3: Render the Indications cell in Basic info

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 1: Add the Indications cell**

In `trial-detail.component.html`, the Asset cell currently sits at lines 414-417:

```html
          <div>
            <dt class="text-[10px] font-medium uppercase tracking-wider text-slate-400">Asset</dt>
            <dd class="mt-1 text-sm text-slate-900">{{ t.assets?.name || '--' }}</dd>
          </div>
```

Insert a new Indications cell immediately after that closing `</div>` (before the `@if (spaceRole.canEdit())` Display order block):

```html
          <div>
            <dt class="text-[10px] font-medium uppercase tracking-wider text-slate-400">
              Indications
            </dt>
            <dd class="mt-1">
              @if (indications().length) {
                <div class="flex flex-wrap items-center gap-1">
                  @for (ind of indications(); track ind.id) {
                    <span
                      class="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-700"
                      >{{ ind.name }}</span
                    >
                  }
                </div>
              } @else {
                <span class="text-sm text-slate-900">--</span>
              }
            </dd>
          </div>
```

- [ ] **Step 2: Verify the template lints**

Run: `cd src/client && npx eslint src/app/features/manage/trials/trial-detail.component.html`
Expected: no errors (native `@if` / `@for` control flow, self-closing where required).

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.html
git commit -m "Render assigned indications as chips in trial Basic info"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit suite**

Run: `cd src/client && npm run test:units`
Expected: PASS, including the new `trial-indications.spec.ts`.

- [ ] **Step 2: Lint and build the client**

Run: `cd src/client && ng lint && ng build`
Expected: lint clean, build succeeds.

- [ ] **Step 3: Browser smoke (manual)**

Start the app (local Supabase running). On the trial detail page:
- A trial with one or more indications shows the chips in Basic info.
- A trial with no indications shows `--`.
- Navigating between trials via an in-place LINKED trial chip updates the indication chips (no stale carryover) thanks to the `indications.set([])` reset.

- [ ] **Step 4: Final commit (only if browser smoke surfaced a fix)**

If no changes were needed, skip. Otherwise:

```bash
git add -A
git commit -m "Fix trial indication chip rendering found in browser smoke"
```
