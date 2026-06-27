# Idempotent Source Import (Marker/Event Dedup) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-importing a source (identical or a different article covering the same milestone) must not create duplicate markers/events; matched items show as `EXISTING` in review and are skipped on commit.

**Architecture:** Extend the existing company/asset/trial LLM-match pattern to markers/events. The inventory snapshot emits existing marker/event instances per trial; the extraction schema/prompt/validator gain a `match` field with a `checkExistingId`-style verification (plus a one-to-one constraint); `commit_source_import` skips creation for matched items. The review grid already renders `EXISTING` from `match.kind`. Two adjacent fixes (silent duplicate-source toast, extraction temperature) ship alongside.

**Tech Stack:** Angular 19 (standalone, signals, OnPush), Supabase/Postgres (migrations), Cloudflare Worker (`@anthropic-ai/sdk`, `claude-sonnet-4-6`), Vitest, Zod.

**Spec:** `docs/superpowers/specs/2026-06-27-import-marker-event-dedup-design.md`

## Global Constraints

- No emojis, no em dashes anywhere (UI copy, docs, code comments, commits). Do not attribute commits to Claude.
- Angular: standalone components, `inject()`, `input()/output()/model()`, signals + `computed()`, native control flow (`@if`/`@for`), `bg-brand-*` utilities, lint is fully ratcheted to error. Verify: `cd src/client && ng lint && ng build`.
- Unit tests: `cd src/client && npm run test:units` (NOT `ng test`, NOT bare `vitest run`).
- Integration tests need `SUPABASE_SERVICE_ROLE_KEY` exported from `supabase status`; apply migrations via `supabase db reset` (the shared local DB is wiped by other sessions' resets, so verify specs in isolation). Insert trials BEFORE `asset_indications` in fixtures (the `trg_auto_derive` trigger nulls `development_status` otherwise).
- New/changed RPCs: audit-tier1 RPCs need `record_audit_event()` + `-- @audit:tier1`; these import RPCs are NOT tier1. After any migration change run `supabase db advisors --local --type all`. Redefine functions from the LIVE `pg_get_functiondef`, never an old migration copy.
- Extraction model is tenant-resolved; currently `claude-sonnet-4-6` (accepts `temperature`). Opus 4.7/4.8-class models reject `temperature` with a 400 — any `temperature` must be model-guarded.
- After changing `supabase/migrations/`, `app.routes.ts`, or `package.json`, run `npm run docs:arch` and commit the regen in the same change.

---

## File Structure

- `src/client/worker/source-extract/handler.ts` — extraction request; add model-guarded `temperature`.
- `src/client/worker/source-extract/nct-handler.ts` — NCT extraction request; same guard.
- `src/client/worker/source-extract/types.ts` — `MarkerSchema`/`EventSchema` gain `match`; `InventorySnapshot` gains existing instances.
- `src/client/worker/source-extract/prompt-builder.ts` — prompt instructs marker/event matching.
- `src/client/worker/source-extract/response-validator.ts` — verify/demote marker/event matches; one-to-one constraint.
- `supabase/migrations/<ts>_inventory_snapshot_marker_event_instances.sql` — extend `get_space_inventory_snapshot`.
- `supabase/migrations/<ts>_commit_source_import_skip_existing.sql` — `commit_source_import` honors existing match.
- `src/client/src/app/features/source-import/review-page.component.ts` — silent-no-op fix; thread `match`; deselect matched.
- `src/client/src/app/features/source-import/review-grid.logic.ts` — (only if needed) `entityState` already handles `match.kind`.
- Tests colocated: `*.spec.ts` next to worker/frontend files; integration under the existing integration test dir.

---

## Task 1: Lower extraction temperature (model-guarded)

**Files:**
- Modify: `src/client/worker/source-extract/handler.ts` (the `client.messages.create({...})` call, ~line 236, and `aiParams` ~line 206)
- Modify: `src/client/worker/source-extract/nct-handler.ts` (the `client.messages.create({...})` call ~line 200, `aiParams` ~line 188)
- Test: `src/client/worker/source-extract/temperature.spec.ts`

**Interfaces:**
- Produces: a pure helper `extractionTemperature(model: string): number | undefined` returning `0.2` for models that accept `temperature`, `undefined` for adaptive-thinking models (`opus-4-7`, `opus-4-8`, `fable`) so the field is omitted.

- [ ] **Step 1: Write the failing test** — `src/client/worker/source-extract/temperature.spec.ts`

```ts
import { describe, it, expect } from 'vitest';
import { extractionTemperature } from './temperature';

describe('extractionTemperature', () => {
  it('returns 0.2 for sonnet 4.6 (accepts temperature)', () => {
    expect(extractionTemperature('claude-sonnet-4-6')).toBe(0.2);
  });
  it('returns undefined for adaptive-thinking models that 400 on temperature', () => {
    expect(extractionTemperature('claude-opus-4-8')).toBeUndefined();
    expect(extractionTemperature('claude-opus-4-7')).toBeUndefined();
    expect(extractionTemperature('claude-fable-5')).toBeUndefined();
  });
  it('defaults to 0.2 for unknown/sonnet-family models', () => {
    expect(extractionTemperature('claude-haiku-4-5')).toBe(0.2);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd src/client && npm run test:units -- temperature` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/client/worker/source-extract/temperature.ts`

```ts
// Models that reject the `temperature` sampling param with a 400 (adaptive thinking only).
const NO_TEMPERATURE = [/opus-4-[78]/, /fable/, /mythos/];

export function extractionTemperature(model: string): number | undefined {
  if (NO_TEMPERATURE.some((re) => re.test(model))) return undefined;
  return 0.2;
}
```

- [ ] **Step 4: Wire into both handlers.** In each handler, where `client.messages.create({ model: preflight.model, max_tokens: ..., system, messages }, ...)` is called, build params conditionally so the key is omitted when undefined:

```ts
const temperature = extractionTemperature(preflight.model);
const response = await client.messages.create(
  {
    model: preflight.model,
    max_tokens: 8192,
    ...(temperature !== undefined ? { temperature } : {}),
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
  },
  { signal: controller.signal },
);
```
Add the matching import at the top of each handler. Reflect the value in `aiParams` so it is captured: `const aiParams = { model: preflight.model, max_tokens: 8192, temperature };`.

- [ ] **Step 5: Run tests + build** — `cd src/client && npm run test:units -- temperature` → PASS; `ng lint && ng build` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/client/worker/source-extract/temperature.ts src/client/worker/source-extract/temperature.spec.ts src/client/worker/source-extract/handler.ts src/client/worker/source-extract/nct-handler.ts
git commit -m "feat(import): set extraction temperature to 0.2 for models that accept it"
```

---

## Task 2: Fix silent no-op on duplicate-source commit

**Context:** `commit_source_import` returns a SUCCESS payload `{ code: 'duplicate_source', existing_id }` (no PG error) when a `source_documents` row with the same `text_hash` already exists. `review-page.component.ts::confirm()` checks only `error`, so it shows the success toast and navigates away having inserted nothing. The RPC already honors `allow_duplicate: true` in `p_source_document`; `buildCommitPayload()` omits it.

**Files:**
- Modify: `src/client/src/app/features/source-import/review-page.component.ts` (`confirm()` ~line 1221, `buildCommitPayload()` `sourceDocument` object ~line 1420)
- Test: `src/client/src/app/features/source-import/review-page.duplicate.spec.ts`

**Interfaces:**
- Produces: `confirm()` distinguishes `data?.code === 'duplicate_source'` from a real commit; exposes a signal `duplicateBlocked = signal(false)` and a `commitAllowingDuplicate()` method that re-runs commit with `allow_duplicate: true`.

- [ ] **Step 1: Write the failing test** — assert that given an RPC result `{ data: { code: 'duplicate_source', existing_id: 'x' }, error: null }`, `confirm()` does NOT mark `committed`, sets `duplicateBlocked` true, and shows no success message; and that `commitAllowingDuplicate()` sends `allow_duplicate: true` in `p_source_document`. Mock `supabase.client.rpc`. (Follow the existing review-page spec setup for harness/mocks.)

```ts
// Skeleton — adapt to the file's existing TestBed/mocking pattern.
it('does not report success when commit returns duplicate_source', async () => {
  rpcMock.mockResolvedValue({ data: { code: 'duplicate_source', existing_id: 'x' }, error: null });
  await component.confirm();
  expect(component.committed()).toBe(false);
  expect(component.duplicateBlocked()).toBe(true);
  expect(messagesAddSpy).not.toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
});

it('commitAllowingDuplicate sends allow_duplicate', async () => {
  rpcMock.mockResolvedValue({ data: { created: {} }, error: null });
  await component.commitAllowingDuplicate();
  const arg = rpcMock.mock.calls.at(-1)[1];
  expect(arg.p_source_document.allow_duplicate).toBe(true);
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd src/client && npm run test:units -- review-page.duplicate` → FAIL.

- [ ] **Step 3: Implement.** Add `protected readonly duplicateBlocked = signal(false);`. In `confirm()`, after the `error` guard and reading `data`, branch:

```ts
const result = data as { code?: string; existing_id?: string } | null;
if (result?.code === 'duplicate_source') {
  this.committing.set(false);
  this.duplicateBlocked.set(true);
  this.commitError.set('This exact source was already imported, so nothing was added. Choose Commit anyway to import it again.');
  return;
}
```
Add `buildCommitPayload(allowDuplicate = false)` and include `...(allowDuplicate ? { allow_duplicate: true } : {})` in the `sourceDocument` object. Add `protected async commitAllowingDuplicate(): Promise<void>` that mirrors `confirm()` but calls `buildCommitPayload(true)` and clears `duplicateBlocked`. Surface a "Commit anyway" button in the template, shown via `@if (duplicateBlocked())`.

- [ ] **Step 4: Run tests + build** — `npm run test:units -- review-page.duplicate` → PASS; `ng lint && ng build` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/source-import/review-page.component.ts src/client/src/app/features/source-import/review-page.component.html src/client/src/app/features/source-import/review-page.duplicate.spec.ts
git commit -m "fix(import-review): surface duplicate-source no-op and offer commit anyway"
```

---

## Task 3: Inventory snapshot emits existing marker/event instances

**Context:** `get_space_inventory_snapshot(p_space_id)` is last defined in `supabase/migrations/20260528020000_inventory_snapshot_add_moa_roa.sql`. It returns jsonb with company/asset/trial/indication/moa/roa instances + `marker_types`/`event_categories` catalogs + a `hash`. Add existing marker/event instances per trial so the LLM can match against them.

**Files:**
- Read first (live def): run `pg_get_functiondef('public.get_space_inventory_snapshot'::regproc)` against local DB.
- Create: `supabase/migrations/<UTC-timestamp>_inventory_snapshot_marker_event_instances.sql`
- Modify: `src/client/worker/source-extract/types.ts` (`InventorySnapshot` interface)
- Test: integration spec asserting instances present.

**Interfaces:**
- Produces snapshot keys: `markers: [{ id, trial_id, marker_type, title, event_date }]` and `events: [{ id, anchor: { level, id }, category, title, event_date }]`, scoped to trials/entities already in the snapshot. These keys are consumed by Task 4 (validator) and Task 5 (commit).

- [ ] **Step 1: Write the failing integration test** — seed a space with one trial + one marker + one event, call the RPC, assert `snapshot.markers` contains the marker (id, title, event_date, marker_type name) and `snapshot.events` contains the event with its anchor. (Seed trials before asset_indications.) Run via the integration runner with `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 2: Run it, verify it fails** — instances absent → FAIL.

- [ ] **Step 3: Implement the migration.** Base the new `create or replace function public.get_space_inventory_snapshot` on the LIVE definition; add two CTEs/selects:

```sql
-- markers on in-scope trials (cap 200 most recent per trial; log via raise notice on overflow)
markers as (
  select jsonb_agg(jsonb_build_object(
    'id', m.id, 'trial_id', ma.trial_id,
    'marker_type', mt.name, 'title', m.title, 'event_date', m.event_date
  ) order by m.event_date desc) as data
  from public.markers m
  join public.marker_assignments ma on ma.marker_id = m.id
  join public.marker_types mt on mt.id = m.marker_type_id
  where m.space_id = p_space_id
),
events as (
  select jsonb_agg(jsonb_build_object(
    'id', e.id,
    'anchor', jsonb_build_object(
      'level', case when e.trial_id is not null then 'trial'
                    when e.asset_id is not null then 'asset'
                    when e.company_id is not null then 'company' else 'space' end,
      'id', coalesce(e.trial_id, e.asset_id, e.company_id)),
    'category', ec.name, 'title', e.title, 'event_date', e.event_date
  )) as data
  from public.events e
  left join public.event_categories ec on ec.id = e.category_id
  where e.space_id = p_space_id
)
```
Add `'markers', coalesce((select data from markers), '[]'::jsonb)` and `'events', coalesce((select data from events), '[]'::jsonb)` to the result object, and include both in the hashed payload so `inventory_drift` still fires. Per-trial cap: if you keep it simple (space-scoped agg), still bound total via `limit` in a subquery and `raise notice` when truncated. End with `notify pgrst, 'reload schema';` only if the signature changed (it does not — body only), so omit.

- [ ] **Step 4: Update `InventorySnapshot`** in `types.ts` to include `markers` and `events` arrays with the shapes above (optional fields, default `[]`).

- [ ] **Step 5: Apply + verify** — `supabase db reset` then run the integration spec → PASS. `supabase db advisors --local --type all` → no new warnings. `npm run docs:arch` and stage the regen.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/*_inventory_snapshot_marker_event_instances.sql src/client/worker/source-extract/types.ts docs/runbook
git commit -m "feat(import): snapshot existing markers and events for dedup matching"
```

---

## Task 4: Marker/Event match schema, prompt, and validator

**Files:**
- Modify: `src/client/worker/source-extract/types.ts` (`MarkerSchema`, `EventSchema`)
- Modify: `src/client/worker/source-extract/prompt-builder.ts` (markers/events output shapes + instructions)
- Modify: `src/client/worker/source-extract/response-validator.ts` (verify/demote + one-to-one)
- Test: `src/client/worker/source-extract/response-validator.spec.ts` (extend existing)

**Interfaces:**
- Consumes: `InventorySnapshot.markers[].id` / `.events[].id` from Task 3.
- Produces: validated proposals where `marker.match` / `event.match` is `{kind:'existing', id}` (id guaranteed present in inventory, belongs to the resolved trial/anchor, claimed by at most one proposal) or `{kind:'new'}`. Consumed by Task 5 (commit) and Task 6 (frontend).

- [ ] **Step 1: Write failing validator unit tests** covering: (a) marker `match.existing` with id NOT in inventory → demoted to `{kind:'new'}`; (b) marker `match.existing` whose inventory record belongs to a different trial than the proposal resolves to → demoted to `new`; (c) two proposals both claiming the same existing id → first kept, second demoted (one-to-one); (d) valid match preserved.

```ts
it('demotes marker match when existing id is not in inventory', () => {
  const out = validateResponse(rawWithMarkerMatch('not-in-inventory'), inventoryWithMarker('real-id'), ...);
  expect(out.markers[0].match).toEqual({ kind: 'new' });
});
it('keeps first claim and demotes duplicate claim of same existing id', () => {
  const out = validateResponse(twoMarkersClaiming('real-id'), inventoryWithMarker('real-id'), ...);
  expect(out.markers[0].match).toEqual({ kind: 'existing', id: 'real-id' });
  expect(out.markers[1].match).toEqual({ kind: 'new' });
});
```

- [ ] **Step 2: Run, verify they fail** — `cd src/client && npm run test:units -- response-validator` → FAIL.

- [ ] **Step 3: Schema.** In `types.ts`, add to `MarkerSchema` and `EventSchema` a `match` field mirroring the existing entity union:

```ts
const existingMatch = z.object({ kind: z.literal('existing'), id: z.string().uuid() });
const newMatch = z.object({ kind: z.literal('new') });
// inside MarkerSchema/EventSchema:
match: z.discriminatedUnion('kind', [existingMatch, newMatch]).default({ kind: 'new' }),
```

- [ ] **Step 4: Prompt.** In `prompt-builder.ts`, add `"match": {"kind": "existing", "id": "uuid"} OR {"kind": "new"}` as the first key of the `markers` and `events` output shapes, and serialize the inventory `markers`/`events` instances into the `<inventory>` block (already present from Task 3 via `JSON.stringify(inventory)`). Add an instruction block:

```
- For markers and events, set match.kind to "existing" with the inventory id ONLY when the proposal describes the SAME real-world milestone as an existing marker/event on the same trial/anchor. Anchor on trial + event_date; tolerate differences in title wording and marker_type/category. Read the title, type, category, and evidence to keep genuinely different same-date developments separate. When uncertain, use "new": a missed duplicate is recoverable, but a wrong match permanently drops a distinct item.
```

- [ ] **Step 5: Validator.** In `response-validator.ts`, after parsing, add a step (analogous to the existing `checkExistingId` for companies/assets/trials): build `Set` of inventory marker ids and event ids; for each proposed marker/event with `match.kind==='existing'`, demote to `{kind:'new'}` if the id is not in the set, OR the matched inventory record's `trial_id`/anchor differs from the trial/anchor the proposal resolves to. Track claimed ids in a `Set`; on a second claim of an already-claimed id, demote to `new`.

- [ ] **Step 6: Run + build** — `npm run test:units -- response-validator` → PASS; `ng lint && ng build` → clean.

- [ ] **Step 7: Commit**

```bash
git add src/client/worker/source-extract/types.ts src/client/worker/source-extract/prompt-builder.ts src/client/worker/source-extract/response-validator.ts src/client/worker/source-extract/response-validator.spec.ts
git commit -m "feat(import): match markers and events against existing instances during extraction"
```

---

## Task 5: commit_source_import honors existing match (skip)

**Context:** Live `commit_source_import` is defined across migrations; the multi-asset version is `20260604230810_commit_source_import_multi_asset.sql`. The markers loop (~lines 291-330) and events loop (~333-388) call `create_marker`/`create_event` unconditionally. Add match handling.

**Files:**
- Read first: `pg_get_functiondef('public.commit_source_import'::regproc)` against local DB — this is the source of truth; do NOT copy the migration file.
- Create: `supabase/migrations/<UTC-timestamp>_commit_source_import_skip_existing.sql`
- Test: integration spec (Task 7 covers the end-to-end; add a focused smoke here).

**Interfaces:**
- Consumes: `p_proposal->'markers'[*]->'match'` and `...->'events'[*]->'match'` from Task 4.
- Produces: returned jsonb gains `'skipped', jsonb_build_object('markers', <uuid[]>, 'events', <uuid[]>)` alongside `'created'`. Existing-matched items are NOT inserted.

- [ ] **Step 1: Write the failing smoke** — call `commit_source_import` with a proposal whose single marker has `match: {kind:'existing', id:<existing marker id>}`; assert no new marker row is created and the result `skipped.markers` contains that id. Run via integration runner.

- [ ] **Step 2: Run, verify it fails** — currently inserts a dup → FAIL.

- [ ] **Step 3: Implement migration** from the live def. In the markers loop, before calling `create_marker`:

```sql
v_match := v_item->'match';
if v_match->>'kind' = 'existing' then
  -- verify the marker exists in this space; skip creation
  if exists (select 1 from public.markers where id = (v_match->>'id')::uuid and space_id = p_space_id) then
    v_skipped_markers := v_skipped_markers || (v_match->>'id')::uuid;
    continue;
  end if;
  -- id not valid in this space: fall through and create as new (defensive)
end if;
-- existing create_marker(...) call unchanged
```
Mirror for events with `create_event`. Declare `v_skipped_markers uuid[] := '{}';` and `v_skipped_events uuid[] := '{}';`. Add to the final result: `'skipped', jsonb_build_object('markers', to_jsonb(v_skipped_markers), 'events', to_jsonb(v_skipped_events))`. Keep every other behavior identical (companies/assets/trials/lookup tables/source_documents/text_hash guard). Signature unchanged → no PostgREST reload needed; still verify via a call-time smoke that creating non-matched items still works.

- [ ] **Step 4: Apply + verify** — `supabase db reset`; run the smoke → PASS; `supabase db advisors --local --type all` → clean; `npm run docs:arch` and stage regen.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_commit_source_import_skip_existing.sql docs/runbook
git commit -m "feat(import): skip existing-matched markers and events on commit"
```

---

## Task 6: Frontend badge + selection wiring

**Context:** `review-grid.logic.ts::entityState()` already returns `'existing'` when `match.kind==='existing'`. Ensure marker/event leaf rows carry `match`, and default matched rows to deselected so the confirm count is honest.

**Files:**
- Modify: `src/client/src/app/features/source-import/review-page.component.ts` (`leafRow()` ~line 906, initial selection logic)
- Test: `src/client/src/app/features/source-import/review-grid.logic.spec.ts` (extend) and/or a review-page selection spec.

**Interfaces:**
- Consumes: `marker.match` / `event.match` from Task 4's validated proposal shape.
- Produces: leaf grid nodes with `state: 'existing'` for matched markers/events; matched rows absent from the default selection set.

- [ ] **Step 1: Write the failing test** — a marker proposal with `match: {kind:'existing', id:'x'}` produces a leaf node with `state === 'existing'`, and is NOT in the default-selected ids. A `{kind:'new'}` marker is `state === 'new'` and selected.

- [ ] **Step 2: Run, verify it fails** — `cd src/client && npm run test:units -- review-grid` → FAIL.

- [ ] **Step 3: Implement.** Confirm `leafRow()` passes the proposal object (with `match`) to `entityState(e)` (it calls `entityState` already; ensure the marker/event entity object includes `match`). In the initial selection construction, exclude leaf rows whose `entityState(e) === 'existing'` from the default-selected set (markers/events only; existing companies/assets/trials remain selected as parents).

- [ ] **Step 4: Run + build** — `npm run test:units -- review-grid` → PASS; `ng lint && ng build` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/source-import/review-page.component.ts src/client/src/app/features/source-import/review-grid.logic.spec.ts
git commit -m "feat(import-review): badge matched markers/events EXISTING and deselect by default"
```

---

## Task 7: End-to-end re-import dedup integration test + verification gate

**Files:**
- Create: integration spec under the existing integration test directory, e.g. `src/client/.../import-dedup.integration.spec.ts` (follow the existing integration spec location/runner).

**Interfaces:**
- Consumes: Tasks 3-5 (snapshot instances, validated match, commit skip).

- [ ] **Step 1: Write the test** — programmatically: (1) commit an initial proposal creating a trial + 3 markers; (2) build a second proposal for the same trial whose markers carry `match: {kind:'existing', id}` (resolved from a fresh `get_space_inventory_snapshot`); (3) call `commit_source_import`; (4) assert the trial's marker count is unchanged and the result reports them under `skipped.markers`. Insert trials before asset_indications.

- [ ] **Step 2: Run in isolation** — `supabase db reset` then the integration runner with `SUPABASE_SERVICE_ROLE_KEY` → PASS.

- [ ] **Step 3: Full verification gate** —

```bash
cd src/client && ng lint && ng build
npm run test:units
supabase db advisors --local --type all
```
All clean. Confirm `npm run docs:arch` produced no further drift.

- [ ] **Step 4: Commit**

```bash
git add src/client/.../import-dedup.integration.spec.ts
git commit -m "test(import): end-to-end re-import is idempotent for markers and events"
```

---

## Self-Review notes

- Spec coverage: Component 1 → Task 3; Component 2 → Task 4; Component 3 → Task 5; Component 4 → Task 6; Component 5 → Task 2; Component 6 → Task 1; safeguards (prompt new-bias + one-to-one) → Task 4; end-to-end idempotency → Task 7.
- Type consistency: snapshot keys `markers[].id`/`events[].id` (Task 3) are the ids the validator checks (Task 4), the commit reads (Task 5), and the frontend badges (Task 6).
- Sequencing for subagents: Task 1 and Task 2 are independent (worker vs frontend, no shared files) and can run first/parallel. Tasks 3 → 4 → 5 are a sequential contract chain. Task 6 depends on Task 4. Task 7 depends on 3-6. review-page.component.ts is touched by Task 2 and Task 6 — run them sequentially, never in parallel, to avoid clobbering.
