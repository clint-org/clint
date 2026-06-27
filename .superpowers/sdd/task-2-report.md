# Task 2 Report: Fix silent no-op on duplicate-source commit

## Files changed

### Modified: `src/client/src/app/features/source-import/review-page.component.ts`
- Added `protected readonly duplicateBlocked = signal(false)` signal alongside the other commit-state signals.
- Added duplicate detection in `confirm()` immediately after the `error` guard: checks `data?.code === 'duplicate_source'`, sets `duplicateBlocked(true)`, sets `commitError` to the actionable warning message, and returns without setting `committed`.
- Updated `buildCommitPayload(allowDuplicate = false)` to spread `{ allow_duplicate: true }` into the `sourceDocument` object when `allowDuplicate` is true.
- Added `protected async commitAllowingDuplicate(): Promise<void>` method that mirrors `confirm()` but calls `buildCommitPayload(true)` and clears `duplicateBlocked` at the start.
- Updated the footer template: the `commitError` span now uses `text-amber-700` (via `[class]` binding) when `duplicateBlocked()` is true and `text-red-600` otherwise. The "Confirm N items" button is wrapped in `@else` to be replaced by a `severity="warn"` "Commit anyway" button when `duplicateBlocked()` is true.

### New: `src/client/src/app/features/source-import/review-page.duplicate.spec.ts`
Four behavioral tests for the duplicate-source handling using the `Injector.create` + `runInInjectionContext` harness (same pattern as `export-button.component.spec.ts`). Stubs provided for all eight `inject()` dependencies. Prefixed with `import '@angular/compiler'` to resolve the JIT facade error caused by the component importing `@angular/common`.

Tests:
1. `does not report success when commit returns duplicate_source` - confirms `committed()` stays false and no success toast.
2. `sets commitError with an actionable warning on duplicate_source` - confirms `commitError()` is non-null and contains "already imported".
3. `commitAllowingDuplicate sends allow_duplicate in p_source_document` - confirms `allow_duplicate: true` in RPC args.
4. `clears duplicateBlocked after commitAllowingDuplicate succeeds` - confirms state transitions.

## Test command and output

```
cd src/client && npm run test:units -- review-page.duplicate
```

```
 RUN  v4.1.5

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  01:47:25
   Duration  734ms (transform 131ms, setup 0ms, import 661ms, tests 6ms, environment 0ms)
```

TDD sequence:
- Step 2 (verify fail): 4 tests failed -- committed() was true, duplicateBlocked missing, commitAllowingDuplicate missing, commitError null.
- Step 4 (verify pass): 4 tests passed.

## Lint and build

```
cd src/client && ng lint && ng build
```

- Lint: `All files pass linting.` (one intermediate error: `type` vs `interface` -- fixed before commit)
- Build: clean output to `dist/clinical-trial-dashboard`. Only pre-existing CommonJS warnings (exceljs, jszip -- unrelated to this change).

## Commit

```
ff848754  fix(import-review): surface duplicate-source no-op and offer commit anyway
```

---

# Task 2 Review Fix: DRY violation and variable shadowing

## What changed

### Modified: `src/client/src/app/features/source-import/review-page.component.ts`

**DRY violation (finding 1):** The ~55-line post-commit body that was duplicated between `confirm()` and `commitAllowingDuplicate()` was extracted into a new private method `doCommit(allowDuplicate: boolean): Promise<void>`. `confirm()` now calls `doCommit(false)` after setting `committing` and clearing `commitError`. `commitAllowingDuplicate()` now calls `doCommit(true)` after setting `committing`, clearing `duplicateBlocked`, and clearing `commitError`. All shared logic lives once: session guard, RPC call, error handler, duplicate_source branch, NCT sync loop, `committed.set(true)`, `committing.set(false)`, `clearProposal()`, all `rpcCache.invalidateTags` entries, the success toast, and the `router.navigate`.

**Variable shadowing (finding 2):** Inside `doCommit`, the first `data` cast (for the duplicate-source check) is named `dupResult` and the second cast (for the NCT sync branch) is named `nctResult`. There is now one unambiguous name in each scope.

## Test command and output

```
cd src/client && npm run test:units -- review-page.duplicate
```

```
 RUN  v4.1.5 /Users/aadityamadala/Documents/code/clint-v2/.worktrees/import-dedup/src/client

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  01:50:59
   Duration  746ms (transform 140ms, setup 0ms, import 678ms, tests 6ms, environment 0ms)
```

## Lint and build

- Lint: `All files pass linting.`
- Build: clean. Only pre-existing budget/CommonJS warnings unrelated to this change.

## Commit

```
b1f60583  refactor(import-review): share commit body between confirm and commit-anyway
```

1 file changed, 15 insertions(+), 70 deletions(-)
