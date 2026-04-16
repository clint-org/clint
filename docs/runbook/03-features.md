# Features

[Back to index](README.md)

---

## Timeline Dashboard

The primary view of the application. Displays a grid where rows represent clinical trials and columns represent time. The grid is organized hierarchically:

```
Company
  +-- Product
        +-- Trial (with phase bars and event markers)
```

**Phase Bars** -- horizontal bands that span the timeline for each trial phase. Color-coded by phase type:
- **Phase 1** -- Muted slate (`#94a3b8`, early/exploratory)
- **Phase 2** -- Cyan (`#67e8f9`, building evidence)
- **Phase 3** -- Teal (`#2dd4bf`, pivotal trials)
- **Phase 4** -- Violet (`#a78bfa`, post-approval)
- **Observational** -- Amber (`#fbbf24`, caution-adjacent)

**Event Markers** -- icons placed at specific dates on the timeline. 10 system-provided marker types plus custom user-defined types. Shapes include circles, diamonds, flags, arrows, bars, and X marks -- each with color coding by category:
- Green circles -- Data events
- Red diamonds -- Regulatory events
- Blue flags/bars -- Approval/Launch events
- Orange/red arrows/X -- Change/status events

**Notes** -- free-text annotations attached to trials, displayed inline.

## Timeline Zoom

Four zoom levels let users control the time granularity. The `TimelineService` defines pixel-per-year ratios for each:

| Zoom | Pixels/Year | Column Unit | Use Case |
|---|---|---|---|
| Yearly | 200 px | 1 year | 5-10 year pipelines |
| Quarterly | 600 px (150/quarter) | 1 quarter | 2-3 year views |
| Monthly | 1200 px (100/month) | 1 month | Near-term tracking |
| Daily | 1460 px (4/day) | 1 day | Precise event placement |

The `TimelineService` provides `dateToX()` and `xToDate()` methods for converting between pixel positions and ISO dates, plus `getColumns()` for generating hierarchical column headers with sub-columns.

## Filtering

The `FilterPanelComponent` lets users narrow the dashboard to:

- **Companies** -- show only selected companies
- **Products** -- show only selected products
- **Therapeutic Areas** -- filter by medical indication (Oncology, Cardiology, etc.)
- **Date Range** -- clamp the visible timeline window (start year / end year)
- **Recruitment Status** -- Active, Completed, Suspended, etc.
- **Study Type** -- Interventional, Observational, Expanded Access
- **Phase** -- P1, P2, P3, P4, Observational

All filter values are passed as arrays to the `get_dashboard_data()` RPC function.

## Legend

A grouped reference panel (`LegendComponent`) showing all marker types with their SVG icons and labels. Organized by category. Collapsible for more dashboard space.

## Data Management

A full CRUD interface for managing all data within a space:

| Section | What You Manage |
|---|---|
| Companies | Pharma/biotech company records (name, logo_url, display_order, color) |
| Products | Drug/therapy products linked to a company (name, generic_name, logo_url) |
| Trials | Clinical studies with all metadata + CT.gov dimensions |
| Trial Phases | Phase records with phase_type, start_date, end_date, color, label |
| Trial Markers | Event markers with event_date, end_date, tooltip_text, is_projected |
| Trial Notes | Free-text annotations on trials |
| Marker Types | Custom marker types beyond the 10 system defaults (each assigned to a category) |
| Therapeutic Areas | Medical indication categories (name, abbreviation) |

## Events (Intelligence Feed)

A unified chronological feed showing analyst-created events and timeline markers together. Events capture competitive intelligence at four entity levels: space (industry-wide), company, product, and trial.

**Layout:** Data table (p-table) with sortable/filterable columns + a right-side overlay detail panel (340px, absolute-positioned, `@slidePanel` animation) that slides in on row click and hides when nothing is selected.

| Column | Content |
|---|---|
| Date | Event date, sorted descending by default |
| Source | Badge: "EVENT" (green) or "MARKER" (slate) |
| Title | Event title with thread indicator if applicable |
| Category | 6 system categories: Leadership, Regulatory, Financial, Strategic, Clinical, Commercial |
| Entity | Company / Product / Trial name, or "Industry" for space-level |
| Priority | Red dot for high, empty for low |

**Detail panel (340px overlay):** Description, source URLs, tags, thread context (ordered list of events in the narrative), related events (ad-hoc links), and created timestamp.

**Event features:** Free-form tags, multiple source URLs with labels, threads (sequential narrative chains), ad-hoc links between related events, high/low priority.

## Key Catalysts

A standalone forward-looking page showing all upcoming markers (clinical trial milestones, data readouts, regulatory dates, approvals, LOE events) in chronological order, grouped into adaptive time buckets.

**Route:** `/t/:tenantId/s/:spaceId/catalysts`

**Layout:** Dense table (p-table with `rowGroupMode="subheader"`) + a right-side 340px overlay detail panel (`@slidePanel` animation) on row click. No summary header -- straight to data.

**Grouping:** Adaptive time-bucket density based on distance from today:
- Current ISO week -> "This Week" (with date range)
- Next ISO week -> "Next Week" (with date range)
- Next 2 calendar months -> monthly ("May 2026")
- Beyond that -> quarterly ("Q3 2026")

| Column | Content |
|---|---|
| Date | Monospace, formatted as "Apr 15" |
| Category | Marker shape/color dot + category name (Data, Regulatory, Approval, Clinical Trial, LOE) |
| Catalyst | Title, bold |
| Company / Product | "COMPANY (uppercase) -- Product" |
| Status | "CONFIRMED" (green badge) or "PROJECTED" (amber badge), derived from `is_projected` |

**Filter bar:** Category (p-multiselect), Company (p-select with search), Product (p-select, cascading from company), and text search (client-side, debounced).

**Detail panel (340px overlay):** Three tiers:
1. Catalyst data -- category/type label, title, date, status, description, source link
2. Trial context -- trial name, phase, recruitment status, company/product
3. Related timeline -- upcoming markers for same trial (clickable, switches panel), related events for same trial/product/company (read-only)

**Data source:** Reads from the existing `markers` table via two RPC functions (`get_key_catalysts`, `get_catalyst_detail`). No new database tables.

## PowerPoint Export

The `PptxExportService` generates a `.pptx` file replicating the dashboard view using `pptxgenjs`. Users can configure:

- Title slide content
- Which trials to include
- Date range for the export (start/end year)
- Zoom level

Export details:
- Fixed slide dimensions: 13.33" x 7.5" (widescreen)
- Label column width: 2.8" (Company / Product / Trial names)
- Phase bars rendered with exact colors matching the dashboard
- Markers rendered with shape/fill/color matching their type definitions
- Date labels on markers with overlap detection
- Alternating row backgrounds for readability
- Legend showing all marker types
- Runs entirely client-side -- no file is sent to a server

## CT.gov Integration

The `CtgovSyncService` can fetch trial data from the ClinicalTrials.gov API v2 by NCT ID and map it to internal fields. Trials can store 35+ fields from the ClinicalTrials.gov data model, including:

- **Logistics**: recruitment_status, sponsor_type, lead_sponsor, collaborators[], study_countries[], study_regions[]
- **Scientific Design**: study_type, phase, design_allocation, design_intervention_model, design_masking, design_primary_purpose, enrollment_type
- **Clinical Context**: conditions[], intervention_type, intervention_name, primary/secondary_outcome_measures (jsonb), is_rare_disease
- **Eligibility**: eligibility_sex, eligibility_min_age, eligibility_max_age, accepts_healthy_volunteers, eligibility_criteria, sampling_method
- **Timeline**: start_date, primary_completion_date, study_completion_date (each with _type: Actual|Estimated), plus posting dates
- **Regulatory**: has_dmc, is_fda_regulated_drug, is_fda_regulated_device, fda_designations[], submission_type
- **Sync Tracking**: ctgov_last_synced_at, ctgov_raw_json

Helper methods in the sync service handle phase mapping, masking conversion, sponsor class normalization, country extraction, and region inference.

## Multi-Tenant Workspaces

See [Multi-Tenant Model](09-multi-tenant-model.md) for full details.

- Each **tenant** represents an organization (e.g., a pharma company or consulting firm)
- Each **space** within a tenant is a separate project/pipeline workspace
- Members can be invited to tenants via invite codes (7-day expiry)
- Spaces have role-based access: owner, editor, viewer
- Data is fully isolated between spaces

## Authentication

See [Authentication & Security](08-authentication-security.md) for full details.

Google OAuth via Supabase Auth. Users sign in with their Google account; no password management required.
