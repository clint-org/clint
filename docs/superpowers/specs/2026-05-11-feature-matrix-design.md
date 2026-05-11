# Feature Matrix and Empty-State Audit

Date: 2026-05-11
Status: Draft, pending user review

## Motivation

Two related pains converging on the same root cause:

1. **Developer-side overlap.** Clint has grown to roughly 30 user-facing surfaces and ~60-100 distinct capabilities (timeline zoom, palette pinned items, intelligence draft autosave, materials registry filtering, and so on). The hand-curated prose in `docs/runbook/03-features.md` describes what each surface does but cannot answer structural questions before a new feature is designed: which capabilities already touch the `markers` table, which RPCs the engagement landing depends on, what existing surface a proposed capability might integrate with. The result is duplicate or near-duplicate features and missed integration opportunities.
2. **User-facing discoverability.** Pharma CI analysts (the target users) do not read manuals. They sit alongside Bloomberg Terminal and Citeline in the workflow and expect a self-explanatory data instrument. Three help pages exist today (`help/markers`, `help/phases`, `help/roles`) and they exist precisely because the UI alone cannot carry their content (editorial color rules, role-permission model). Most other surfaces should not need a help page; if they do, the surface is failing its job.

The two pains call for two different artifacts, kept separate. A structured developer-facing matrix solves pain 1. A written policy that keeps user-facing surfaces self-explanatory solves pain 2.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Audience split | Two artifacts, not one rendered source | Different grain, different reader, different update cadence |
| Matrix grain | Capability rows (~60-100) | Best signal for overlap detection without per-RPC noise |
| Storage shape | One markdown file per surface with structured YAML block | Single source of truth per surface; preserves markdown ergonomics; structured data still queryable |
| User-facing policy | Empty-state-first, no new help pages | Matches the data-instrument brand; keeps the three existing help pages as the only explainers |
| Enforcement | Drift CLI, stop hook, CI gate, auto-stub | Matrix cannot rot silently; addition cost stays low |

## Architecture

### File layout

```
docs/runbook/
  03-features.md              # thin auto-generated index; intro + AUTO-GEN:SURFACES block
  features/                   # new directory
    timeline-dashboard.md     # ~30 surface files
    materials-registry.md
    command-palette.md
    engagement-landing.md
    intelligence.md
    catalysts.md
    events.md
    agency-portal.md
    super-admin-portal.md
    ...

src/client/scripts/
  features-drift.mjs          # new CLI; drift + stub + near subcommands
  gen-architecture.mjs        # unchanged

.claude/hooks/
  runbook-review-guard.sh     # extended to flag features/*.md on relevant path changes

.github/workflows/
  ci.yml                      # gains features-drift job

src/client/CLAUDE.md          # gains empty-state audit checklist
src/client/package.json       # gains features:check, features:stub, features:near scripts
```

`gen-architecture.mjs` is not touched. The matrix is YAML-in-markdown plus CLI; nothing is auto-rendered into a markdown table. The CLI prints results to the terminal and exits non-zero on error-level drift.

### Per-surface file shape

Each `docs/runbook/features/<surface-slug>.md` carries surface narrative in markdown and structured capability data in a fenced YAML block.

````markdown
---
surface: Timeline Dashboard
spec: docs/superpowers/specs/2026-04-12-unified-landscape-design.md
---

# Timeline Dashboard

The primary view of an engagement once the user clicks past the home page.
Displays a grid where rows represent clinical trials and columns represent
time. Reachable at `/t/:tenantId/s/:spaceId/timeline`.

[Existing narrative from 03-features.md for this surface lives here:
multi-paragraph prose, Mermaid diagrams, tables, code blocks. Anything
that does not fit in structured YAML.]

## Capabilities

```yaml
- id: timeline-grid
  summary: Hierarchical company to product to trial rendering with phase bars and event markers.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - trials
    - trial_phases
    - markers
  related:
    - timeline-zoom
    - timeline-filtering
  user_facing: true
  role: viewer
  status: active

- id: timeline-zoom
  summary: Four zoom levels (yearly, quarterly, monthly, daily) with pixel-per-year ratios.
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

The CLI parses each surface file with two passes: `gray-matter` for frontmatter, then a fenced-block extractor that pulls the YAML between ```` ```yaml ```` and ```` ``` ```` directly under the `## Capabilities` heading. Surfaces with no capabilities yet (during bootstrap) have an empty block.

### Capability schema

| Field | Required | Type | Description |
|---|---|---|---|
| `id` | yes | string (kebab-case) | Stable identifier; used as the cross-reference key in `related:`. Must be unique across all surfaces. |
| `summary` | yes | string (one sentence) | What this capability does. No design rationale; that belongs in the narrative prose or a spec. |
| `routes` | yes | array of route patterns | Route patterns from `app.routes.ts` where this capability is reachable. Empty array allowed. |
| `rpcs` | yes | array of RPC names | Supabase RPCs this capability invokes. Empty array allowed. |
| `tables` | yes | array of table names | Database tables this capability reads or writes. Empty array allowed. |
| `related` | yes | array of capability ids | Explicit see-also links. Empty array allowed. |
| `user_facing` | yes | bool | False for internal mechanisms (e.g., `palette_touch_recent`). Filters dev-only plumbing out of any future user-facing render. |
| `role` | yes | enum | Minimum role: `viewer`, `editor`, `owner`, `agency`, `super-admin`. |
| `status` | yes | enum | `active`, `experimental`, `deprecated`. |

Deliberately excluded: services, components, since, tests, owner. Each invites drift or duplicates information that lives better elsewhere (`git log` for history, the directory tree for components, the spec file for rationale).

### `03-features.md` after the refactor

Reduces to an intro paragraph plus an `AUTO-GEN:SURFACES` block. The block lists every surface with its summary and link to the surface file. Regenerated by `features-drift.mjs` whenever the surface files change.

```markdown
# Features

Clint's feature inventory, broken down by surface. Each surface has a
dedicated page with narrative and a structured capability list.

<!-- AUTO-GEN:SURFACES -->
| Surface | Summary | File |
|---|---|---|
| Timeline Dashboard | Primary view of an engagement, hierarchical company-product-trial grid with phase bars. | [timeline-dashboard.md](features/timeline-dashboard.md) |
| Materials Registry | Institutional memory layer; every PPTX, PDF, DOCX registered against the entities it covers. | [features/materials-registry.md](features/materials-registry.md) |
| Command Palette | Cmd+K finder/navigator/command runner. | [features/command-palette.md](features/command-palette.md) |
| ... | ... | ... |
<!-- /AUTO-GEN:SURFACES -->
```

The existing `AUTO-GEN:DRIFT` block in `03-features.md` (route-only, listing unmapped routes) is dropped. The new CLI does that job across more dimensions and across both directions of drift.

## Orchestration

Four layers, in firing order during a change.

### Layer 1: stop hook (`runbook-review-guard.sh`)

The hook already flags relevant runbook files when changes touch the matched paths. Extended with rules:

| Path changed in session | Flagged file |
|---|---|
| `supabase/migrations/*.sql` | All surface files; specifically those whose `rpcs:` or `tables:` reference the changed objects (computed by grepping the YAML blocks). |
| `src/client/src/app/app.routes.ts` | All surface files; specifically those whose `routes:` reference added or removed routes. |
| New folder under `src/client/src/app/features/**/` | The likely-matching surface file by name; or a hint to add a new surface file if no match. |

Hook output lists the matched surface files and the inferred reason. Same shape as the existing help-page rule.

### Layer 2: drift CLI (`features-drift.mjs`)

Standalone script invoked as `npm run features:check`. Compares the parsed YAML across all surface files against three live sources and one cross-file consistency check.

| Source of truth | Drift signal | Severity |
|---|---|---|
| `app.routes.ts` route paths | Route in code but not mapped to any capability | warn |
| `pg_proc` (local Supabase) RPC names | RPC in code but not mapped | error |
| `pg_class` table names (public schema) | Table in schema but not mapped | warn |
| Capability `rpcs:` entries | RPC name in YAML does not exist in `pg_proc` | error |
| Capability `routes:` entries | Route does not resolve in `app.routes.ts` | error |
| Capability `tables:` entries | Table does not exist in `pg_class` | error |
| Capability `related:` entries | Referenced capability id does not exist | error |
| Surface frontmatter `surface:` | No matching `# <surface>` heading in the file | error |
| Capability `id:` values | Duplicate id across all surface files | error |
| Surface files vs `03-features.md` AUTO-GEN:SURFACES | Surface file exists with no row in index, or row in index with no file | warn (handled by regen) |

Exit non-zero on any error-level drift. Output formatted similarly to `supabase db advisors --local`: grouped by source, each issue carries a one-line remediation hint.

Escape hatch: a `# matrix-skip: <reason>` comment on a YAML row, or `// @matrix-skip <reason>` in routes file, exempts that entry from drift. The reason is required and listed in the CLI output for audit.

### Layer 3: auto-stub (`npm run features:stub`)

Runs the drift checks, then for each unmapped route or RPC it appends a stub capability block to the most likely surface file (matched by route prefix or RPC name prefix). If no surface matches, the stub is appended to a top-level `features/_unsorted.md` for triage.

Stub shape:

```yaml
- id: TODO-rename
  summary: TODO
  routes:
    - /new/route/from/drift
  rpcs:
    - new_rpc_from_drift
  tables: []
  related: []
  user_facing: true
  role: viewer
  status: experimental
```

`id: TODO-*` is itself an error-level drift, so stubs cannot ship without being filled in.

### Layer 4: CI gate (`.github/workflows/ci.yml`)

New job:

```yaml
features-drift:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: supabase/setup-cli@v1
      with: { version: latest }
    - run: supabase start
    - working-directory: src/client
      run: npm ci
    - working-directory: src/client
      run: npm run features:check
```

Fails the PR on any error-level drift. Warn-level drift annotated on the PR via GitHub Actions output. Runs in parallel with the existing CI lint/build jobs.

### Pre-design query (`npm run features:near`)

CLI for active overlap detection during feature design. Example:

```
$ npm run features:near -- --tables markers --rpcs get_dashboard_data
intelligence-feed-marker-tooltip    surface: Intelligence            (overlap: tables=markers)
marker-history-panel                surface: Intelligence            (overlap: tables=markers)
timeline-grid                       surface: Timeline Dashboard      (overlap: rpcs=get_dashboard_data, tables=markers)
catalysts-grouping                  surface: Future Catalysts        (overlap: rpcs=get_dashboard_data)
```

Sorted by overlap count. Backs a CLAUDE.md instruction:

> Before designing a new feature, run `npm run features:near -- --tables <touched-tables> --rpcs <touched-rpcs>` to surface adjacent capabilities. Reference any hits in the spec under a "Related capabilities" header.

This converts the matrix from a passive document into an active design-time tool. The instruction is soft; the only enforcement is reviewer discipline and the spec-template header.

## User-facing surface policy (empty-state audit)

Added as a new section in `src/client/CLAUDE.md` after the existing section 12 (Verification), keeping the numbered sequence intact. Reviewed as part of every feature implementation, alongside the existing Angular guardrails.

> ## 13. Empty-state audit
>
> Every user-facing surface must answer these questions in the UI itself, not in a help page:
>
> 1. **First-row state.** When data exists, the row labels and primary value column communicate what each row is without external context. Column headers use domain vocabulary (Marker, Trial, Catalyst), never generic ones (Item, Record).
> 2. **Empty state.** When there is no data, the empty state names what goes here and how to add one. For viewer-role surfaces (read-only), the empty state explains why it is empty without offering an action the role cannot take.
> 3. **Action labels.** Every button and link uses domain vocabulary in imperative form (Register material, Open command palette, Publish intelligence). No generic CTAs (Submit, Click here, Add).
> 4. **Tooltips on icon-only buttons.** Every button without text uses `pTooltip` from `primeng/tooltip`. Position right for nav rails, top for inline badges, bottom for editor toolbars.
> 5. **Role-appropriate affordances.** Surfaces shown to multiple roles hide actions the current role cannot take. No greyed-out buttons; no permission-denied toasts after click.
> 6. **Loading and error states.** Skeleton placeholder during fetch. Errors name what failed and what to do (retry, contact owner). Never silent empty.
>
> **Exception.** Three editorial conventions cannot be carried by the UI alone and have dedicated help pages: marker color rules (`help/markers`), phase color rules (`help/phases`), role and permission model (`help/roles`). Adding a fourth requires a deliberate decision. By default, work harder on the surface first.

## Bootstrap

One-time migration of existing content. Runs as a focused sub-agent task with human review of the result.

1. Create `docs/runbook/features/` directory.
2. Read current `docs/runbook/03-features.md`. For each H2 section:
   - Create `features/<slug>.md`.
   - Frontmatter: `surface:` matching the H2 heading; `spec:` linking to the matching file in `docs/superpowers/specs/` where one exists.
   - Body: the prose from that H2 section, preserved verbatim including Mermaid diagrams and tables.
   - Append a `## Capabilities` heading with an initial YAML block. Capabilities derived from the prose: each enumerated feature or RPC mentioned becomes a row. First pass aims for completeness, not polish.
3. Replace `03-features.md` with the new index template (intro paragraph + `AUTO-GEN:SURFACES` block).
4. Run `npm run features:check`. Iterate on the YAML blocks until drift is clean: every RPC and route must either be mapped to a capability or carry an explicit `matrix-skip` reason.
5. Run `npm run docs:arch` (no changes expected; verify the regen still works).
6. Commit as one PR.

Expected time: one sub-agent run plus 1-2 hours of human review and drift iteration. The bulk of the work is in step 4.

## Tradeoffs and out of scope

- **No auto-generation of prose from YAML, or vice versa.** Each file carries information the other cannot. The CLI enforces cross-consistency; neither file is the other's source.
- **No services, components, since-date, or test-coverage fields on capabilities.** Each would either duplicate information available elsewhere (`git log`, the directory tree) or invite drift without enough analytical payoff.
- **No user-facing render of the matrix.** Pharma analysts do not read feature inventories. The CLI is the matrix view.
- **No automated enforcement that the design step consulted `features:near`.** Only convention and reviewer discipline.
- **Empty-state audit is policy, not tooling.** No script enforces it. Reviewed in code review and during the `ng build` / browser-exercise step of the existing implementation flow.

## Verification

After implementation:

- `cd src/client && npm run features:check` exits zero.
- `cd src/client && npm run features:stub` produces no new stubs (everything mapped).
- `cd src/client && npm run features:near -- --tables markers` returns at least three capabilities.
- `docs/runbook/03-features.md` `AUTO-GEN:SURFACES` block lists all surface files.
- The CI `features-drift` job passes on a no-op PR.
- The CI `features-drift` job fails on a PR that adds an RPC without a capability mapping.
- Stop hook surfaces the right surface file when a migration is staged in a working session.
- `src/client/CLAUDE.md` carries the empty-state audit section.

## Open questions

None.
