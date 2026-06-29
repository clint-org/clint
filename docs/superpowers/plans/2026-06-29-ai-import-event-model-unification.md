# AI Import Event-Model Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the AI source-import extraction/proposal/review half onto the unified event model: one `events` bucket emitting a specific `event_type` by enumerated name, with `commit_source_import` resolving `event_type` by exact name (no `display_order` guess) and mapping `priority` to `significance`.

**Architecture:** Bottom-up. First the worker zod contract + validator + prompt (what the model emits), then the commit RPC (what consumes it), then the proposal contract + review UI. Each layer is independently testable. The commit RPC only CALLS `create_event` (never redefines it).

**Tech Stack:** Cloudflare Worker (TypeScript, zod), Angular 21 (standalone, signals, PrimeNG), Supabase Postgres (plpgsql SECURITY DEFINER RPCs), Vitest.

## Global Constraints

- No emojis, no em-dashes, no Claude attribution (copy, comments, commits, PR).
- Branch `feat/event-import-unify` off `origin/develop`; worktree `.worktrees/event-import-unify`; `src/client/node_modules` symlinked from the main checkout. Run all commands from the worktree.
- Shared local Supabase Docker DB: do NOT `supabase db reset` or run `test:integration` while the parallel Stage-3 session is mid-run. Serialize; run integration specs in isolation.
- Migration numbering: this work's migration is `20260629050100` (lane 0500xx, started at 050100 per the coordinator board to leave headroom; do not author `20260629050000`). Stage 3 owns lane 0400xx; Seed owns 0600xx.
- Coordination is file-based at `/Users/aadityamadala/.clint-coordination/`. Read `board.md` before merging or touching the shared DB. Post `DB-TAKE` to `inbox.md` before any `supabase db reset` / `test:integration` and `DB-RELEASE` when done (scan the inbox tail first; WAIT if another stream holds an open DB-TAKE). Post a `READY` block when gate-green. After each merge to develop, `git merge origin/develop`.
- Only CALL `create_event`; never redefine `create_event` / `update_event` / `get_event_detail`.
- The live `create_event` signature (17 args, stable): `create_event(p_space_id, p_event_type_id, p_title, p_event_date, p_anchor_type, p_anchor_id, p_projection, p_date_precision, p_end_date, p_end_date_precision, p_is_ongoing, p_description, p_source_url, p_significance, p_visibility, p_source_doc_id, p_sources)`. `p_significance` is position 14; `p_sources` position 17.
- Commit only this session's files; never push `feat/event-model` or `feat/event-model-stage-3`.
- Unit tests: `npm run test:units` from `src/client`. Worker tests: `npm run test:worker`. Never `ng test` (no such target); never bare `vitest run`.
- Tags stay in the schema + review but are NOT written on commit (deferred; no regression).

---

## File structure

Worker (`src/client/worker/source-extract/`):
- `types.ts` (modify): unified `EventSchema`, corrected `InventorySnapshot`, drop `markers`/`'marker'`.
- `response-validator.ts` (modify): drop marker validation + dead marker-dedup; keep event validation/dedup.
- `response-validator.spec.ts` (modify): unified shape.
- `prompt-builder.ts` (modify): single events section, enumerate event_types.
- `prompt-builder.spec.ts` (create): assert the enum + single bucket.
- `nct-prompt-builder.ts` (modify): "events array must be empty".
- `__fixtures__/pfizer-press-release.json` (modify): unified shape.
- `../test/source-extract/golden.spec.ts` (modify if it asserts markers).

DB (`supabase/migrations/`):
- `20260629050100_commit_source_import_unified_events.sql` (create): unified commit RPC + in-file smoke.

Frontend (`src/client/src/app/`):
- `core/services/event-type.service.ts` (create) + `.spec.ts` (create): canonical `event_types` read.
- `core/models/event-type.model.ts` (create): `EventType` interface (avoids clashing with the existing `event.model.ts`).
- `features/source-import/review-grid.logic.ts` (modify) + `.spec.ts` (modify): `pickEventType`/`EventTypeLite`, leaf reads `event_type`, `defaultSelections` leaf set = events.
- `features/source-import/source-import.service.ts` (modify): drop `markers` from `SourceImportProposals`.
- `features/source-import/commit-summary.logic.ts` (modify) + `.spec.ts` (modify): count events; timeline CTA on events.
- `features/source-import/review-page.component.ts` (modify): collapse to events; glyph via `EventTypeService`.
- `features/source-import/review-page.duplicate.spec.ts` (modify): unified shape.

Integration (`src/client/test/integration/` pattern): a spec proving the unified commit path + dedup no-regression.

---

## Task 1: Unified worker contract (types.ts)

**Files:**
- Modify: `src/client/worker/source-extract/types.ts`
- Test: `src/client/worker/source-extract/response-validator.spec.ts` (exercises the schema; full validator rewrite is Task 2 -- here only confirm the schema parses the unified shape)

**Interfaces:**
- Produces: `EventSchema` item shape `{ match, event_type: string, title: string, event_date: string|null, end_date: string|null, projection: 'actual'|'company'|'primary', significance?: 'high'|'low', description: string|null, tags: string[], anchor: { level: 'space'|'company'|'asset'|'trial', ref: number|null }, evidence: string }`. `ExtractionResult` has `events` (no `markers`). `InventorySnapshot` has `event_types: {id,name}[]`, `event_type_categories: {id,name}[]`, `events?: {id, anchor:{level,id}, category, title, event_date}[]` (no `marker_types`/`event_categories`/`markers`). `DroppedEntity.type` excludes `'marker'`.

- [ ] **Step 1: Write the failing test**

Add to `response-validator.spec.ts` (top-level, alongside existing tests):

```ts
import { ExtractionResultSchema } from './types';

describe('unified EventSchema', () => {
  it('parses an event carrying event_type + significance + anchor', () => {
    const parsed = ExtractionResultSchema.parse({
      source_summary: 's',
      events: [
        {
          match: { kind: 'new' },
          event_type: 'Topline Data',
          title: 'Phase 3 readout',
          event_date: '2026-07-01',
          significance: 'high',
          anchor: { level: 'trial', ref: 0 },
          evidence: 'q',
        },
      ],
    });
    expect(parsed.events[0].event_type).toBe('Topline Data');
    expect(parsed.events[0].significance).toBe('high');
    expect(parsed.events[0].projection).toBe('company'); // default
    expect(parsed.events[0].tags).toEqual([]); // default
    expect('markers' in parsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:worker -- response-validator`
Expected: FAIL (`markers` still on result; `event_type`/`significance` not on EventSchema).

- [ ] **Step 3: Implement the unified schema**

In `types.ts`, replace `MarkerSchema` and `EventSchema` with a single `EventSchema`:

```ts
const EventSchema = z.object({
  match: z
    .discriminatedUnion('kind', [existingMatch, newSimpleMatch])
    .default({ kind: 'new' }),
  // A stable event_type NAME enumerated in the prompt from the live taxonomy.
  event_type: z.string(),
  title: z.string(),
  event_date: dateString.nullable().optional().default(null),
  end_date: dateString.nullable().optional().default(null),
  projection: z.enum(['actual', 'company', 'primary']).optional().default('company'),
  significance: z.enum(['high', 'low']).optional(),
  description: z.string().nullable().optional().default(null),
  // Kept in the schema + review; NOT written on commit (deferred to p_metadata).
  tags: z.array(z.string()).optional().default([]),
  anchor: z.object({
    level: z.enum(['space', 'company', 'asset', 'trial']),
    ref: z.number().int().nullable().optional().default(null),
  }),
  evidence: z.string(),
});
```

In `ExtractionResultSchema`, remove the `markers` line; keep `events: z.array(EventSchema).optional().default([])`.

In `InventorySnapshot`, replace the taxonomy/instance fields to match the live RPC:

```ts
  event_types: { id: string; name: string }[];
  event_type_categories: { id: string; name: string }[];
  mechanisms_of_action: { id: string; name: string }[];
  routes_of_administration: { id: string; name: string; abbreviation?: string }[];
  /** Existing event instances in the space with their anchor, for dedup. */
  events?: {
    id: string;
    anchor: { level: 'space' | 'company' | 'asset' | 'trial'; id: string | null };
    category: string;
    title: string;
    event_date: string | null;
  }[];
  hash: string;
```

Remove `marker_types`, `event_categories`, and the `markers?` field. In `DroppedEntity.type`, change the union to `'company' | 'asset' | 'trial' | 'event'` (drop `'marker'`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:worker -- response-validator`
Expected: the new `unified EventSchema` test PASSES. (Other validator tests still reference markers; Task 2 fixes them. If the file fails to compile, complete Task 2 in the same working session before committing.)

- [ ] **Step 5: Commit** (after Task 2 if the spec file does not compile standalone)

```bash
git add src/client/worker/source-extract/types.ts
git commit -m "feat(import): unified event extraction schema in worker contract"
```

---

## Task 2: Validator unification (response-validator.ts)

**Files:**
- Modify: `src/client/worker/source-extract/response-validator.ts`
- Test: `src/client/worker/source-extract/response-validator.spec.ts`

**Interfaces:**
- Consumes: Task 1 `ExtractionResult.events`, `InventorySnapshot.events`.
- Produces: validator that drops `'marker'` handling; keeps event bounds + event existing-id dedup (id-in-inventory, anchor-match, one-to-one) + event name-grounding; `cleanedResult` has no `markers`.

- [ ] **Step 1: Update the failing tests**

In `response-validator.spec.ts`: delete every test/fixture block that builds `markers: [...]` or asserts `dropped` of type `'marker'`. Re-express the marker-dedup cases as events anchored at `trial` level (the unification subsumes them). Add an event-dedup regression test:

```ts
it('demotes an event existing-match whose id is absent from inventory', () => {
  const res = validateExtraction(
    JSON.stringify({
      source_summary: 's',
      companies: [], assets: [], trials: [],
      events: [{
        match: { kind: 'existing', id: '00000000-0000-0000-0000-0000000000ff' },
        event_type: 'Regulatory Filing', title: 'BLA', event_date: '2026-08-01',
        anchor: { level: 'space', ref: null }, evidence: 'e',
      }],
    }),
    { companies: [], assets: [], trials: [], indications: [],
      event_types: [], event_type_categories: [],
      mechanisms_of_action: [], routes_of_administration: [],
      events: [], hash: 'h' },
    'BLA filing accepted',
    { skipNameGrounding: true },
  );
  expect(res.ok).toBe(true);
  if (res.ok) expect((res.result.events[0].match as { kind: string }).kind).toBe('new');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/client && npm run test:worker -- response-validator`
Expected: FAIL (validator still references `data.markers` / `inventory.markers`).

- [ ] **Step 3: Implement**

In `response-validator.ts`:
- Delete the marker bounds-check loop (the `for (let i = 0; i < data.markers.length; i++)` block checking `trial_refs`).
- Delete the entire "Marker/event existing-id check" MARKER half (the `inventoryMarkerById` map, `claimedMarkerIds`, and the `data.markers` loop). Keep the EVENT half (`inventoryEventById`, `claimedEventIds`, the `data.events` loop) verbatim.
- Delete the marker name-grounding loop (the `for ... data.markers ...` block in Step 5).
- In Step 6 `cleanedResult`, remove the `markers:` line.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/client && npm run test:worker -- response-validator`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/worker/source-extract/types.ts src/client/worker/source-extract/response-validator.ts src/client/worker/source-extract/response-validator.spec.ts
git commit -m "feat(import): validator handles one unified events bucket; drop marker validation"
```

---

## Task 3: Prompt builders + golden fixture

**Files:**
- Modify: `src/client/worker/source-extract/prompt-builder.ts`
- Create: `src/client/worker/source-extract/prompt-builder.spec.ts`
- Modify: `src/client/worker/source-extract/nct-prompt-builder.ts`
- Modify: `src/client/worker/source-extract/__fixtures__/pfizer-press-release.json`
- Modify (if it asserts markers): `src/client/worker/test/source-extract/golden.spec.ts`

**Interfaces:**
- Consumes: `InventorySnapshot.event_types` (names).
- Produces: a system prompt with ONE `events` array section enumerating event_type names; NCT prompt instructs an empty events array.

- [ ] **Step 1: Write the failing test**

Create `prompt-builder.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildPrompt } from './prompt-builder';
import type { InventorySnapshot } from './types';

const inv = (et: { id: string; name: string }[]): InventorySnapshot => ({
  companies: [], assets: [], trials: [], indications: [],
  event_types: et, event_type_categories: [],
  mechanisms_of_action: [], routes_of_administration: [], hash: 'h',
});

describe('buildPrompt unified events', () => {
  it('enumerates event_type names from inventory and has no markers bucket', () => {
    const { system } = buildPrompt('text', inv([
      { id: '1', name: 'Topline Data' }, { id: '2', name: 'Regulatory Filing' },
    ]));
    expect(system).toContain('Topline Data');
    expect(system).toContain('Regulatory Filing');
    expect(system).toContain('"event_type"');
    expect(system).not.toContain('"markers"');
    expect(system).not.toContain('marker_type');
  });

  it('falls back to the system event-type names when inventory is empty', () => {
    const { system } = buildPrompt('text', inv([]));
    expect(system).toContain('Topline Data');
    expect(system).toContain('LOE Date');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:worker -- prompt-builder`
Expected: FAIL (`marker_type` still present; no `event_type`).

- [ ] **Step 3: Implement**

In `prompt-builder.ts`:
- Replace the two fallback consts with one:

```ts
const EVENT_TYPE_FALLBACK =
  'Trial Start | Trial End | Primary Completion | Topline Data | Regulatory Filing | ' +
  'Approval | Launch | LOE Date | Distribution | Leadership Change | Financial | Strategic';
```

- In `buildSystemPrompt`, replace `markerTypeEnum`/`categoryEnum` with:

```ts
  const eventTypeEnum =
    inventory.event_types?.length > 0
      ? inventory.event_types.map((et) => et.name).join(' | ')
      : EVENT_TYPE_FALLBACK;
```

- In the schema text, delete the entire `"markers": [...]` block. Replace the `"events": [...]` block with:

```text
  "events": [{
    "match": {"kind": "existing", "id": "uuid"} OR {"kind": "new"},
    "event_type": "${eventTypeEnum}",
    "title": "short descriptive title",
    "event_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD or null",
    "projection": "actual | company | primary",
    "significance": "high | low",
    "description": "string or null",
    "tags": ["tag strings"],
    "anchor": {"level": "space | company | asset | trial", "ref": 0 or null},
    "evidence": "verbatim quote"
  }]
```

- Update the Rules bullets: replace "Use ONLY the marker_type and category values listed in the schema" with "Use ONLY an event_type value listed in the schema; pick the most specific match." Add: "Anchor each event with anchor.level (trial for clinical/data milestones; company for corporate, financial, leadership, strategic events; asset where the event is about the asset itself) and a zero-based ref into that array (null for space-level)." Add: "Set significance to high for material, market-moving developments; low otherwise."
- Update the dedup paragraph: change "an existing marker/event on the same trial/anchor. Anchor on trial + event_date" to "an existing event on the same anchor. Anchor on the resolved entity + event_date".

In `nct-prompt-builder.ts`:
- Change the rule line `- Markers and events arrays must be empty.` to `- The events array must be empty.`
- In the schema text, delete the `"markers": []` line; keep `"events": []`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:worker -- prompt-builder`
Expected: PASS.

- [ ] **Step 5: Update the golden fixture + golden spec**

In `__fixtures__/pfizer-press-release.json`: move any `markers` array entries into `events` with the unified shape (`event_type` from the marker_type name, `anchor: {level:'trial', ref:<first trial_ref>}`, `significance` from any `priority`, drop `trial_refs`/`marker_type`/`category`/`priority`). Remove the `markers` key. Open `../test/source-extract/golden.spec.ts`; if it asserts a `markers` count or shape, update those assertions to the unified `events` set.

- [ ] **Step 6: Run worker suite**

Run: `cd src/client && npm run test:worker`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/client/worker/source-extract/prompt-builder.ts src/client/worker/source-extract/prompt-builder.spec.ts src/client/worker/source-extract/nct-prompt-builder.ts src/client/worker/source-extract/__fixtures__/pfizer-press-release.json src/client/worker/test/source-extract/golden.spec.ts
git commit -m "feat(import): single events prompt section enumerating event_types"
```

---

## Task 4: commit_source_import unified events (migration)

**Files:**
- Create: `supabase/migrations/20260629050100_commit_source_import_unified_events.sql`

**Interfaces:**
- Consumes: proposal `events[]` with `event_type`, `significance`, `anchor {level, ref}`, `projection`, `end_date`, `description`, `match`. The live `create_event` 17-arg signature.
- Produces: return envelope `{ source_doc_id, warnings, created: {companies, assets, trials, events}, skipped: {events} }`.

- [ ] **Step 1: Capture the live function body as the base**

Ensure local Supabase is running (`supabase status`). Capture the current definition so the new migration edits the live body (guards against inverted-version clobber):

Run: `psql "$(supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" -At -c "select pg_get_functiondef('public.commit_source_import(uuid,uuid,jsonb,jsonb,text)'::regprocedure);" > /tmp/csi_live.sql`
Expected: a file matching `supabase/migrations/20260628280000_commit_source_import_emits_events.sql`'s function body (it is the latest definition).

- [ ] **Step 2: Author the migration**

Create `20260629050100_commit_source_import_unified_events.sql`. Start from the live body. Apply exactly these edits:

(a) In the `declare` block: remove `v_created_markers` and `v_skipped_markers`; add `v_significance text;`. Keep `v_created_events uuid[] := '{}';` and `v_skipped_events uuid[] := '{}';`.

(b) Delete the entire `-- markers ----` block (the `if p_proposal->'markers' is not null then ... end loop; end if;` section).

(c) Replace the entire `-- events ----` block with:

```sql
  -- events ------------------------------------------------------------------
  -- One unified bucket. Resolve event_type by EXACT name (space-scoped wins),
  -- then case-insensitive, then the system default by display_order. No
  -- display_order "lead type" guess. significance comes from the item; when
  -- absent, fall back to the resolved type's default_significance. Anchor
  -- resolves against the entity maps, downgrading to space (with a warning)
  -- when unresolvable. Skip-existing dedup preserved (skipped.events).
  if p_proposal->'events' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'events')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        if exists (
          select 1 from public.events
           where id = (v_match->>'id')::uuid and space_id = p_space_id
        ) then
          v_skipped_events := v_skipped_events || (v_match->>'id')::uuid;
          continue;
        end if;
        -- id not valid in this space: fall through and create as new (defensive).
      end if;

      select id into v_event_type_id
        from public.event_types
       where (space_id = p_space_id or (space_id is null and is_system))
         and name = v_item->>'event_type'
       order by space_id nulls last
       limit 1;
      if v_event_type_id is null then
        select id into v_event_type_id
          from public.event_types
         where (space_id = p_space_id or (space_id is null and is_system))
           and lower(name) = lower(v_item->>'event_type')
         order by space_id nulls last
         limit 1;
      end if;
      if v_event_type_id is null then
        select id into v_event_type_id
          from public.event_types
         where is_system and space_id is null and display_order >= 0
         order by display_order
         limit 1;
      end if;

      v_significance := nullif(v_item->>'significance', '');
      if v_significance is null then
        select default_significance into v_significance
          from public.event_types where id = v_event_type_id;
      end if;

      declare
        v_anchor             jsonb := v_item->'anchor';
        v_anchor_level       text  := v_anchor->>'level';
        v_resolved_anchor_id uuid  := null;
      begin
        if v_anchor_level = 'company' then
          v_resolved_anchor_id := (v_company_map->>((v_anchor->>'ref')::int)::text)::uuid;
        elsif v_anchor_level = 'asset' then
          v_resolved_anchor_id := (v_asset_map->>((v_anchor->>'ref')::int)::text)::uuid;
        elsif v_anchor_level = 'trial' then
          v_resolved_anchor_id := (v_trial_map->>((v_anchor->>'ref')::int)::text)::uuid;
        end if;

        if v_anchor_level in ('company','asset','trial') and v_resolved_anchor_id is not null then
          v_anchor_type := v_anchor_level;
          v_anchor_id := v_resolved_anchor_id;
        else
          v_anchor_type := 'space';
          v_anchor_id := null;
          v_warnings := v_warnings || '"event_anchored_to_space"'::jsonb;
        end if;

        v_new_id := public.create_event(
          p_space_id,
          v_event_type_id,
          v_item->>'title',
          coalesce((v_item->>'event_date')::date, current_date),
          v_anchor_type,
          v_anchor_id,
          coalesce(v_item->>'projection', 'company'),
          'exact',
          (v_item->>'end_date')::date,
          'exact',
          false,
          v_item->>'description',
          null,            -- p_source_url: citations flow through p_sources
          v_significance,  -- p_significance (from the AI priority)
          null,            -- p_visibility
          v_source_doc_id,
          v_sources
        );
        v_created_events := v_created_events || v_new_id;
      end;
    end loop;
  end if;
```

(d) Replace the `return jsonb_build_object(...)` with the collapsed envelope:

```sql
  return jsonb_build_object(
    'source_doc_id', v_source_doc_id,
    'warnings', v_warnings,
    'created', jsonb_build_object(
      'companies', to_jsonb(v_created_companies),
      'assets', to_jsonb(v_created_assets),
      'trials', to_jsonb(v_created_trials),
      'events', to_jsonb(v_created_events)
    ),
    'skipped', jsonb_build_object(
      'events', to_jsonb(v_skipped_events)
    )
  );
```

(e) Keep every other block (access check, drift, duplicate guard, source_documents insert, master lookups, companies/assets/trials, `v_sources` derivation, `ai_calls` update) byte-identical.

(f) End the file with the in-file prod-safe smoke (below) and `notify pgrst, 'reload schema';`.

- [ ] **Step 3: Add the in-file smoke**

Append (commits one trial-anchored + one company-anchored event, asserts anchored events + 2 source citations, self-cleans, skips when demo data is absent):

```sql
do $$
declare
  v_demo_space constant uuid := '00000000-0000-0000-0000-0000000d0100';
  v_user_id    uuid; v_company_id uuid; v_trial_id uuid; v_hash text;
  v_result jsonb; v_doc_id uuid; v_ev1 uuid; v_ev2 uuid;
  v_src_url constant text := 'https://example.com/unify-smoke';
  v_a1 text; v_a2 text; v_src_count int; v_sig text;
begin
  if not exists (select 1 from public.spaces where id = v_demo_space) then
    raise notice 'unify smoke: demo space absent (prod-safe skip)'; return; end if;
  select user_id into v_user_id from public.space_members
    where space_id = v_demo_space and role in ('owner','editor') limit 1;
  if v_user_id is null then raise notice 'unify smoke: no owner/editor, skipping'; return; end if;
  select id into v_company_id from public.companies where space_id = v_demo_space limit 1;
  select id into v_trial_id from public.trials where space_id = v_demo_space limit 1;
  if v_company_id is null or v_trial_id is null then
    raise notice 'unify smoke: no anchorable company+trial, skipping'; return; end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);
  select get_space_inventory_snapshot(v_demo_space)->>'hash' into v_hash;

  v_result := public.commit_source_import(
    v_demo_space, null,
    jsonb_build_object('source_kind','text','source_text','unify smoke '||clock_timestamp()::text,
      'source_title','unify smoke','source_url',v_src_url,
      'text_hash','unify-smoke-'||clock_timestamp()::text,'fetch_outcome','paste'),
    jsonb_build_object(
      'companies', jsonb_build_array(jsonb_build_object('match', jsonb_build_object('kind','existing','id',v_company_id))),
      'trials', jsonb_build_array(jsonb_build_object('match', jsonb_build_object('kind','existing','id',v_trial_id))),
      'events', jsonb_build_array(
        jsonb_build_object('event_type','Topline Data','title','unify smoke readout',
          'event_date','2026-07-01','significance','high','anchor', jsonb_build_object('level','trial','ref',0)),
        jsonb_build_object('event_type','Regulatory Filing','title','unify smoke filing',
          'event_date','2026-08-01','anchor', jsonb_build_object('level','company','ref',0)))),
    v_hash);

  v_doc_id := (v_result->>'source_doc_id')::uuid;
  v_ev1 := ((v_result->'created'->'events')->>0)::uuid;
  v_ev2 := ((v_result->'created'->'events')->>1)::uuid;
  if v_ev1 is null or v_ev2 is null then
    raise exception 'unify smoke FAIL: expected two created events, got %', v_result->'created'->'events'; end if;
  select anchor_type into v_a1 from public.events where id = v_ev1;
  select anchor_type into v_a2 from public.events where id = v_ev2;
  if v_a1 <> 'trial' then raise exception 'unify smoke FAIL: ev1 anchor %, want trial', v_a1; end if;
  if v_a2 <> 'company' then raise exception 'unify smoke FAIL: ev2 anchor %, want company', v_a2; end if;
  select significance into v_sig from public.events where id = v_ev1;
  if v_sig <> 'high' then raise exception 'unify smoke FAIL: significance % not high', v_sig; end if;
  select count(*) into v_src_count from public.event_sources
    where event_id in (v_ev1, v_ev2) and url = v_src_url;
  if v_src_count <> 2 then raise exception 'unify smoke FAIL: % citations, want 2', v_src_count; end if;

  delete from public.events where source_doc_id = v_doc_id;
  delete from public.source_documents where id = v_doc_id;
  perform set_config('request.jwt.claims', null, true);
  raise notice 'unify smoke PASS: unified commit emits anchored events with significance + citations';
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Apply + run the smoke**

Coordinate with the parallel session first (do not reset while it runs). Then:
Run: `supabase db reset`
Expected: completes; log shows `unify smoke PASS` (or a prod-safe skip notice if demo data seeds after).

- [ ] **Step 5: Advisor check**

Run: `supabase db advisors --local --type all`
Expected: no new warnings attributable to this migration.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260629050100_commit_source_import_unified_events.sql
git commit -m "feat(import): commit_source_import consumes one unified events bucket, resolves event_type by name"
```

---

## Task 5: EventTypeService (canonical event_types read)

**Files:**
- Create: `src/client/src/app/core/models/event-type.model.ts`
- Create: `src/client/src/app/core/services/event-type.service.ts`
- Test: `src/client/src/app/core/services/event-type.service.spec.ts`

**Interfaces:**
- Produces: `interface EventType { id; space_id: string|null; category_id; name; shape: MarkerShape; fill_style: FillStyle; color; inner_mark: InnerMark; default_significance: 'high'|'low'; is_system; display_order }`. `EventTypeService.list(spaceId?): Promise<EventType[]>` reading `event_types` (system + space), ordered by `display_order`, cached via `RpcCache` tag `events:types`.

- [ ] **Step 1: Write the failing test**

Create `event-type.service.spec.ts` (mirror `marker-type.service` test style: stub `SupabaseService.client` query chain + `RpcCache`):

```ts
import { TestBed } from '@angular/core/testing';
import { EventTypeService } from './event-type.service';
import { SupabaseService } from './supabase.service';
import { RpcCache } from './rpc-cache.service';

describe('EventTypeService', () => {
  it('lists system + space event types ordered by display_order', async () => {
    const rows = [{ id: 'a', name: 'Topline Data', display_order: 1, is_system: true }];
    const query: any = {
      select: () => query, order: () => query, or: () => query,
      throwOnError: async () => ({ data: rows }),
    };
    const supabase = { client: { from: () => query } } as unknown as SupabaseService;
    const cache = { get: (_k: string, _p: unknown, o: { fetch: () => Promise<unknown> }) => o.fetch() } as unknown as RpcCache;
    TestBed.configureTestingModule({
      providers: [
        EventTypeService,
        { provide: SupabaseService, useValue: supabase },
        { provide: RpcCache, useValue: cache },
      ],
    });
    const svc = TestBed.inject(EventTypeService);
    const out = await svc.list('space-1');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Topline Data');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- event-type.service`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `event-type.model.ts`:

```ts
import type { MarkerShape, FillStyle, InnerMark } from './marker.model';

export interface EventType {
  id: string;
  space_id: string | null;
  category_id: string;
  name: string;
  shape: MarkerShape;
  fill_style: FillStyle;
  color: string;
  inner_mark: InnerMark;
  default_significance: 'high' | 'low';
  is_system: boolean;
  display_order: number;
}
```

Create `event-type.service.ts` (mirror `MarkerTypeService.list`, against the live `event_types` table):

```ts
import { inject, Injectable } from '@angular/core';

import { EventType } from '../models/event-type.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const REFERENCE_TTL = { fresh: 30 * 60 * 1000, stale: Infinity };

@Injectable({ providedIn: 'root' })
export class EventTypeService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(spaceId?: string): Promise<EventType[]> {
    return this.cache.get(
      'event_types',
      { spaceId },
      {
        ttl: REFERENCE_TTL,
        tags: ['events:types'],
        fetch: async () => {
          let query = this.supabase.client
            .from('event_types')
            .select('*')
            .order('display_order');
          if (spaceId) {
            query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
          }
          const { data } = await query.throwOnError();
          return data as EventType[];
        },
      }
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- event-type.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/models/event-type.model.ts src/client/src/app/core/services/event-type.service.ts src/client/src/app/core/services/event-type.service.spec.ts
git commit -m "feat(events): canonical EventTypeService read for event_types catalog"
```

---

## Task 6: review-grid.logic event leaves

**Files:**
- Modify: `src/client/src/app/features/source-import/review-grid.logic.ts`
- Test: `src/client/src/app/features/source-import/review-grid.logic.spec.ts`

**Interfaces:**
- Consumes: `EventTypeLite` glyph rows from the component.
- Produces: `EventTypeLite` (= `{ name; shape: MarkerShape; color; fill_style: FillStyle; inner_mark: InnerMark; is_system; display_order }`), `pickEventType(name: string|null, types: EventTypeLite[]): EventTypeLite|null`, `eventLeafDisplay(event)` returns `{ category: event_type name, date }`. `defaultSelections` leaf set = `{ events }`.

- [ ] **Step 1: Update the failing tests**

In `review-grid.logic.spec.ts`: rename the `pickMarkerType` describe to `pickEventType` and point it at the new export; change `markerLeafDisplay` cases to `eventLeafDisplay` reading `event_type`; change `defaultSelections` expectations so `markers_*` keys are gone and matched `events_*` default to `false`. Add:

```ts
it('eventLeafDisplay reads the event_type name and date', () => {
  expect(eventLeafDisplay({ event_type: 'Topline Data', event_date: '2026-07-01' }))
    .toEqual({ category: 'Topline Data', date: '2026-07-01' });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/client && npm run test:units -- review-grid.logic`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `review-grid.logic.ts`:
- Rename `MarkerTypeLite` to `EventTypeLite` (keep the same fields) and `pickMarkerType` to `pickEventType` (identical resolution body).
- Delete `markerLeafDisplay`. Change `eventLeafDisplay` to read `event_type`:

```ts
export function eventLeafDisplay(event: Entity): LeafDisplay {
  return { category: cleanText(event['event_type']), date: cleanText(event['event_date']) };
}
```

- In `SelectionCounts` / `LABELS` / `readableSummary`, remove the `markers` entry.
- In `LEAF_ENTITY_TYPES`, change to `new Set(['events'])`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/client && npm run test:units -- review-grid.logic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/source-import/review-grid.logic.ts src/client/src/app/features/source-import/review-grid.logic.spec.ts
git commit -m "feat(import): review grid renders unified event leaves with event_type glyph resolution"
```

---

## Task 7: proposal contract + commit summary

**Files:**
- Modify: `src/client/src/app/features/source-import/source-import.service.ts`
- Modify: `src/client/src/app/features/source-import/commit-summary.logic.ts`
- Test: `src/client/src/app/features/source-import/commit-summary.logic.spec.ts`

**Interfaces:**
- Produces: `SourceImportProposals` without `markers`; `CommitCreated` without `markers`; `commitSummary` counts `companies+assets+trials+events`, "View in timeline" when `events.length > 0`.

- [ ] **Step 1: Update the failing tests**

In `commit-summary.logic.spec.ts`: remove `markers` from every `CommitCreated` fixture; change the "View in timeline" case to assert it appears when `events` is non-empty. Add:

```ts
it('points to the timeline when events landed', () => {
  expect(commitSummary({ events: ['e1'] }, 'Doc'))
    .toBe('Committed 1 new item from Doc. View in timeline.');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/client && npm run test:units -- commit-summary.logic`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `commit-summary.logic.ts`: delete `markers?` from `CommitCreated`; drop it from the `total` sum; replace the `markersCreated` branch with:

```ts
  const eventsCreated = c.events?.length ?? 0;
  return eventsCreated > 0 ? `${base} View in timeline.` : base;
```

In `source-import.service.ts`: delete the `markers: Record<string, unknown>[];` line from `SourceImportProposals`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src/client && npm run test:units -- commit-summary.logic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/source-import/source-import.service.ts src/client/src/app/features/source-import/commit-summary.logic.ts src/client/src/app/features/source-import/commit-summary.logic.spec.ts
git commit -m "feat(import): proposal contract + commit summary drop the markers bucket"
```

---

## Task 8: review-page component collapse to events

**Files:**
- Modify: `src/client/src/app/features/source-import/review-page.component.ts`
- Test: `src/client/src/app/features/source-import/review-page.duplicate.spec.ts`

**Interfaces:**
- Consumes: `EventTypeService` (Task 5), `pickEventType`/`EventTypeLite`/`eventLeafDisplay`/`defaultSelections` (Task 6).

- [ ] **Step 1: Update the failing test**

In `review-page.duplicate.spec.ts`: change any proposal fixture `markers: [...]` into the unified `events` shape; update expectations that referenced markers selection keys/counts.

- [ ] **Step 2: Run test to verify it fails (or the component fails to compile)**

Run: `cd src/client && npm run test:units -- review-page.duplicate`
Expected: FAIL / compile error referencing removed marker symbols.

- [ ] **Step 3: Implement**

In `review-page.component.ts`:
- Replace imports: drop `MarkerTypeService`, `MarkerType`, `pickMarkerType`, `MarkerTypeLite`, `markerLeafDisplay`; import `EventTypeService`, `EventType`, `pickEventType`, `EventTypeLite`, `eventLeafDisplay`. Keep `MarkerIconComponent` (canonical glyph).
- Rename the `markerTypes` signal to `eventTypes = signal<EventType[]>([])` and `loadMarkerTypes()` to `loadEventTypes()` calling `this.eventTypeService.list(spaceId)`.
- In `GridRow`, rename `markerType?: MarkerTypeLite|null` to `eventType?: EventTypeLite|null`.
- In `HierarchicalTree` / `CompanyNode` / `AssetNode` / `TrialNode`: delete `markers`/`orphanMarkers` and the marker maps (`trialMarkersMap`, `assignedMarkers`). Build only the event maps (keep `trialEventsMap`/`assetEventsMap`/`companyEventsMap`/`orphanEvents`).
- In `leafRow`, drop the `'markers'` branch: the only leaf type is `'events'`; set `eventType: pickEventType(disp.category, this.eventTypes() as EventTypeLite[])`.
- In `ENTITY_ORDER`, remove `'markers'`. Update `EntityType` union to drop `'markers'`. Remove the `'marker'` `kind` and `LEAF_KINDS` entry for markers (leaf set = `event`).
- In the template: delete the "Unlinked markers" section; keep "Unlinked events". The leaf glyph block uses `row.eventType` with `app-marker-icon` and falls back to `fa-calendar-day`.

- [ ] **Step 4: Run test + lint + build**

Run: `cd src/client && npm run test:units -- review-page.duplicate && npm run test:units -- import-page.component`
Expected: PASS.
Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/source-import/review-page.component.ts src/client/src/app/features/source-import/review-page.duplicate.spec.ts
git commit -m "feat(import): review page renders one unified events bucket with event_type glyphs"
```

---

## Task 9: integration test (commit unified + dedup no-regression)

**Files:**
- Create/extend the import integration spec under the existing integration test root (mirror the existing import commit spec; locate with `grep -rl "commit_source_import" src/client/test`).

**Interfaces:**
- Consumes: the deployed `commit_source_import` (Task 4) + `get_space_inventory_snapshot`.

- [ ] **Step 1: Write the failing test**

Add a spec that, against local Supabase (service role), in an isolated test space: seeds a company + trial; calls `commit_source_import` with a proposal carrying one `events` item (`event_type: 'Topline Data'`, `anchor {level:'trial', ref:0}`, `significance:'high'`); asserts one row in `created.events`, that the created event has `event_type_id` = the system "Topline Data" id, `anchor_type='trial'`, `significance='high'`; then re-commits the SAME event with `match.kind='existing'` (id from the snapshot) and asserts it lands in `skipped.events` and creates no new row (dedup no-regression).

```ts
// Pseudocode shape; follow the existing import integration spec's setup/teardown helpers.
const res1 = await rpc('commit_source_import', { /* trial-anchored Topline Data event */ });
expect(res1.created.events).toHaveLength(1);
const ev = await selectEvent(res1.created.events[0]);
expect(ev.anchor_type).toBe('trial');
expect(ev.significance).toBe('high');
const snap = await rpc('get_space_inventory_snapshot', { p_space_id });
const existingId = snap.events.find((e) => e.title === ev.title).id;
const res2 = await rpc('commit_source_import', { /* same event, match existing existingId */ });
expect(res2.skipped.events).toContain(existingId);
expect(res2.created.events).toHaveLength(0);
```

- [ ] **Step 2: Run (in isolation; coordinate with the parallel session)**

Run: `cd src/client && export $(supabase status -o env | xargs) && npm run test:integration -- <spec-name>`
Expected: first run RED (if asserting new behavior before Task 4 applied) then GREEN after `supabase db reset` with the Task 4 migration.

- [ ] **Step 3: Commit**

```bash
git add src/client/test/integration/<spec-file>
git commit -m "test(import): integration proof of unified commit + event dedup no-regression"
```

---

## Task 10: gates, feature mapping, docs regen

**Files:**
- Modify: the feature manifest that maps `commit_source_import` (locate with `grep -rl "commit_source_import" src/client/src/app/**/*.md docs features 2>/dev/null` and the `features:check` manifests).
- Modify: auto-gen runbook blocks via `npm run docs:arch`.

- [ ] **Step 1: features:check mapping**

Run: `cd src/client && npm run features:check`
If it flags `commit_source_import` mapping drift (RPC->table/capability), update the relevant feature `.md` manifest so the unified RPC's table touches (`events`, `event_sources`, `event_types`, `source_documents`, `companies`, `assets`, `trials`) are mapped. Re-run until green.

- [ ] **Step 2: docs:arch regen**

Run: `cd src/client && npm run docs:arch`
Expected: regenerates auto-gen blocks (migration changed). Stage the regen.

- [ ] **Step 3: Full gate sweep**

Run (from `src/client`): `ng lint && ng build && npm run test:units && npm run test:worker && npm run grants:check && npm run features:check`
Run (repo root): `supabase db advisors --local --type all`
Run (isolation, coordinate): `cd src/client && export $(supabase status -o env | xargs) && npm run test:integration`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(import): map unified commit RPC in features check; regen architecture docs"
```

---

## Self-review notes

- Spec coverage: Task 1-3 cover worker contract/validator/prompt (spec 4.1-4.3); Task 4 covers the commit RPC (4.4); Tasks 5-8 cover frontend + the canonical EventTypeService (4.5); the no-regression criteria (spec 5) are enforced by the Task 4 smoke (significance, anchors, citations), Task 9 (dedup), and Tasks 6-8 (review fidelity, glyph restore). Tags deferral honored (no `p_metadata`).
- Type consistency: `EventTypeLite`/`pickEventType`/`eventLeafDisplay` defined in Task 6 and consumed in Task 8; `EventType`/`EventTypeService` defined in Task 5 and consumed in Task 8; `CommitCreated.events` (Task 7) matches the Task 4 return envelope; the unified `EventSchema.event_type`/`significance`/`anchor` (Task 1) match the commit resolution (Task 4).
- The commit migration is authored from the LIVE body (Task 4 Step 1) to avoid inverted-version clobber, and ends with `notify pgrst`.
