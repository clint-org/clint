# Marker System Redesign

## Overview

Redesign the marker system from a flat, single-trial annotation model into a structured, category-based intelligence layer. Analysts create markers with rich metadata (projection source, source links, descriptions) tied to domain-specific categories. Markers support many-to-many trial assignment. An optional notification system lets analysts flag important markers for stakeholder attention.

Simultaneously, collapse the `trial_phases` one-to-many relationship into phase fields directly on the `trials` table, reflecting the domain reality that a trial is one phase (or one combined phase).

## Goals

- Replace the flat marker type system with a category hierarchy that matches clinical development workflows
- Support rich metadata per marker: title, projection type, date/range, description, source URL
- Enable many-to-many marker-to-trial assignment (e.g., a regulatory submission spanning multiple trials)
- Provide an analyst-triggered notification system with priority and summary
- Simplify the trial-phase relationship to match domain reality
- Surface NCT IDs on the timeline grid and marker tooltips

## Non-Goals

- Chronological signal feed / dedicated signals page
- Email notifications (designed for, not built)
- File/document uploads
- Automated ingestion (RSS, ClinicalTrials.gov alerts)
- Changes to the landscape/bullseye view beyond what follows from the marker restructure
- Changes to company, product, or therapeutic area models
- Dark mode

## Users

- **Analysts (producers):** Create and manage markers with source links and metadata. Decide which markers warrant team notification. Editor/owner role in a space.
- **Executives / BD team (consumers):** View markers on the timeline, receive in-app notifications for analyst-flagged events. Viewer/editor/owner role in a space.

---

## Data Model

### marker_categories

System-default and space-custom categories for organizing marker types.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| space_id | uuid FK -> spaces | null for system defaults |
| name | text | e.g., "Clinical Trial", "Data", "Regulatory" |
| display_order | int | |
| is_system | bool | system defaults cannot be deleted |
| created_by | uuid FK -> auth.users | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**System categories (seeded):**
1. Clinical Trial
2. Data
3. Regulatory
4. Approval
5. Loss of Exclusivity

### marker_types (restructured)

Existing table, restructured with `category_id` FK.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| space_id | uuid FK -> spaces | null for system types |
| category_id | uuid FK -> marker_categories | required |
| name | text | e.g., "Topline Data", "FDA Submission" |
| icon | text | FontAwesome class |
| shape | text | circle / diamond / flag / arrow / x / bar |
| fill_style | text | outline / filled / striped / gradient |
| color | text | hex color |
| is_system | bool | |
| display_order | int | |
| created_by | uuid FK -> auth.users | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**System marker types per category:**

- **Clinical Trial:** Trial Start, Trial End, Primary Completion Date
- **Data:** Topline Data, Interim Data, Full Data
- **Regulatory:** FDA Submission, FDA Acceptance
- **Approval:** PDUFA Date, Launch Date
- **Loss of Exclusivity:** LOE Date, Generic Entry Date

Marker types within a category share similar iconography (same shape family) with variation in fill_style and color.

### markers (replaces trial_markers)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| space_id | uuid FK -> spaces | |
| marker_type_id | uuid FK -> marker_types | |
| title | text | brief title for the event |
| projection | text | stout / company / primary / actual |
| event_date | date | required |
| end_date | date | nullable, for date ranges |
| description | text | nullable |
| source_url | text | nullable, link to article/press release/registry |
| metadata | jsonb | nullable, type-specific fields (e.g., {"pathway": "priority"} for regulatory submissions) |
| is_projected | bool | generated column: `projection != 'actual'`. Kept for rendering convenience; always consistent with projection. |
| created_by | uuid FK -> auth.users | |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Projection types and their visual rendering:**
- **Actual** -- filled symbol. The event has occurred, confirmed.
- **Company** -- outline symbol. The pharma client's stated projection.
- **Primary** -- outline symbol. From the primary source (ClinicalTrials.gov, FDA calendar).
- **Stout** -- distinct pattern or color variant. Internal analyst projection.

### marker_assignments (many-to-many)

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| marker_id | uuid FK -> markers ON DELETE CASCADE | |
| trial_id | uuid FK -> trials | |
| created_at | timestamptz | |

Unique constraint on `(marker_id, trial_id)`.

### marker_notifications

Created when an analyst explicitly flags a marker for team notification.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| space_id | uuid FK -> spaces | |
| marker_id | uuid FK -> markers | |
| priority | text | low / high |
| summary | text | analyst's note on why this matters |
| created_by | uuid FK -> auth.users | |
| created_at | timestamptz | |

### notification_reads

Per-user read tracking.

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | PK |
| notification_id | uuid FK -> marker_notifications ON DELETE CASCADE | |
| user_id | uuid FK -> auth.users | |
| read_at | timestamptz | |

Unique constraint on `(notification_id, user_id)`.

---

## Trial Phase Collapse

### Current State

`trial_phases` is a separate table with one-to-many relationship to trials. Each trial can have multiple phase rows, each rendering as a separate bar on the timeline.

### New State

Phase fields move directly onto the `trials` table:

| Column | Type | Notes |
|--------|------|-------|
| phase_type | text | P1 / P2 / P3 / P4 / P1_2 / P2_3 / OBS |
| phase_start_date | date | |
| phase_end_date | date | nullable, for ongoing trials |

The `trial_phases` table is dropped. One bar per trial on the timeline.

### Migration

- For each trial, take the existing `trial_phases` row(s) and collapse:
  - Single phase row: copy phase_type, start_date, end_date directly
  - Multiple phase rows: take the widest date range; if phase types differ, flag for manual review
- Remove `trial_phase_id` references from `marker_assignments` (markers link to trials only)
- Drop `trial_phases` table
- Remove `PhaseFormComponent`, `TrialPhaseService`, and related CRUD screens

---

## NCT ID Display

The `trials.identifier` field already stores NCT IDs. Changes are frontend-only:

- **Timeline grid left rail:** Show NCT ID next to trial name in smaller, muted monospace text
- **Marker tooltips:** Include NCT ID(s) of assigned trial(s) in the tooltip metadata
- **Multi-trial markers:** Tooltip lists all assigned trials with their NCT IDs

---

## Notification System

### Creation Flow

1. Analyst creates or edits a marker through the marker form
2. An optional "Notify team" toggle is available on the form
3. When toggled on, two fields appear:
   - Priority: low / high (dropdown)
   - Summary: text area for the analyst's explanation of why this matters
4. On save, a `marker_notifications` row is created alongside the marker

### Consumption

- Notification bell icon in the app header with unread count badge
- Clicking opens a dropdown panel showing notifications in reverse-chronological order
- Each notification displays: category tag, marker title, priority indicator (high gets visual emphasis), analyst summary, timestamp, link to the marker on the timeline
- Clicking through or "mark as read" creates a `notification_reads` row
- Filter by category, priority, or unread-only within the dropdown

### Notification Rules

- Notifications are entirely analyst-controlled -- no automatic triggers
- Only space members with editor or owner role can create notifications
- All space members receive all notifications (no subscriptions, no per-user targeting)
- In-app only; no email delivery in this iteration

### RLS

- `marker_notifications`: readable by all space members via `has_space_access(space_id)`
- `notification_reads`: users can only read/write their own rows (`user_id = auth.uid()`)
- Only editor/owner can INSERT on `marker_notifications`

---

## Marker Form Redesign

The existing `MarkerFormComponent` in manage/trials is redesigned:

### Fields

1. **Category** -- dropdown, selects from `marker_categories`. Filters available marker types.
2. **Marker Type** -- dropdown, filtered by selected category.
3. **Title** -- text input.
4. **Projection** -- dropdown: Stout / Company / Primary / Actual.
5. **Event Date** -- date picker, required.
6. **End Date** -- date picker, optional (for ranges or future ranges).
7. **Description** -- textarea, optional.
8. **Source URL** -- text input, optional. Link to news article, press release, registry entry.
9. **Metadata** -- conditional fields based on category/type:
   - Regulatory > FDA Submission: pathway dropdown (standard / priority / cnpv)
10. **Trial Assignment** -- multi-select of trials in the space. At least one required.
11. **Notify Team** -- toggle. When on, reveals:
    - Priority: low / high
    - Summary: textarea

### Behavior

- Category selection filters the marker type dropdown
- Marker type selection may reveal type-specific metadata fields
- Trial assignment supports multi-select for many-to-many
- Form accessible from the trial detail page (pre-selects that trial) and from a standalone markers management page

---

## RPC Function Changes

### get_dashboard_data

Rewritten to:
- Read phase data from `trials` directly (not `trial_phases`)
- Join `markers` through `marker_assignments` to get markers per trial
- Include `marker_types` with `marker_categories` for category/type info
- Return marker metadata (title, projection, description, source_url, metadata jsonb)
- Include `trials.identifier` (NCT ID) in the response

### get_bullseye_data (and variants)

Updated to:
- Join through `marker_assignments` for `recent_markers`
- Include category and projection data in the marker response

### New RPCs

- `get_notifications(p_space_id)` -- returns notifications with read state for the current user, ordered reverse-chronologically
- `get_unread_notification_count(p_space_id)` -- returns count for the bell badge

---

## Frontend Changes

### Services

| Current | New |
|---------|-----|
| `TrialMarkerService` | `MarkerService` -- CRUD against `markers` + `marker_assignments` |
| `TrialPhaseService` | Removed |
| `MarkerTypeService` | Updated -- includes category relationship |
| -- | `MarkerCategoryService` -- CRUD for categories |
| -- | `NotificationService` -- fetch notifications, mark as read, get unread count |

### Components

| Component | Change |
|-----------|--------|
| `MarkerFormComponent` | Redesigned per the form spec above |
| `PhaseFormComponent` | Removed |
| `TrialFormComponent` | Updated -- phase fields inline (type, start date, end date) |
| `TrialDetailComponent` | Updated -- no phase sub-list, markers show category/projection |
| `marker.component.ts` | Updated -- reads projection for fill rendering |
| `marker-tooltip.component.ts` | Updated -- shows title, projection, description, source link, NCT IDs |
| `dashboard.component.ts` | Updated -- consumes restructured `get_dashboard_data` response |
| `dashboard-grid.component.ts` | Updated -- phase bar reads from trial directly |
| -- | New: `NotificationBellComponent` -- header icon + dropdown |
| -- | New: `NotificationPanelComponent` -- dropdown content |

### Models

| Current | New |
|---------|-----|
| `TrialMarker` | `Marker` (with category, projection, metadata) |
| `TrialPhase` | Removed (phase fields on `Trial`) |
| `MarkerType` | Updated (with `category_id`) |
| -- | `MarkerCategory` |
| -- | `MarkerAssignment` |
| -- | `MarkerNotification` |
| -- | `NotificationRead` |
| `Trial` | Updated -- adds `phase_type`, `phase_start_date`, `phase_end_date` |

---

## Migration Plan

### Database Migration (single migration file)

1. Create `marker_categories` table with RLS
2. Seed five system categories
3. Add `category_id` FK to `marker_types`, populate based on existing type names
4. Create `markers` table with RLS
5. Create `marker_assignments` table with RLS
6. Create `marker_notifications` table with RLS
7. Create `notification_reads` table with RLS
8. Migrate `trial_markers` data into `markers` + `marker_assignments`:
   - Map `tooltip_text` -> `description`, `tooltip_image_url` -> retained in metadata jsonb
   - Set `projection = 'actual'` where `is_projected = false`, `projection = 'company'` where `is_projected = true`
   - Set `title` to marker type name where no tooltip_text exists
   - Create one `marker_assignments` row per old `trial_id`
9. Add `phase_type`, `phase_start_date`, `phase_end_date` columns to `trials`
10. Migrate `trial_phases` data onto parent trials
11. Drop `trial_phases` table
12. Drop `trial_markers` table
13. Update `seed.sql` to use new schema

### Frontend Migration

1. Update models and services
2. Update marker form with new fields
3. Update trial form (inline phase fields, remove phase sub-management)
4. Update dashboard RPC consumption and grid rendering
5. Update marker and tooltip components
6. Build notification bell and panel components
7. Update bullseye RPCs and landscape components
8. Remove dead code (PhaseFormComponent, TrialPhaseService, old models)

---

## Future Considerations (not in scope)

- **Email notifications:** Add `delivery_channel` to `marker_notifications`, Supabase Edge Function for email delivery
- **Chronological feed page:** Dedicated route for reviewing all markers/notifications across the space
- **File uploads:** Attach PDFs/slide decks to markers (Supabase Storage)
- **Automated ingestion:** RSS feeds, ClinicalTrials.gov API polling, auto-creating markers
- **Marker change history:** Audit log of projection type changes, date shifts
