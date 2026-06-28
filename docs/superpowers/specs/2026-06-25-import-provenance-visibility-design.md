# Import Provenance Visibility for Space Curators

Date: 2026-06-25
Status: Design approved, pending spec review
Branch: `feat/import-provenance-visibility` (off `develop`)

## Problem

Clint's AI import already records full source provenance. When an import runs, the
original source is saved as a `source_documents` row (raw pasted text or fetched URL,
plus title, kind, who imported it, and when). Every entity the import creates
(`companies`, `assets`, `trials`, `markers`, `events`) carries a `source_doc_id`
foreign key back to that row, set at commit time inside `commit_source_import`.

The link is **stored but invisible after commit**. During the import review step a user
sees the source header (title / URL), but once committed, a space owner or editor
clicking a trial or marker has no way to see "this landed from the Pfizer Q2 press
release on Jun 3, imported by Jane." The provenance lives in the database, not on the
entity. It is also source-document-level, not field-level: we can say "this row came
from import X," not "this exact date came from line 42."

## Goal

Let space **owners and editors** quietly trace how any AI-imported entity landed:
who imported it, from what source, when, and what the original ingested text said.
Quiet, not loud: the affordance appears only when there is provenance to show
(manual rows have `source_doc_id = null` and render nothing), reads as a reference
affordance rather than a CTA, and never interrupts the clean dashboard. Modeled on the
quiet drill-down idiom already used for AI calls in platform admin
(`super-admin-ai-usage.component.ts` / `get_ai_call_detail`).

## Scope

In scope:
- A read-only provenance surface on the persistent detail surfaces of all five
  AI-importable entities: trials, assets, companies, markers, events.
- Access limited to space owners and editors (viewers see nothing; platform admin keeps
  its support bypass).
- Source-document-level provenance only (no field-level attribution).

Out of scope (explicit):
- Field/line-level provenance ("this date came from line 42").
- Ephemeral hover tooltips (`marker-tooltip`, `catalyst-row-tooltip`) -- too transient
  to host a click-to-open drawer, and surfacing provenance there would be loud.
- Editing or re-running imports from the provenance surface (read-only).
- Surfacing provenance to viewers.

## Distinction this feature relies on

There are two unrelated notions of "source" in the product. This feature is about the
second:

1. **Editorial citation** -- the `source_url` a marker/event already displays
   (e.g. "clinicaltrials.gov", a press-release link). The analyst's cited reference for
   the *fact*. Already surfaced today. Not changed by this work.
2. **Import provenance** -- `source_doc_id` -> the `source_documents` row: which AI
   import batch created this row, the raw ingested text / fetched URL, who ran it, when.
   This is "how it landed" and is currently invisible. This is what we surface.

## Approach

A single SECURITY DEFINER RPC plus two small reusable Angular components, wired into the
existing detail surfaces. No new entity columns are needed -- `source_doc_id` already
exists on all five entity tables (migration `20260526100300_add_source_doc_provenance`).

### Data access: one SECURITY DEFINER RPC (approach B, chosen)

`source_documents` is currently readable only by agency members and platform admins
(RLS in `20260526100100_create_source_documents.sql`), and the importer's identity lives
in `auth.users`, which is not RLS-readable. Rather than broaden the table's read surface
globally (rejected approach A), we add one controlled RPC -- consistent with the
codebase's established pattern (`get_ai_call_detail`, `commit_source_import`, the
whitelabel RPCs are all SECURITY DEFINER) and with the project's least-privilege posture
(`source_documents` stays "dark"; the RPC is the only new read path).

```
public.get_source_document(p_source_doc_id uuid) returns jsonb
```

Behavior:
- Resolve the `space_id` of the source document.
- Gate: `if not public.has_space_access(v_space_id, array['owner','editor']) then
  raise exception 'forbidden' using errcode = '42501'; end if;`
  (`has_space_access` already grants platform admin a read bypass.)
- Return a single JSONB object:
  - `source_doc_id`, `source_title`, `source_kind` (`url` | `text`), `source_url`,
    `source_text` (raw ingested body), `fetched_at`, `fetch_outcome`, `created_at`
  - `imported_by_email` -- joined from `auth.users` via the SECURITY DEFINER context
  - `ai_model`, `ai_outcome` -- from the linked `ai_calls` row
    (`ai_calls.source_doc_id = source_documents.id`), best-effort / nullable
- Unknown or null id: return `null` (the component renders nothing); do not raise.
- End the migration with `notify pgrst, 'reload schema';` so PostgREST exposes the new
  signature immediately (per the project's RPC-reload convention).

One RPC, not two: `source_text` is capped at 500k but is typically a few KB (a press
release), and a detail surface loads a single entity, not a list -- so returning the body
in the same call (one round trip, lazy: only when `source_doc_id` is non-null) is simpler
than a summary/detail split. If large-body cost ever bites, split later (YAGNI).

The `@audit:tier1` marker is **not** required: this is a read-only RPC, not a Tier 1
admin/governance mutation, so `record_audit_event()` does not apply.

### Frontend: two reusable components

Both standalone, `OnPush`, slate aesthetic, no toasts.

1. **`SourceProvenanceLineComponent`** (`shared/components/source-provenance/`)
   - Input: the entity's `source_doc_id` (and `space_id` if needed for the call).
   - Renders nothing when `source_doc_id` is null.
   - When present: an uppercase-tracked, slate reference line --
     `IMPORTED FROM <source_title> · <date> →` -- reading as a reference affordance, not
     a CTA (per the design-system / help-page convention).
   - Calls `get_source_document` once when it mounts with a non-null `source_doc_id`, to
     resolve the inline title/date (the approved layout shows the title before any click).
     While in flight it shows a neutral `IMPORTED SOURCE →`, then fills in the title.
   - On click, opens the drawer with that same already-fetched payload (no second round
     trip).
   - RPC errors surface quietly (the line simply does not render / logs); no toast storm.

2. **`SourceDocumentDrawerComponent`** (same folder)
   - PrimeNG `p-drawer` (matching existing entity drawers like
     `entity-marker-drawer.component`), read-only.
   - Header: `source_title`, a kind badge (URL paste / text paste), the `source_url` link
     when present, `imported by <imported_by_email> · <date>`, `fetch_outcome`, and
     `ai_model` when present.
   - Body: the raw `source_text` in a monospace, scrollable, copyable block -- the same
     `<pre>` treatment used by the AI-calls detail panel.
   - Nothing editable.

A thin service method (e.g. on a new `SourceProvenanceService` or an existing import
service) wraps `supabase.client.rpc('get_source_document', { p_source_doc_id })` and
returns the typed payload.

### Wiring points (five persistent detail surfaces)

Each detail surface gets `<app-source-provenance-line>` near the entity header/metadata,
and its data service adds `source_doc_id` to the entity `select` (the entity's own
column -- no RLS concern). A new TypeScript field `source_doc_id: string | null` is added
to each model.

| Entity   | Surface(s)                                                                 | Service to extend                |
|----------|----------------------------------------------------------------------------|----------------------------------|
| Trial    | `manage/trials/trial-detail.component`                                      | `trial.service` (`TRIAL_SELECT`) |
| Asset    | `manage/assets/asset-detail.component`                                      | `asset.service`                  |
| Company  | `manage/companies/company-detail.component`                                 | `company.service`                |
| Marker   | `shared/components/marker-detail-content.component` (+ `marker-detail-panel`, `landscape/entity-marker-drawer`) | `marker.service` |
| Event    | `events/event-detail-panel.component`                                      | `event.service`                  |

For markers and events, the existing editorial-citation UI (`source_url`,
`CtgovSourceTagComponent`, the CT.gov provenance block) stays untouched; the new line is
additive and visually distinct ("imported from" vs "source").

## Data flow

```
Entity detail page loads
  -> entity query already returns source_doc_id (added to select)
  -> if source_doc_id != null, <app-source-provenance-line> renders
       -> lazy rpc('get_source_document', { p_source_doc_id })
            -> RPC gates on has_space_access(space_id, ['owner','editor'])
            -> returns { title, kind, url, text, imported_by_email, dates, ai_model, ... }
       -> line shows "IMPORTED FROM <title> · <date> →"
  -> on click -> SourceDocumentDrawer opens with the cached payload (read-only)
```

## Error / edge handling

- `source_doc_id` null -> nothing renders (the common case for manual entities).
- RPC returns null (deleted source doc, since FK is `on delete set null` -- though a set
  id implies the row existed) -> line renders nothing / logs; no error toast.
- Viewer or non-member calls the RPC -> `42501`; the component swallows it quietly (the
  line is only shown to owners/editors anyway, but the server is the real gate).
- Very large `source_text` -> drawer body scrolls; no truncation in v1.

## Testing

Following the repo's existing conventions (verified against current specs):

### DB / RPC integration -- `integration/tests/source-provenance-rpc.spec.ts`
Run with `npm run test:integration` (export `SUPABASE_SERVICE_ROLE_KEY` from
`supabase status` first). Uses `buildPersonas()` + the `as(p, '<persona>')` harness and
the `expectOk` / `expectCode('42501')` helpers. The personas fixture already provides the
exact role matrix: `space_owner`, `contributor` (editor), `reader` (viewer),
`platform_admin`, and a cross-space space.

Setup mirrors `source-import-rpc.spec.ts`: open + close an `ai_call`, then
`commit_source_import` as `contributor` to produce a `source_documents` row and entities
stamped with its `source_doc_id`. Then assert against `get_source_document`:
- `space_owner` -> `expectOk`, payload has `source_title`, `source_text`,
  `imported_by_email`, and `ai_model` from the linked call.
- `contributor` (editor) -> `expectOk`.
- `reader` (viewer) -> `expectCode('42501')`.
- `no_memberships` / cross-space persona -> `expectCode('42501')`.
- unknown / random uuid -> `expectOk` with `null` data (no raise).
- Teardown deletes created entities + source doc + ai_call via the admin client, matching
  the existing `afterAll` cleanup pattern.

### Frontend unit -- co-located `*.spec.ts`, run with `npm run test:units`
(`vitest.units.config.ts`, node env). Use the established `Injector.create` +
`runInInjectionContext` setup and the `makeRpcResult` / `vi.fn()` RPC-stub idiom to mock
`supabase.client.rpc('get_source_document', …)`:
- `source-provenance.service.spec.ts` -- calls `get_source_document` with the right
  `p_source_doc_id`; returns the typed payload; rejects/handles RPC error.
- `source-provenance-line.component.spec.ts` -- renders nothing when `source_doc_id` is
  null; renders the line and resolves the title when present; click opens the drawer;
  RPC error is swallowed quietly (no throw).
- `source-document-drawer.component.spec.ts` -- renders title/kind/importer/raw text
  read-only from a payload; copy affordance present.

### Verification gate
`cd src/client && ng lint && ng build`, plus `supabase db advisors --local --type all`
after the migration. Regenerate docs (`npm run docs:arch`) since a new RPC is added, and
add the RPC to the appropriate feature `.md` manifest so `features:check` maps it to a
capability (per the features-drift convention).

## Files

New:
- `supabase/migrations/<ts>_get_source_document_rpc.sql`
- `src/client/src/app/shared/components/source-provenance/source-provenance-line.component.ts`
- `src/client/src/app/shared/components/source-provenance/source-document-drawer.component.ts`
- `src/client/src/app/shared/components/source-provenance/source-provenance.service.ts` (+ model/types)
- `src/client/integration/tests/source-provenance-rpc.spec.ts`
- co-located `*.spec.ts` for the components and service

Modified:
- `trial.service`, `asset.service`, `company.service`, `marker.service`, `event.service`
  (add `source_doc_id` to selects)
- the five entity models (add `source_doc_id: string | null`)
- the detail surfaces listed in the wiring table (drop in `<app-source-provenance-line>`)
- relevant feature `.md` manifest + regenerated runbook auto-gen blocks
