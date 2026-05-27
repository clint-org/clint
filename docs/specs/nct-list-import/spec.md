# NCT list import

## Goal

Enable users to seed a competitive landscape by pasting NCT IDs. ClinicalTrials.gov provides authoritative trial data; an AI resolution step normalizes sponsors to companies and interventions to assets. The existing review page and commit RPC handle the rest.

This collapses "how long to stand up a landscape?" from hours to minutes. For an MD evaluating the product, the answer becomes "paste your NCTs and confirm." For an analyst, it replaces tedious manual entry with a review-and-refine workflow.

The import surface is not onboarding-specific. It is a permanent, full-page route that replaces the existing dialog for all import modes (NCT, URL, text). New empty spaces auto-redirect to it.

## Scope

In v1:

- Full-page import route at `/t/:tenantId/s/:spaceId/import` with three tabs: NCT list (default), From URL, From text.
- NCT input: paste NCT IDs, batch fetch from CT.gov API v2, AI resolves companies and assets.
- Duplicate detection on the input page: warn which NCTs already exist in the space, skip them.
- Co-development: when CT.gov lists multiple pharma sponsors, create duplicate asset entries under each company.
- Reuse existing review page with NCT-aware defaults (trial rows collapsed, company/asset rows expanded).
- Reuse existing `commit_source_import` RPC (unchanged).
- Reuse `ai_call` system for billing, quota enforcement, and audit trail.
- Empty-space auto-redirect: engagement landing redirects to `/import` when the space has zero trials and zero companies.
- Import accessible from engagement landing toolbar and manage section.
- Progress steps on the import page: fetching, resolving, done, then auto-navigate to review.
- Database migration to add `'nct'` to the `source_documents.source_kind` CHECK constraint.
- AI status panel on the import page: proactive check of quotas, rate limits, and AI-enabled status. Clear user messaging when AI is unavailable, over quota, or rate-limited. Applies to all three import modes.

Out of scope (deferred to v2):

- CT.gov search URL parsing (paste a clinicaltrials.gov search results URL).
- Free-text CT.gov search within the UI.
- CT.gov snapshot sync (auto-updating trial data after import). See v2 follow-ups.
- Bulk NCT re-import to update existing trials.
- Template landscapes (pre-built therapeutic-area-specific starting points).
- Post-import annotation surface for strategic commentary (existing primary intelligence covers this today; dedicated per-entity annotation is a separate feature).
- Per-trial "refresh from CT.gov" button (stopgap before full sync).

## Architecture

### Data flow

```
User pastes NCT IDs
       |
       v
Input validation (regex, dedup, existing-in-space check)
       |
       v
POST /api/source/nct-resolve  (Bearer auth)
       |
       v
Worker: open ai_call, run preflight (cost cap, rate limit)
       |
       v
Worker: batch fetch CT.gov API v2  /api/v2/studies/{nctId}
       |  (if ALL fail -> return error, close ai_call, do not call LLM)
       |  (if AI fails -> return error with ctgov_data attached for retry)
       v
Worker: programmatic phase mapping (CT.gov phases -> app phase enum)
       |
       v
Worker: build resolution prompt (CT.gov data + inventory snapshot)
       |
       v
Worker: Claude Sonnet 4.6 resolves companies, assets, therapeutic areas
       |
       v
Worker: compute fuzzy alternates for new entities
       |
       v
Worker: close ai_call, return ExtractResponse
       |
       v
Review page (existing, NCT-aware defaults)
       |
       v
commit_source_import RPC (unchanged)
```

### New worker endpoint

`POST /api/source/nct-resolve`

Request body:

```json
{
  "space_id": "uuid",
  "nct_ids": ["NCT01234567", "NCT02345678"]
}
```

Response: same `ExtractResponse` shape as `/api/source/extract`. The review page and commit RPC work unchanged.

Error responses:

| Error code | Condition | HTTP status |
|---|---|---|
| `too_many_ncts` | More than 50 NCT IDs | 400 |
| `no_valid_ncts` | Zero valid NCT IDs after regex/dedup | 400 |
| `all_ncts_failed` | Every CT.gov fetch failed (CT.gov down, network issue) | 502 |
| `ai_resolution_failed` | Claude call failed or timed out (CT.gov data preserved for retry) | 502 |
| `preflight_rejected` | Cost cap or rate limit hit | 429 |

### CT.gov fetch

For each NCT ID, call `GET https://clinicaltrials.gov/api/v2/studies/{nctId}` using the existing `createCtgovClient({ baseUrl: env.CTGOV_BASE_URL })` factory from `worker/ctgov-sync/ctgov-client.ts`. The handler imports across module boundaries: `import { createCtgovClient } from '../ctgov-sync/ctgov-client'`.

Fields consumed:

| CT.gov path | Maps to |
|---|---|
| `identificationModule.nctId` | trial identifier |
| `identificationModule.briefTitle` | trial name |
| `statusModule.overallStatus` | trial status |
| `designModule.phases` | trial phase_type (via programmatic map, not AI) |
| `designModule.enrollmentInfo.count` | trial sample_size |
| `statusModule.startDateStruct` | trial phase_start_date |
| `statusModule.primaryCompletionDateStruct` | trial phase_end_date |
| `designModule.studyType` | detect observational studies (no asset) |
| `sponsorCollaboratorsModule.leadSponsor.name` | company (primary) |
| `sponsorCollaboratorsModule.collaborators[].name` | companies (co-development) |
| `armsInterventionsModule.interventions[].name` | asset name candidates |
| `armsInterventionsModule.interventions[].otherNames` | asset generic_name candidates |
| `conditionsModule.conditions` | therapeutic area / indication |

Batch with `Promise.allSettled`. Each fetch is wrapped with `AbortController` and an 8s timeout (the existing `fetchStudy()` has no built-in timeout). Both `null` returns (404, study not found) and rejections (non-404 HTTP errors) are collected as warnings (`nct_fetch_failed:{nctId}:{reason}`). Failed NCTs do not block the batch.

If ALL NCTs fail (zero successful fetches), the handler returns an `all_ncts_failed` error immediately without opening an AI call, so no quota is consumed.

Upper bound: 50 NCT IDs per request (enforced server-side, error code `too_many_ncts`).

### Programmatic phase mapping

CT.gov phase strings are mapped to the app's phase enum deterministically, before the AI call. This is not left to the LLM.

```typescript
const CTGOV_TO_APP_PHASE: Record<string, string> = {
  'EARLY_PHASE1':  'P1',
  'PHASE1':        'P1',
  'PHASE2':        'P2',
  'PHASE3':        'P3',
  'PHASE4':        'P4',
  'NA':            'OBS',
};

function mapCtgovPhase(phases: string[]): string | null {
  if (!phases || phases.length === 0) return null;
  if (phases.length === 2) {
    const sorted = phases.sort();
    if (sorted[0] === 'PHASE1' && sorted[1] === 'PHASE2') return 'P1_2';
    if (sorted[0] === 'PHASE2' && sorted[1] === 'PHASE3') return 'P2_3';
  }
  return CTGOV_TO_APP_PHASE[phases[0]] ?? null;
}
```

The mapped phase is included in the structured data passed to the AI prompt. The AI does not determine phase; it uses the pre-mapped value.

### AI resolution prompt

Distinct from the document-extraction prompt. Receives structured CT.gov data with pre-mapped phases and resolves:

1. **Sponsor to company.** Normalize to common industry shorthand ("Hoffmann-La Roche" to "Roche", "Eli Lilly and Company" to "Lilly"). Match against existing space inventory when possible.
2. **Intervention to asset.** Extract drug name from intervention descriptions, strip dosing and formulation details ("Tirzepatide 5 mg SC injection" to "Tirzepatide"). Map `otherNames` to `generic_name`. One asset per distinct drug, not per trial.
3. **Conditions to therapeutic areas.** Group CT.gov condition strings into clean TA labels.
4. **Co-development detection.** When `collaborators` includes another pharmaceutical company (not a CRO or academic center), propose duplicate asset entries under each company. The AI distinguishes pharma sponsors from academic/CRO collaborators.
5. **Evidence field.** For every entity, produce `"CT.gov: {nctId}"` as the evidence string. This satisfies the required `evidence` field on the Zod schema. For companies and assets that span multiple trials, use `"CT.gov: {nctId1}, {nctId2}"`.
6. **Source summary.** Produce a one-line summary like `"Batch import of 14 trials across oncology, immunology"` for the `source_summary` field.

Output schema: same `ExtractionResult` shape (companies[], assets[], trials[], markers[], events[]) so the review page works unchanged. Markers and events arrays will be empty for NCT imports.

The prompt receives the space's existing `InventorySnapshot` for match context, same as the document-extraction prompt.

### Edge cases

**Observational studies (no intervention).** CT.gov's `designModule.studyType === 'OBSERVATIONAL'` or empty `armsInterventionsModule.interventions`. The AI sets `asset_ref: null` for these trials. The `TrialSchema` allows `asset_ref: z.number().int().nullable()`. The trial is created without an asset, grouped under its sponsor company only. The review page shows these with an "Observational, no asset" label.

**Academic-only trials (no pharma sponsor).** When the lead sponsor is a university or hospital and no pharma collaborators exist, the AI creates a company entry for the academic institution (e.g., "Memorial Sloan Kettering" or "Mayo Clinic"). These are real sponsors running real trials; filtering them out would lose data. The review page shows them normally. The analyst can deselect if the academic trial is out of scope for their competitive landscape.

**Device trials.** Treated the same as interventional trials. The intervention is a device, not a drug, but the asset model accommodates this (asset is a generic entity, not drug-specific).

**Withdrawn or terminated studies.** CT.gov returns full records for these. They are included in the proposal with their CT.gov status mapped to the app's status enum. The analyst can deselect on the review page if not relevant.

### AI failure handling

If the CT.gov fetch succeeds but the AI resolution call fails (Claude timeout, API error, rate limit, malformed response):

1. The handler closes the `ai_call` with outcome `'error'` and the error reason.
2. The response includes error code `ai_resolution_failed` and a `ctgov_data` payload containing the raw fetched CT.gov records.
3. The frontend shows an error state on the import page: "We fetched your trial data but could not resolve companies and assets. [Retry] or [Import trials only]."
4. **Retry**: re-submits the same NCT IDs. CT.gov data may be re-fetched (simple approach) or cached client-side for the retry (optimization, not required in v1).
5. **Import trials only** (stretch, may defer): navigates to a simplified review page with trials only, no company/asset grouping. The analyst manually assigns companies and assets later via the manage UI. This is a degraded fallback, not the primary path.

For v1, only Retry is required. "Import trials only" can be deferred.

### Co-development handling

When CT.gov lists multiple pharmaceutical sponsors:

1. AI creates a company entry for each pharma sponsor.
2. AI creates a duplicate asset entry under each company (`company_ref` differs).
3. Each trial references its primary sponsor's company and that company's copy of the asset.
4. The `collaborators` text array on the committed trial preserves the full sponsor list from CT.gov.

Example for a Daiichi Sankyo / AstraZeneca co-developed trial:

```
companies[0] = { match: { kind: "new", name: "Daiichi Sankyo" } }
companies[1] = { match: { kind: "new", name: "AstraZeneca" } }
assets[0]    = { match: { kind: "new", name: "Enhertu" }, company_ref: 0 }
assets[1]    = { match: { kind: "new", name: "Enhertu" }, company_ref: 1 }
trials[0]    = { ..., sponsor_ref: 0, asset_ref: 0 }
```

The review page shows both companies and both asset copies. The analyst can deselect one if they only want to track the program under a single company.

### Validation differences from document extraction

The existing `response-validator.ts` runs a "name-in-source-text" check: every new entity's name must appear as a substring in the source document. This makes sense for AI extraction from prose but does not apply to NCT imports where the "source" is structured CT.gov data.

Add an optional `options: { skipNameGrounding?: boolean }` parameter to `validateExtraction`. The current call signature is `validateExtraction(rawJson, inventory, sourceText)`. The new signature is `validateExtraction(rawJson, inventory, sourceText, options?)`. For NCT imports, pass `sourceText` as an empty string and `{ skipNameGrounding: true }`. Steps 5-7 (name-substring, marker grounding, event anchor grounding) are the only consumers of `sourceText`; they are all skipped. All other validation steps (JSON parsing, Zod schema, cross-ref bounds, existing-ID check) run normally.

## Database

### Migration: add `'nct'` to source_kind CHECK constraint

The `source_documents` table (migration `20260526100100`) has:

```sql
source_kind text not null check (source_kind in ('url', 'text'))
```

A new migration widens this to include `'nct'`:

```sql
alter table public.source_documents
  drop constraint source_documents_source_kind_check,
  add constraint source_documents_source_kind_check
    check (source_kind in ('url', 'text', 'nct'));
```

### Type widening

In `src/client/worker/source-extract/types.ts`, widen `source_kind` from `'url' | 'text'` to `'url' | 'text' | 'nct'` on both `ExtractRequest` (if used) and `ExtractResponse`.

In `src/client/src/app/features/source-import/source-import.service.ts`, widen `SourceImportProposal.source_kind` from `'url' | 'text'` to `'url' | 'text' | 'nct'`.

### Source document fields for NCT imports

When the commit RPC inserts the `source_documents` row for an NCT import:

| Field | Value |
|---|---|
| `source_kind` | `'nct'` |
| `source_url` | `null` |
| `source_title` | `"NCT batch import (14 trials)"` (count from batch) |
| `source_text` | JSON string of the CT.gov study records (the raw data that was resolved) |
| `source_date` | ISO date of the import (today) |
| `source_summary` | AI-generated summary from `ExtractionResult.source_summary` |

## Routing

### New routes

| Path | Component | Guards |
|---|---|---|
| `/t/:tenantId/s/:spaceId/import` | `ImportPageComponent` | `authGuard`, `tenantGuard`, `spaceGuard`, `importGuard` (new) |
| `/t/:tenantId/s/:spaceId/import/:aiCallId/review` | `ReviewPageComponent` (existing) | existing guards (unchanged) |

### Import guard

`importGuard` checks that the current user has editor role and that the tenant has AI enabled. This prevents direct navigation to `/import` when the user lacks permission. The guard queries `tenantService` for the `ai_enabled` flag (same check `EngagementLandingComponent` does locally today).

### Empty-space redirect

The `EngagementLandingComponent` checks `get_space_landing_stats`. When `active_trials === 0 && companies === 0`, it redirects to `/t/:tenantId/s/:spaceId/import` via `Router.navigate`. This runs on every landing-page load, not just first visit, so it catches the case where a space is created but never populated.

The redirect is editor-only. Viewers landing on an empty space see an empty state message ("This space has no data yet. Contact your team lead to get started.").

### Entry points

1. **Engagement landing toolbar**: "Import" button, visible when `spaceRole.canEdit() && aiEnabled()`. Navigates to the import route. Replaces the current dialog trigger.
2. **Manage section**: "Import" link in the manage navigation or actions.
3. **Auto-redirect**: empty space landing page (editors only).

The existing `sourceImportService.dialogRequested` signal is removed. The `ImportFromSourceDialogComponent` is deprecated (kept but unused; removal in a follow-up cleanup PR).

## Frontend

### New files

```
src/client/src/app/features/source-import/
  import-page.component.ts            Full-page shell: 3 tabs (NCT, URL, Text)
  nct-input/
    nct-input.component.ts            NCT paste area, parsing, duplicate check, progress
src/client/src/app/core/guards/
  import.guard.ts                     Editor + AI-enabled check for /import route

src/client/worker/
  source-extract/
    nct-handler.ts                    Handler for POST /api/source/nct-resolve
    nct-prompt-builder.ts             AI prompt for entity resolution from CT.gov data
    nct-phase-map.ts                  Deterministic CT.gov phase -> app phase mapping
    ai-health.ts                      GET /api/ai/health handler (Anthropic status page proxy + cache)
```

### Modified files

```
src/client/src/app/features/source-import/
  review-page.component.ts            NCT-aware defaults (collapse trials, expand companies/assets)
  source-import.service.ts            Widen source_kind type to include 'nct', remove dialogRequested

src/client/src/app/features/engagement-landing/
  engagement-landing.component.ts     Empty-space redirect, toolbar Import button (navigate to route)

src/client/src/app/app.routes.ts      Add /import route with importGuard

src/client/worker/
  index.ts                            Add /api/source/nct-resolve route
  source-extract/types.ts             Add NctResolveRequest, widen source_kind to 'url'|'text'|'nct'
  source-extract/response-validator.ts  Add skipNameGrounding option
```

### AI status panel

The import page checks AI availability on load and displays clear status to the user before they begin any import. This applies to all three tabs (NCT, URL, Text) since they all require the AI pipeline.

Three checks run in parallel on component init:

**1. Internal quota check** via `ai_import_status` RPC (new, see Database section):

```sql
create or replace function public.ai_import_status(p_tenant_id uuid)
returns jsonb
language sql stable
security definer
as $$
  select jsonb_build_object(
    'ai_enabled',         coalesce(c.ai_enabled, false),
    'daily_cap_cents',    c.daily_cost_cap_cents,
    'spent_today_cents',  coalesce((
      select sum(cost_estimate_cents)
      from public.ai_calls
      where tenant_id = p_tenant_id
        and created_at > now() - interval '24 hours'
        and outcome not in ('cancelled', 'cost_capped', 'rate_limited')
    ), 0),
    'rate_used_hour',     (
      select count(*)
      from public.ai_calls
      where tenant_id = p_tenant_id
        and user_id = auth.uid()
        and created_at > now() - interval '1 hour'
        and outcome not in ('cancelled', 'cost_capped', 'rate_limited')
    ),
    'rate_limit_hour',    c.per_user_rate_per_hour
  )
  from public.ai_config c
  where c.tenant_id = p_tenant_id;
$$;
```

**2. Anthropic service health** via a new worker endpoint `GET /api/ai/health`:

The Cloudflare Worker exposes a lightweight health endpoint that checks the Anthropic status page API. Anthropic uses the standard Atlassian Statuspage API at `status.claude.com`.

```typescript
// Worker: GET /api/ai/health
// Fetches https://status.claude.com/api/v2/summary.json
// Caches the result in Workers KV or in-memory for 60s to avoid hammering the status page.

async function handleAiHealth(env: Env, cors: Headers): Promise<Response> {
  const cached = await env.AI_HEALTH_CACHE?.get('anthropic_status');
  if (cached) return new Response(cached, { headers: cors });

  const res = await fetch('https://status.claude.com/api/v2/summary.json', {
    signal: AbortSignal.timeout(5000),
  });
  const summary = await res.json();

  // Find the "Claude API" component
  const apiComponent = summary.components?.find(
    (c: any) => c.name === 'Claude API'
  );

  const health = {
    status: apiComponent?.status ?? 'unknown',       // 'operational' | 'degraded_performance' | 'partial_outage' | 'major_outage'
    description: summary.status?.description ?? '',   // "All Systems Operational" etc.
    indicator: summary.status?.indicator ?? 'none',   // 'none' | 'minor' | 'major' | 'critical'
    incidents: (summary.incidents ?? []).map((i: any) => ({
      name: i.name,
      status: i.status,
      impact: i.impact,
    })),
    checked_at: new Date().toISOString(),
  };

  const body = JSON.stringify(health);
  await env.AI_HEALTH_CACHE?.put('anthropic_status', body, { expirationTtl: 60 });
  return new Response(body, { headers: cors });
}
```

The cache ensures only one status page fetch per 60s across all users. No auth required on this endpoint (public status data).

**Fallback:** If the status page itself is unreachable (fetch timeout), the health endpoint returns `{ status: 'unknown', description: 'Unable to check AI service status' }`. The import page treats `unknown` as healthy (optimistic, since the actual Claude call may still work). Only `degraded_performance`, `partial_outage`, and `major_outage` trigger the warning.

**3. Display logic.** A status strip renders above the tab content. Conditions are evaluated in priority order (first match wins):

| Priority | Condition | Display | Submit buttons |
|---|---|---|---|
| 1 | Claude API `major_outage` | "The AI service is currently experiencing an outage. Import is unavailable until the service recovers." | Disabled |
| 2 | Claude API `partial_outage` | "The AI service is experiencing partial disruptions. Import may fail or be slow." | Enabled (with warning) |
| 3 | Claude API `degraded_performance` | "The AI service is running with reduced performance. Import may be slower than usual." | Enabled (with warning) |
| 4 | `ai_enabled === false` | "AI-assisted import is not enabled for this organization. Contact your admin to enable it." | Disabled |
| 5 | `spent_today_cents >= daily_cap_cents` | "Daily AI usage limit reached (resets at midnight UTC). {spent}/{cap} used today." | Disabled |
| 6 | `rate_used_hour >= rate_limit_hour` | "Hourly rate limit reached ({used}/{limit} calls this hour). Try again shortly." | Disabled |
| 7 | `spent_today_cents >= daily_cap_cents * 0.8` | "AI usage at {pct}% of daily limit. {remaining} imports remaining today." (warning, not blocking) | Enabled |
| 8 | Active incidents (any) | "The AI service has an active incident: {incident.name}." (info tone) | Enabled |
| 9 | All clear | No strip shown. | Enabled |

The status strip uses `bg-red-50 border-red-200 text-red-800` for outage/disabled (blocking), `bg-amber-50 border-amber-200 text-amber-800` for degraded/near-limit (warning), `bg-slate-50 border-slate-200 text-slate-600` for informational (active incident, non-blocking). No strip when all clear.

**No polling.** Status is fetched once on page load. If the user hits a failure mid-session (worker returns `ai_resolution_failed`), the import page re-fetches both the quota status and the health endpoint to update the strip with current information.

**Polling.** The status is fetched once on init. It is not polled. If the user hits a limit mid-session (e.g., quota exhausted by a concurrent import), the worker returns the appropriate error code and the import page re-fetches status to update the strip.

### Import page layout

`ImportPageComponent` is a full-page component (not inside the landscape shell). Three tabs using PrimeNG TabView.

**Tab 1: NCT list (default)**

- Textarea, monospace font. Placeholder: "Paste NCT IDs, one per line or comma-separated".
- Live parsing as the user types:
  - Count valid NCT IDs (regex: `/NCT\d{8}/i`).
  - Flag malformed entries with inline error messages.
  - Dedup within the pasted list.
- On submit (not on blur, to avoid spurious queries during tab switches):
  - Query space inventory to check which NCTs match existing `trials.identifier`.
  - Show warning strip: "4 of 18 NCTs are already in this space and will be skipped." List the duplicates with their trial names.
  - User confirms to proceed with the remaining NCTs.
- Submit button: "Fetch and resolve (14 trials)" with count.
- Progress states (rendered inline, replacing the textarea):
  - "Fetching trial data from ClinicalTrials.gov... 8/14"
  - "Resolving companies and assets..."
  - "Done. 14 trials across 6 companies."
  - Auto-navigate to review page after 1s delay (cancelable on navigation away).
- Error states:
  - `all_ncts_failed`: "Could not reach ClinicalTrials.gov. Check your connection and try again." [Retry]
  - `ai_resolution_failed`: "We fetched your trial data but could not resolve companies and assets." [Retry]
  - `preflight_rejected`: "Daily AI usage limit reached. Try again tomorrow or contact your admin."
  - `no_valid_ncts`: "No valid NCT IDs found. IDs should look like NCT01234567."
  - `too_many_ncts`: "Maximum 50 NCT IDs per import. Please split into batches."
- Navigation to review: calls `sourceImportService.setProposal(result)` then `router.navigate` to `/import/:aiCallId/review`, same pattern as the existing dialog.

**Tab 2: From URL**

Same UX as the current `import-from-source-dialog`, rendered inline in the full page instead of a modal. URL input, fetch progress, error handling.

**Tab 3: From text**

Same UX as the current dialog's text mode. Textarea for pasting document content.

### Review page changes

When the proposal's `source_kind === 'nct'`:

- Trial entity rows default to **collapsed**. CT.gov data is authoritative; the user rarely needs to edit trial fields.
- Company and asset entity rows default to **expanded**. AI resolution is the part that needs human review.
- A "CT.gov" badge appears on trial rows indicating the data source.
- Fuzzy alternate panels for companies and assets are expanded by default (collapsed for document imports).
- The source-text left pane is hidden (there is no source document to display). The freed horizontal space is used to show CT.gov metadata inline on trial rows: enrollment count, overall status, primary completion date.
- The "Evidence" column label changes to "Source" and shows the NCT ID as a link to clinicaltrials.gov (instead of a quote from prose).
- Observational trials (no asset) show an "Observational" chip instead of the asset assignment row.

These are conditional defaults based on `source_kind`, not structural changes.

## Worker

### Health endpoint: `GET /api/ai/health`

Returns cached Anthropic service status. See the AI status panel section under Frontend for the full implementation. Added to `worker/index.ts` alongside the NCT resolve route. No auth required (public status data). Response cached 60s via in-memory variable (no KV binding needed; Workers have per-isolate memory that survives across requests within the same isolate).

### New handler: `handleNctResolve`

Located in `src/client/worker/source-extract/nct-handler.ts`.

Pipeline mirrors `handleSourceExtract` with these differences:

| Step | Document extraction | NCT resolution |
|---|---|---|
| Input | URL or pasted text | Array of NCT IDs |
| Source fetch | HTTP fetch or use pasted text | Batch CT.gov API v2 per NCT ID |
| Phase mapping | Left to AI | Programmatic (deterministic, before AI call) |
| AI task | Full entity extraction from prose | Entity resolution from structured data |
| Prompt | `buildPrompt()` | `buildNctPrompt()` (new) |
| Evidence | Quoted from source text | `"CT.gov: {nctId}"` |
| Validation | Name-in-source-text check | Skip name grounding (structured input) |
| CT.gov enrichment | Post-extraction enrichment | CT.gov is the primary source (no separate enrichment step) |
| Fuzzy alternates | Computed for all new entities | Computed for companies and assets only (trials have NCT IDs) |
| Source document | Created from URL/text | kind='nct', text = JSON of CT.gov data |
| AI failure | Fatal, return error | Return error with CT.gov data attached for retry |

Detailed steps:

1. **Auth + space access check** (reuse existing pattern from `handleSourceExtract`).
2. **Validate NCT IDs**: regex `/^NCT\d{8}$/i`, dedup, enforce max 50. Return `no_valid_ncts` or `too_many_ncts` if needed.
3. **Batch fetch from CT.gov**: use `createCtgovClient({ baseUrl: env.CTGOV_BASE_URL })` from `../ctgov-sync/ctgov-client`. Wrap each `fetchStudy()` call with `AbortController` for 8s timeout. Collect via `Promise.allSettled`. Both `null` returns (404) and rejections (HTTP error/timeout) become warnings. If zero successes, return `all_ncts_failed` immediately (no AI call, no quota consumed).
4. **Programmatic phase mapping**: apply `mapCtgovPhase()` to each successful study's `designModule.phases`. Attach the mapped phase to the structured record.
5. **Open ai_call, run preflight** (reuse `ai_call_open`, `ai_call_preflight`). Preflight rejection returns `preflight_rejected`.
6. **Get inventory snapshot** (reuse `get_space_inventory_snapshot`).
7. **Build NCT resolution prompt**: structured CT.gov data (with pre-mapped phases) + inventory as context.
8. **Call Claude** (claude-sonnet-4-6, 8192 max tokens, 60s timeout). On failure: close ai_call with outcome `'error'`, return `ai_resolution_failed` with `ctgov_data` payload.
9. **Validate response**: same validator with `{ skipNameGrounding: true }`. Pass empty string as `sourceText`.
10. **Compute fuzzy alternates**: for companies and assets only (trials already have NCT IDs as identifiers).
11. **Build resolved names and identifiers**: map trial indices to NCT IDs.
12. **Close ai_call** with cost, return `ExtractResponse`.

### NCT resolution prompt

`src/client/worker/source-extract/nct-prompt-builder.ts`

System prompt key instructions:

- You are resolving entity relationships from structured ClinicalTrials.gov data, not extracting from text.
- **Companies**: normalize sponsor names to common industry shorthand. Prefer existing inventory matches. "Hoffmann-La Roche" becomes "Roche". "Eli Lilly and Company" becomes "Lilly". Academic institutions are valid sponsors; create company entries for them (e.g., "Memorial Sloan Kettering"). CROs (Parexel, ICON, Syneos) are not sponsors; ignore them.
- **Assets**: extract the drug/therapy name from intervention descriptions. Strip dosing, formulation, and route details. Map `otherNames` to `generic_name`. One asset per distinct drug, not per trial. For observational studies with no intervention, set `asset_ref: null`.
- **Co-development**: when `collaborators` includes another pharmaceutical company (not academic/CRO), create both companies and duplicate the asset under each. Signal uncertainty if the collaborator role is ambiguous.
- **Therapeutic areas**: group CT.gov `conditions` into clean TA labels. Prefer existing inventory TAs.
- **Trials**: map each NCT study to a trial entry. Use the pre-mapped `phase` value directly; do not change it. Use CT.gov `overallStatus`, dates, and `enrollmentInfo.count` directly. Do not infer or hallucinate.
- **Evidence**: for every entity, produce `"CT.gov: {nctId}"` as the evidence string. For companies and assets spanning multiple trials, use `"CT.gov: {nctId1}, {nctId2}"`.
- **Source summary**: produce a one-line summary like `"Batch import of 14 trials across oncology, immunology"`.
- **Output**: same JSON schema as document extraction (companies[], assets[], trials[] with cross-references). Markers and events arrays must be empty.

User prompt: JSON array of CT.gov study records (with pre-mapped phases) + inventory snapshot, wrapped in XML tags.

### Validation adjustment

Add an optional `options: { skipNameGrounding?: boolean }` parameter to `validateExtraction`. Current signature: `validateExtraction(rawJson, inventory, sourceText)`. New signature: `validateExtraction(rawJson, inventory, sourceText, options?)`. Existing callers are unaffected. For NCT imports, call with `('', inventory, '', { skipNameGrounding: true })`.

When `skipNameGrounding` is true, skip steps 5-7 (name-substring, marker grounding, event anchor grounding). All other validation steps (JSON parse, Zod schema, cross-ref bounds, existing-ID check) run normally.

## Database

### Migration: add `'nct'` to source_kind CHECK constraint

The `source_documents` table (migration `20260526100100`) has:

```sql
source_kind text not null check (source_kind in ('url', 'text'))
```

New migration `YYYYMMDDHHMMSS_add_nct_source_kind.sql`:

```sql
alter table public.source_documents
  drop constraint source_documents_source_kind_check,
  add constraint source_documents_source_kind_check
    check (source_kind in ('url', 'text', 'nct'));
```

No data backfill needed. No RLS changes. No RPC changes (the `commit_source_import` RPC inserts `source_kind` from the payload; it already supports any string that passes the CHECK).

### New RPC: `ai_import_status`

Lightweight, read-only RPC for the import page to check AI availability before the user starts. Returns quota state without opening an `ai_call` or consuming any budget. See the AI status panel section under Frontend for the full function definition.

This RPC is callable by any authenticated user (no admin gate). It reads `ai_config` and aggregates recent `ai_calls` for the tenant and current user. It is `STABLE` (read-only, no side effects).

Migration file: same migration as the CHECK constraint change (`YYYYMMDDHHMMSS_add_nct_source_kind.sql`).

### Type widening

In `src/client/worker/source-extract/types.ts`, widen `source_kind` from `'url' | 'text'` to `'url' | 'text' | 'nct'` on `ExtractResponse`.

In `src/client/src/app/features/source-import/source-import.service.ts`, widen `SourceImportProposal.source_kind` from `'url' | 'text'` to `'url' | 'text' | 'nct'`.

### Source document fields for NCT imports

| Field | Value |
|---|---|
| `source_kind` | `'nct'` |
| `source_url` | `null` |
| `source_title` | `"NCT batch import (N trials)"` where N is the count |
| `source_text` | JSON string of the CT.gov study records |
| `source_date` | ISO date of the import (today) |
| `source_summary` | AI-generated summary from `ExtractionResult.source_summary` |

## Routing

### Route table

| Path | Component | Guards |
|---|---|---|
| `/t/:tenantId/s/:spaceId/import` | `ImportPageComponent` | `authGuard`, `tenantGuard`, `spaceGuard`, `importGuard` (new) |
| `/t/:tenantId/s/:spaceId/import/:aiCallId/review` | `ReviewPageComponent` (existing, unchanged) | existing guards |

### Import guard

`importGuard` checks that the current user has editor role on the space and that the tenant has AI enabled (`tenants.ai_enabled`). This prevents direct navigation to `/import` by viewers or when AI is disabled. The guard queries `tenantService` for the `ai_enabled` flag.

### Empty-space redirect

The `EngagementLandingComponent` checks `get_space_landing_stats`. When `active_trials === 0 && companies === 0` and the user is an editor with AI enabled, it redirects to `/t/:tenantId/s/:spaceId/import` via `Router.navigate`.

Viewers landing on an empty space see an empty state message ("This space has no data yet. Contact your team lead to get started.").

### Entry points

1. **Engagement landing toolbar**: "Import" button, visible when `spaceRole.canEdit() && aiEnabled()`. Navigates to the import route.
2. **Manage section**: "Import" link in the manage navigation or actions.
3. **Auto-redirect**: empty space landing page (editors only, AI enabled).

The existing `sourceImportService.dialogRequested` signal is removed. The `ImportFromSourceDialogComponent` is deprecated (kept but unused; removal in a follow-up cleanup PR).

## Migration plan

### Implementation order

0. **T0: Database migration.** Add `'nct'` to `source_documents.source_kind` CHECK constraint. Create `ai_import_status` RPC. No dependencies.
1. **T1: Worker types, phase map, and NCT prompt builder.** Add `NctResolveRequest` to `types.ts`, widen `source_kind`. Create `nct-phase-map.ts`. Create `nct-prompt-builder.ts`. No dependencies.
2. **T2: Worker NCT handler and route.** Create `nct-handler.ts`. Add `/api/source/nct-resolve` route to `index.ts`. Update `response-validator.ts` with `skipNameGrounding` option. Depends on T1.
3. **T3: Angular import page shell.** Create `ImportPageComponent` with 3 tabs, AI status panel (calls `ai_import_status` RPC on load, disables submit when unavailable), and `importGuard`. Wire the `/import` route. URL/text tabs inline the existing dialog logic. Depends on T0 (RPC exists). Includes Vitest spec for AI status display logic.
4. **T4: Angular NCT input component.** Create `NctInputComponent` with paste area, parsing, duplicate check, progress, error handling, and worker call. Wire into the NCT tab. Depends on T2 (worker endpoint) and T3 (page shell). Includes Vitest spec for NCT parsing, dedup, and validation.
5. **T5: Angular review page NCT-aware defaults.** Modify `ReviewPageComponent` to detect `source_kind === 'nct'` and apply conditional defaults. Show CT.gov metadata in freed space. Depends on T1 (source_kind type). Includes Vitest spec for conditional rendering logic.
6. **T6: Angular routing and entry points.** Empty-space redirect in engagement landing. Toolbar Import button navigates to `/import`. Manage section link. Remove `dialogRequested` signal. Depends on T3 (import route exists). Includes Vitest spec for redirect logic.
Tests are inlined per task. Each task that ships behavior includes its Vitest spec.

T0 and T1 can run in parallel (no dependencies between them).

```yaml
tasks:
  - id: T0
    title: "Database: add 'nct' to source_kind CHECK + ai_import_status RPC"
    domain: database
    depends_on: []
    files:
      - supabase/migrations/YYYYMMDDHHMMSS_add_nct_source_kind.sql (create)
    verification: "supabase db reset"

  - id: T1
    title: "Worker: NCT types, phase map, and prompt builder"
    domain: worker
    depends_on: []
    files:
      - src/client/worker/source-extract/types.ts (modify)
      - src/client/worker/source-extract/nct-phase-map.ts (create)
      - src/client/worker/source-extract/nct-phase-map.spec.ts (create)
      - src/client/worker/source-extract/nct-prompt-builder.ts (create)
    verification: "cd src/client && npx tsc --noEmit && npx vitest run worker/source-extract/nct-phase-map"

  - id: T2
    title: "Worker: NCT handler, health endpoint, route, and validator update"
    domain: worker
    depends_on: [T1]
    files:
      - src/client/worker/source-extract/nct-handler.ts (create)
      - src/client/worker/source-extract/ai-health.ts (create)
      - src/client/worker/source-extract/response-validator.ts (modify)
      - src/client/worker/index.ts (modify)
    verification: "cd src/client && npx tsc --noEmit"

  - id: T3
    title: "Angular: full-page import shell with 3 tabs, import guard, and AI status panel"
    domain: frontend
    depends_on: [T0]
    files:
      - src/client/src/app/features/source-import/import-page.component.ts (create)
      - src/client/src/app/features/source-import/import-page.component.spec.ts (create)
      - src/client/src/app/core/guards/import.guard.ts (create)
      - src/client/src/app/app.routes.ts (modify)
    verification: "cd src/client && ng lint && ng build && npx vitest run src/app/features/source-import/import-page"

  - id: T4
    title: "Angular: NCT input component with parsing, duplicate check, progress, and error handling"
    domain: frontend
    depends_on: [T2, T3]
    files:
      - src/client/src/app/features/source-import/nct-input/nct-input.component.ts (create)
      - src/client/src/app/features/source-import/nct-input/nct-input.component.spec.ts (create)
      - src/client/src/app/features/source-import/import-page.component.ts (modify)
      - src/client/src/app/features/source-import/source-import.service.ts (modify)
    verification: "cd src/client && ng lint && ng build && npx vitest run src/app/features/source-import/nct-input"

  - id: T5
    title: "Angular: review page NCT-aware defaults and CT.gov metadata display"
    domain: frontend
    depends_on: [T1]
    files:
      - src/client/src/app/features/source-import/review-page.component.ts (modify)
      - src/client/src/app/features/source-import/review-page.component.spec.ts (modify or create)
    verification: "cd src/client && ng lint && ng build && npx vitest run src/app/features/source-import/review-page"

  - id: T6
    title: "Angular: routing, empty-space redirect, toolbar and manage entry points"
    domain: frontend
    depends_on: [T3]
    files:
      - src/client/src/app/features/engagement-landing/engagement-landing.component.ts (modify)
      - src/client/src/app/features/engagement-landing/engagement-landing.component.spec.ts (modify or create)
      - src/client/src/app/app.routes.ts (modify)
      - src/client/src/app/features/source-import/source-import.service.ts (modify)
    verification: "cd src/client && ng lint && ng build && npx vitest run src/app/features/engagement-landing"
```

## Test plan

1. **NCT parsing.** Paste valid NCTs, malformed IDs (missing digits, wrong prefix), duplicates within the list, empty input. Validate count updates live, errors flagged inline.
2. **Duplicate detection.** Paste NCTs where some already exist in the space (matching `trials.identifier`). Warning strip shown with count and trial names. Duplicates excluded from submit.
3. **CT.gov fetch.** Valid NCTs return study data. Invalid or withdrawn NCTs produce per-ID warnings. Timeouts do not block the batch.
4. **All NCTs fail.** When CT.gov is unreachable, `all_ncts_failed` error shown. No AI call made. Retry button works.
5. **AI failure.** CT.gov succeeds but Claude times out. `ai_resolution_failed` error shown. Retry button re-submits.
6. **Phase mapping.** Verify `PHASE1` maps to `P1`, `["PHASE2","PHASE3"]` maps to `P2_3`, `NA` maps to `OBS`, empty/unknown maps to `null`.
7. **AI resolution: companies.** Sponsor names normalized (verify "Eli Lilly and Company" becomes "Lilly"). Existing inventory companies matched by name.
8. **AI resolution: assets.** Interventions mapped to clean drug names. Dosing stripped. `generic_name` populated from `otherNames`.
9. **AI resolution: co-development.** Trial with multiple pharma sponsors produces duplicate asset entries. Academic/CRO collaborators handled correctly (academic = company, CRO = ignored).
10. **Observational studies.** Trial with `studyType === 'OBSERVATIONAL'` and no interventions produces a trial with `asset_ref: null`. Review page shows "Observational" chip.
11. **Academic sponsors.** Trial with university as lead sponsor and no pharma collaborators creates a company for the institution.
12. **Review page: NCT defaults.** Trial rows collapsed. Company/asset rows expanded. Source-text pane replaced with CT.gov metadata. Evidence column shows NCT ID links.
13. **Review page: overrides.** User can expand trial rows, override company/asset matches, deselect entities. Fuzzy alternates work.
14. **Commit.** Selected entities committed via `commit_source_import`. `source_kind = 'nct'` passes CHECK constraint. Dashboard shows imported companies, assets, trials.
15. **Empty-space redirect.** New space (zero trials, zero companies) auto-redirects editors to `/import`. Viewers see empty-state message. Non-AI-enabled tenants see empty state, not redirect.
16. **Import guard.** Direct navigation to `/import` by a viewer redirects away. Direct navigation when AI is disabled redirects away.
17. **Import entry points.** Toolbar "Import" button visible to editors with AI enabled. Navigates to `/import`. Manage section link works.
18. **URL/text modes.** Existing import modes still work on the full-page route. No regression from dialog migration.
19. **Rate limiting and quotas.** AI call goes through preflight. Daily cost cap and rate limit enforced.
20. **Max NCT limit.** Submitting more than 50 NCTs returns `too_many_ncts` validation error.
21. **AI status: disabled.** When `ai_enabled === false`, all tabs show "AI-assisted import is not enabled" banner. Submit buttons disabled.
22. **AI status: quota exhausted.** When daily spend meets the cap, banner shows "Daily AI usage limit reached." Submit buttons disabled.
23. **AI status: rate limited.** When hourly rate limit met, banner shows rate limit message. Submit buttons disabled.
24. **AI status: near limit.** When spend is at 80%+ of cap, warning banner shown but submit remains enabled.
25. **AI status: all clear.** No banner shown. Submit enabled.
26. **AI status: Claude outage.** When health endpoint returns `major_outage`, banner shows "AI service is currently experiencing an outage." Submit disabled.
27. **AI status: Claude degraded.** When health endpoint returns `degraded_performance`, warning banner shown, submit remains enabled.
28. **AI status: health endpoint unreachable.** When status.claude.com is itself down, health returns `unknown`. No banner (optimistic). Import proceeds normally.
29. **AI status: mid-session exhaustion.** User starts import, concurrent import exhausts quota, worker returns preflight_rejected. Import page re-fetches both quota status and health endpoint, shows updated banner.
30. **Health endpoint caching.** Two rapid requests to `/api/ai/health` return the same response (60s cache). No duplicate fetches to status.claude.com.
31. **Lint and build.** `cd src/client && ng lint && ng build` passes.

## Branch

`feat/nct-list-import`. Single PR.

Estimated diff: ~1800 lines (800 Angular, 500 Worker, 150 migration + types, 350 tests).

## v2 follow-ups (from Stout MD review)

These items surfaced during the partner-perspective review. They are out of scope for v1 but should be prioritized for v2:

1. **CT.gov refresh/sync.** After initial import, trial data is a frozen snapshot. A per-trial "refresh from CT.gov" button (small effort) or automatic daily sync (medium effort) addresses the "is this current?" question that every pharma VP will ask.
2. **Post-import annotation surface.** The NCT import creates raw data. Stout's differentiation is the strategic overlay: annotations, curation notes, competitive reads. The existing primary intelligence feature covers this at the entity level, but a lightweight per-entity annotation field (on companies, assets, trials) would make the advisory layer more visible immediately after import.
3. **Template landscapes.** Pre-built NCT sets for the 5-10 most common pharma CI landscapes (oncology checkpoint inhibitors, GLP-1 agonists, ADC programs). Reduces "how long to stand up a landscape?" from "paste and confirm" to "pick your TA and click start."
4. **End-to-end demo narrative.** Document or prototype the full walkthrough: empty space, NCT import, review, commit, populated dashboard with phase bars and markers, first intelligence read. The spec ends at commit; the demo needs to show the payoff.

## Open questions

None. All decisions resolved during spec clarification and self-review.
