---
id: spec-2026-press-release-to-event
title: Press release to event extraction
slug: press-release-to-event
status: draft
created: 2026-04-28
updated: 2026-04-28
parent: 2026-04-28-ai-inventory-design.md
---

# Press release to event extraction

## Summary

A user pastes a press-release URL or text into the Events page. An LLM extracts a single structured event and pre-fills the existing event-creation form. The user reviews, edits if needed, and saves. This is the first AI feature in the platform and the foundation for the broader AI inventory roadmap (see [`2026-04-28-ai-inventory-design.md`](2026-04-28-ai-inventory-design.md)).

## Goals

- Cut the time to log a press-release-derived event from ~2 minutes (read, transcribe, classify) to ~15 seconds (paste, review, save).
- Establish the AI infrastructure backbone the rest of the inventory will reuse: provider routing, audit log, cost cap, rate limit, error categorization.
- Ship without committing to architectural decisions (BYO providers, admin UI, multi-event, citations) that v1 doesn't yet have signal to make correctly.

## Non-goals (v1)

- BYO Anthropic / Bedrock / Azure provider modes (data model scaffolded; not surfaced).
- Admin UI for tenant AI configuration (provider mode, model config, cost cap). SQL only in v1.
- Per-field source citations or source-text panel.
- Re-run / regenerate flow with user feedback.
- Multi-event extraction from a single press release.
- PDF press release upload.
- Drafts persistence (recovering from accidental modal close).
- Observability dashboard. Day-2 ops are SQL queries against `ai_calls`.
- Per-extraction model picker. Model is tenant-level.
- Data minimization toggles (`ai_send_inventory`, `ai_log_raw_payloads`).

## Operating constraints (inherited from inventory doc)

1. Tenant + space isolation: AI calls never leak data across tenants or across spaces within a tenant.
2. Provenance over fluency: extracted output is grounded in the source press release. Source URL is always captured.
3. Authority through restraint: no anthropomorphic AI personality. The dialog feels like a structured intake form, not a chatbot.
4. User-in-the-loop: every AI-extracted event passes through human review before persisting.
5. Audit log is the floor, not the ceiling: every LLM call writes to `ai_calls` regardless of outcome.

## User flow (happy path)

1. User on the Events page clicks **Import from press release**.
2. `PressReleaseImportDialog` opens. User pastes a URL (or expands the "paste text" section and pastes the body).
3. User clicks **Extract**. Dialog shows a deterministic spinner: "Extracting event from press release..."
4. Edge Function fetches the URL (if URL provided), cleans HTML to plain text, calls Claude Haiku with the press-release text plus the user's space inventory, parses the structured output, writes an `ai_calls` audit row.
5. Dialog closes; the existing event-creation form opens pre-filled with the extracted fields and the source URL attached.
6. User reviews, edits any field, saves via the existing `EventService.create()` path.

Latency target: 3-7 seconds for URL flow, 2-5 seconds for paste-text flow. Edge Function timeout: 30s. Angular timeout: 35s.

## User flow (failure paths)

All failures categorized; each maps to a user-facing message. Errors carry an optional `hint` consumed by the dialog (currently used for the "Open in browser" escape on URL fetch failures).

| Code | When it fires | User-facing message | Hint |
|---|---|---|---|
| `auth` | Missing/invalid JWT | "Please sign in again." | none |
| `access` | User lacks `has_space_access(space_id)` | "You don't have access to this space." | none |
| `disabled` | Tenant `ai_provider_mode = 'disabled'` (rare in practice — the import button is conditionally rendered against this mode; this code defends against tenant-mode flips mid-session and direct API access) | "AI extraction is not enabled for your tenant." | none |
| `cap_reached` | Monthly token cap reached | "Your tenant has reached its monthly AI usage cap. Contact your admin." | none |
| `rate_limited` | >5 extractions/min for this user | "Too many extractions in a short time. Wait a moment and try again." | none |
| `fetch_failed` | URL returned non-2xx, timed out, or returned PDF | "We could not fetch this URL. The site may be blocking automated access." | `open_in_browser` |
| `empty_source` | Cleaned text < 100 chars | "We could not find press release content at this URL." | `open_in_browser` |
| `parse_failed` | Claude output failed JSON-schema or business validation | "Extraction returned no usable result. Try pasting the article body instead." | none |
| `provider_error` | Anthropic API failure or unhandled exception | "Something went wrong. Please try again." | none |
| `invalid_input` | Both `source_url` and `source_text` missing | "Please provide either a URL or pasted text." | none |

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (Angular 19)                                        │
│                                                              │
│   EventsPageComponent                                        │
│     └─ button: "Import from press release"                   │
│         └─ PressReleaseImportDialogComponent (new)           │
│             └─ AiGatewayService.extractPressReleaseEvent     │
│                  └─ supabase.functions.invoke(...)           │
│                                                              │
│   On success: EventFormComponent opens with prefill          │
└──────────────────────────────────────────────────────────────┘
                           │
                           ▼ HTTPS + JWT
┌──────────────────────────────────────────────────────────────┐
│  Supabase Edge Function: extract-press-release-event         │
│                                                              │
│   imports from supabase/functions/_shared/                   │
│     auth.ts        rate-limit.ts                             │
│     tenant.ts      anthropic.ts                              │
│     cost-cap.ts    audit.ts                                  │
│                    errors.ts                                 │
│                                                              │
│   feature-local: fetch-url.ts, prompt.ts, parse.ts           │
└──────────────────────────────────────────────────────────────┘
              │                            │
              ▼                            ▼
       ┌─────────────────┐         ┌──────────────────┐
       │  Anthropic API  │         │  Supabase Postgres│
       │  Claude Haiku   │         │  ai_calls         │
       │  (tools mode)   │         │  events / spaces  │
       └─────────────────┘         └──────────────────┘
```

## Data model

### New table: `ai_calls`

```sql
create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  space_id uuid references spaces(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  feature text not null,
  prompt_version text not null,
  model text not null,
  status text not null,
  input_tokens int,
  output_tokens int,
  cost_cents int,
  latency_ms int,
  raw_input jsonb,
  raw_output jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index ai_calls_tenant_created_idx on ai_calls (tenant_id, created_at desc);
create index ai_calls_tenant_feature_created_idx on ai_calls (tenant_id, feature, created_at desc);
create index ai_calls_user_created_idx on ai_calls (user_id, created_at desc);

alter table public.ai_calls enable row level security;

-- Service role inserts; no client-side insert.
create policy ai_calls_service_role_insert
  on public.ai_calls for insert
  to service_role
  with check (true);

-- Tenant admins can read their tenant's rows.
create policy ai_calls_tenant_admin_select
  on public.ai_calls for select
  to authenticated
  using (
    tenant_id in (
      select tenant_id from tenant_members
      where user_id = (select auth.uid()) and role = 'admin'
    )
  );
```

`status` is one of: `success`, `auth`, `access`, `disabled`, `cap_reached`, `rate_limited`, `fetch_failed`, `empty_source`, `parse_failed`, `provider_error`, `invalid_input`.

### New columns on `tenants`

```sql
alter table public.tenants
  add column ai_provider_mode text not null default 'platform'
    check (ai_provider_mode in ('platform', 'byo_anthropic', 'byo_bedrock', 'disabled')),
  add column ai_provider_config jsonb,
  add column ai_monthly_token_cap int not null default 1000000,
  add column ai_cap_resets_at timestamptz not null default date_trunc('month', now()) + interval '1 month',
  add column ai_model_config jsonb not null default jsonb_build_object(
    'default', 'claude-haiku-4-5',
    'overrides', jsonb_build_object()
  );
```

In v1 only `platform` and `disabled` modes are wired in the Edge Function. The `byo_*` values are reserved so future enablement is a code change, not a migration. `ai_provider_config` is reserved for encrypted credentials when BYO ships.

### Existing tables

`events`, `event_sources`, `event_categories`, `event_threads` are unchanged. Extracted output maps directly to existing fields. `event_sources` already supports multiple URLs per event.

## Edge Function: `extract-press-release-event`

### Layout

```
supabase/functions/
  _shared/
    auth.ts          # JWT validation, user_id extraction
    tenant.ts        # tenant + provider mode resolution
    cost-cap.ts      # monthly token budget enforcement
    rate-limit.ts    # 5 calls/min per user
    anthropic.ts     # Claude tools-API client
    audit.ts         # ai_calls insert helper
    errors.ts        # CategorizedError + errorResponse
  extract-press-release-event/
    index.ts         # request handler
    fetch-url.ts     # readability-style URL fetcher
    prompt.ts        # system + user prompts, JSON schema, prompt version
    parse.ts         # output validation
```

### Supabase clients

The Edge Function constructs two Supabase clients:

- **User-bound client** (created with the request's JWT). Used for tenant resolution, space-access checks (`has_space_access`), and the cost-cap query. RLS protects tenant boundaries automatically — a user cannot read another tenant's row even via the Edge Function.
- **Service-role client** (created with `SUPABASE_SERVICE_ROLE_KEY`). Used only for the `ai_calls` insert. The audit log must record every call regardless of caller authority, and RLS on `ai_calls` permits inserts only via service role.

`_shared/audit.ts` accepts a service-role client; all other shared modules accept the user-bound client. This keeps privilege scoping explicit at the call site.

### Pipeline (in order)

1. Authenticate request (`_shared/auth.ts`); resolve `userId`.
2. Parse body: `{ space_id, source_url?, source_text? }`. If neither URL nor text: `invalid_input`.
3. Resolve tenant context (`_shared/tenant.ts`); load `ai_provider_mode`, `ai_model_config`, `ai_monthly_token_cap`, `ai_cap_resets_at`. If mode is `disabled`: `disabled` error. If user lacks space access: `access` error.
4. Cost-cap check (`_shared/cost-cap.ts`): sum `input_tokens + output_tokens` for this tenant since `ai_cap_resets_at - 1 month`. If `>= ai_monthly_token_cap`: `cap_reached`. Lazily roll the cap-reset window if `now() >= ai_cap_resets_at`.
5. Rate-limit check (`_shared/rate-limit.ts`): count this user's `ai_calls` in last 60s. If `>= 5`: `rate_limited`.
6. If `source_url` is set, fetch and clean (`fetch-url.ts`). On non-2xx, timeout, or PDF content-type: `fetch_failed`. Else use `source_text` directly.
7. If cleaned text length `< 100`: `empty_source`.
8. Load space inventory (companies, products, trials, categories).
9. Resolve model: `ai_model_config.overrides[feature] ?? ai_model_config.default ?? 'claude-haiku-4-5'`. Validated against the hardcoded enum (`claude-haiku-4-5`, `claude-sonnet-4-6`, `claude-opus-4-7`); unknown values fall back to default.
10. Build prompt (`prompt.ts`); call Claude with tools API (`_shared/anthropic.ts`). On API failure: `provider_error`.
11. Parse and validate Claude output (`parse.ts`). On schema or business-rule failure: `parse_failed`. Raw output is preserved in `ai_calls.raw_output` regardless.
12. Write `ai_calls` row with full audit data (always, regardless of success or failure once we know the tenant).
13. Return `{ extracted, source_url }` to Angular, or a categorized error.

### Prompt design (`prompt.ts`)

```ts
export const PROMPT_VERSION = 'v1';

export const EVENT_SCHEMA = {
  type: 'object',
  required: ['title', 'event_date', 'category_id', 'description'],
  properties: {
    title: { type: 'string', maxLength: 200 },
    event_date: { type: 'string', format: 'date' },
    category_id: { type: 'string' },
    description: { type: 'string' },
    priority: { type: 'string', enum: ['high', 'low'] },
    company_id: { type: ['string', 'null'] },
    product_id: { type: ['string', 'null'] },
    trial_id: { type: ['string', 'null'] },
    tags: { type: 'array', items: { type: 'string' } }
  }
};
```

System prompt rules:

- Precise and conservative; never invent dates or facts not in the source.
- Set entity IDs only when the press release names an entity that exactly matches the user's inventory; otherwise null.
- Set at most one of `company_id`, `product_id`, `trial_id` (most specific wins: trial > product > company).
- Dates always YYYY-MM-DD. Use the press release's publication date when stated; otherwise today's date.
- Set `priority='high'` for: Phase 3 readouts, FDA approvals/rejections, M&A, partnership announcements, C-suite executive transitions. Else `low`.

User prompt embeds: the user's space inventory (companies, products, trials, categories with IDs), then the cleaned press-release text.

Prompts ship as a versioned constant. Updating the prompt bumps `PROMPT_VERSION`; `ai_calls.prompt_version` records which version ran.

### Output validation (`parse.ts`)

Validates:
- `event_date` parses as YYYY-MM-DD; not >100 years future, not <50 years past.
- `category_id` is in the inventory's category list.
- At most one of company_id/product_id/trial_id is non-null.
- Title non-empty.
- Tags array length <= 20.

Validation failures produce `parse_failed`. Raw Claude output remains in the audit log for diagnosis.

### URL fetcher (`fetch-url.ts`)

- Plain `fetch()` with `User-Agent: Clinical Trial Dashboard / press-release-extractor`.
- 10s timeout (within the Edge Function's outer 30s budget).
- HTML cleaned with a Mozilla-readability-style text extractor (lightweight Deno port; no headless browser). Strips nav, footer, sidebar, ads.
- PDF responses (`Content-Type: application/pdf`) produce `fetch_failed` with hint "PDF press releases not supported in v1 - paste the text instead."
- Non-2xx, DNS failures, timeouts produce `fetch_failed`.

## Angular layer

### New: `AiGatewayService` (`src/client/src/app/core/ai/ai-gateway.service.ts`)

Single method for v1; named `AiGateway` because it grows by feature:

```ts
@Injectable({ providedIn: 'root' })
export class AiGatewayService {
  async extractPressReleaseEvent(input: {
    spaceId: string;
    sourceUrl?: string;
    sourceText?: string;
  }): Promise<ExtractPressReleaseResult>;
}

export type ExtractPressReleaseResult = {
  extracted: {
    title: string;
    event_date: string;       // YYYY-MM-DD
    category_id: string;
    description: string;
    priority: 'high' | 'low';
    company_id: string | null;
    product_id: string | null;
    trial_id: string | null;
    tags: string[];
  };
  source_url: string | null;
};
```

Throws `AiGatewayError` on failure.

### New: `AiGatewayError` and translators (`src/client/src/app/core/ai/ai-gateway-errors.ts`)

```ts
export type AiErrorCode =
  | 'auth' | 'access' | 'disabled' | 'cap_reached' | 'rate_limited'
  | 'fetch_failed' | 'empty_source' | 'parse_failed'
  | 'provider_error' | 'invalid_input';

export class AiGatewayError extends Error {
  constructor(public code: AiErrorCode, message: string, public hint?: string) { super(message); }
}

export function aiGatewayMessageFor(code: AiErrorCode): string;
export function aiGatewayHintFor(code: AiErrorCode): string | undefined;
```

The `AiErrorCode` union is mirrored in `supabase/functions/_shared/errors.ts`. Each file carries a `// keep in sync with <other path>` comment. Adding a code on one side without the other falls through to the default "Something went wrong" message - discoverable, not silent.

Future AI-feature dialogs (e.g., dossier-generation) reuse `aiGatewayMessageFor` / `aiGatewayHintFor` directly. No per-dialog message switches.

### New: `PressReleaseImportDialogComponent`

Path: `src/client/src/app/features/events/press-release-import-dialog.component.ts`. Standalone PrimeNG `p-dialog`. Three states: `idle` (form visible), `extracting` (spinner + copy "Extracting event from press release..."), `error` (form visible with error banner above).

Inputs: `visible: model<boolean>`, `spaceId: input.required<string>`.
Outputs: `extracted: output<ExtractPressReleaseResult>`.

Internal state via signals: `urlInput`, `textInput`, `showText`, `status`, `errorBanner`.

On error, banner uses `aiGatewayMessageFor(err.code)`. If `aiGatewayHintFor(err.code) === 'open_in_browser'` and `urlInput` is non-empty, the banner renders an "Open in browser" anchor opening the URL in a new tab.

### Touched: `EventFormComponent`

Adds an optional input `prefill: Partial<EventFormPrefill> | null`. When non-null in `mode: 'create'`, fields populate from prefill. Manual-create path (prefill null) is unchanged.

Prefill mapping:

| Extracted field | EventForm target |
|---|---|
| `title` | title text input |
| `event_date` | date picker (parsed to Date) |
| `category_id` | category dropdown |
| `description` | description textarea |
| `priority` | priority radio |
| `company_id` / `product_id` / `trial_id` | entity-level dropdown set to whichever non-null + entity selection |
| `tags` | tags chips |
| `source_url` | sources list with `[{ url, label: null }]` |

### Touched: `EventsPageComponent`

Adds a single button next to the existing **Add event**:

```html
<button pButton severity="secondary" (click)="openImportDialog()">
  Import from press release
</button>
<app-press-release-import-dialog
  [(visible)]="importDialogVisible"
  [spaceId]="spaceId()"
  (extracted)="onExtracted($event)"
></app-press-release-import-dialog>
```

`onExtracted(result)` opens the existing event-form dialog with `prefill={...result.extracted, source_url: result.source_url}`.

### Conditional rendering

The "Import from press release" button only renders when the tenant context's `ai_provider_mode !== 'disabled'`. The existing tenant resolver is extended to include `ai_provider_mode` in the tenant signal that's already loaded at app boot.

## Configuration and secrets

- Edge Function env: `ANTHROPIC_API_KEY` (required; function refuses to start if missing) and `SUPABASE_SERVICE_ROLE_KEY` (required; used by the service-role client for `ai_calls` inserts). Both set via `supabase secrets set` in production, `.env.local` in dev.
- No frontend-side AI keys. The browser only ever talks to the Edge Function.
- Default monthly token cap: 1,000,000 tokens. Order-of-magnitude $1-2 of Haiku at current prices; the cap is denominated in tokens (not dollars) to stay model-agnostic. Tunable per tenant via SQL.
- Default model: `claude-haiku-4-5`. Tunable per tenant via SQL on `ai_model_config`.

## Testing

Three layers; bug density informs depth:

1. **Edge Function unit tests** (Deno test runner): `parse.ts` (full coverage of validation rules), `prompt.ts` (snapshot test of system + user prompt template), `fetch-url.ts` (canned HTML fixtures from Businesswire, PR Newswire, GlobeNewswire, an IR site), `_shared/cost-cap.ts` and `_shared/rate-limit.ts` (seeded `ai_calls` rows), `_shared/errors.ts` (response shape stability). No live Claude. No live network.
2. **Angular component tests** (Karma + Jasmine): `PressReleaseImportDialogComponent` rendering across idle / extracting / error states with mocked service throwing each error code; `EventFormComponent` prefill mapping; `AiGatewayService` request body shape and error mapping with mocked `supabase.functions.invoke`.
3. **Smoke test** (manual checklist before each release; can become Playwright later): real Businesswire URL extraction end-to-end; real PR Newswire URL; press release with no inventory match (entity fields stay null); URL that 403s (verify `fetch_failed` + "Open in browser" hint); paste-text path; cap reached (set tenant cap to 100, run 3+); rate limit (6 calls in 60s); verify `ai_calls` rows have correct tenant_id, status, tokens, cost.

## Rollout

Single rollout; no feature flag. Order of operations:

1. Apply migrations.
2. Deploy Edge Function with `ANTHROPIC_API_KEY` set.
3. Deploy Angular build.

Rollback: bulk-update every tenant's `ai_provider_mode` to `disabled`. The button conditionally renders against tenant context, so the feature disappears platform-wide on one UPDATE.

Post-launch monitoring (SQL queries against `ai_calls`):

- Per-tenant monthly cost: `select tenant_id, sum(cost_cents) from ai_calls where created_at >= date_trunc('month', now()) group by tenant_id`
- Failure rate by code: `select status, count(*) from ai_calls where created_at >= now() - interval '1 day' group by status`
- Slow extractions: `select * from ai_calls where latency_ms > 15000 order by created_at desc`

A `/admin/ai-usage` page is a fast follow if these queries become a daily ritual; not in v1.

## Open questions for implementation

- Specific HTML cleaner library for the Deno-side URL fetcher. Candidates: `@mozilla/readability` port to Deno, or a simpler DOMParser-based stripper. Pick during implementation based on what's available and tested.
- Cost calculation rates (per-million-token prices for Haiku/Sonnet/Opus). Live prices fluctuate; constants live in `_shared/anthropic.ts` with an explanatory comment and a date stamp on each value. Update path is a one-line code change.
- Exact UX of the "extracting..." spinner copy and timing. Acceptable to refine during implementation; the categorized-error mapping is the contract.

## References

- Parent: [`2026-04-28-ai-inventory-design.md`](2026-04-28-ai-inventory-design.md) - operating constraints and broader AI roadmap.
- Whitelabel context: [`2026-04-27-whitelabel-design.md`](2026-04-27-whitelabel-design.md) - tenant + space isolation, host-based resolution.
