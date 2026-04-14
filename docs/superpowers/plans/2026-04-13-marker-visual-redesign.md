# Marker Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the marker icon system from 21 types to 12, with universal projected/actual/NLE states, inner marks for differentiation, and light-tint phase bars.

**Architecture:** Database migration adds `inner_mark` to marker_types and `no_longer_expected` to markers, archives old types, inserts new ones. Frontend replaces FontAwesome icon rendering with SVG components that support inner marks and the NLE overlay. Phase bars switch from 75% opacity fill to 12% tint + outline.

**Tech Stack:** Angular 19 (standalone components, signals), Supabase/PostgreSQL migrations, SVG rendering

**Spec:** `docs/superpowers/specs/2026-04-13-marker-visual-redesign-design.md`

---

## File Structure

### New Files
- `supabase/migrations/<timestamp>_marker_visual_redesign.sql` -- schema changes + seed data update
- `src/client/src/app/shared/components/svg-icons/triangle-icon.component.ts` -- right-pointing triangle for Launch
- `src/client/src/app/shared/components/svg-icons/square-icon.component.ts` -- square with optional X inner mark
- `src/client/src/app/shared/components/svg-icons/nle-overlay.component.ts` -- strikethrough overlay for any marker

### Modified Files
- `src/client/src/app/core/models/marker.model.ts` -- add inner_mark, triangle/square/dashed-line shapes, no_longer_expected
- `src/client/src/app/shared/components/svg-icons/circle-icon.component.ts` -- add innerMark input (dot, dash, none)
- `src/client/src/app/shared/components/svg-icons/diamond-icon.component.ts` -- add innerMark input (dot, check, none)
- `src/client/src/app/shared/utils/marker-icon.ts` -- remove (replaced by SVG rendering)
- `src/client/src/app/features/dashboard/grid/marker.component.ts` -- switch from FA icons to SVG components, add NLE support
- `src/client/src/app/features/dashboard/grid/marker.component.html` -- render SVG icons instead of `<i>` tags
- `src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts` -- update projection labels
- `src/client/src/app/features/dashboard/legend/legend.component.ts` -- switch to SVG icons, add state indicators
- `src/client/src/app/features/dashboard/legend/legend.component.html` -- render SVG icons with inner marks
- `src/client/src/app/features/dashboard/grid/phase-bar.component.html` -- change to tint + outline rendering
- `src/client/src/app/features/dashboard/grid/phase-bar.component.ts` -- update label color logic for tinted bars
- `supabase/seed.sql` -- update system marker type seed data

### Files to Delete (after migration)
- `src/client/src/app/shared/components/svg-icons/arrow-icon.component.ts`
- `src/client/src/app/shared/components/svg-icons/x-icon.component.ts`
- `src/client/src/app/shared/components/svg-icons/bar-icon.component.ts`

---

## Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/<timestamp>_marker_visual_redesign.sql`
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Create the migration file**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
supabase migration new marker_visual_redesign
```

- [ ] **Step 2: Write the migration SQL**

Write the following to the newly created migration file:

```sql
-- =============================================================================
-- Marker Visual Redesign Migration
-- Adds inner_mark to marker_types, no_longer_expected to markers,
-- updates shape constraint, archives old types, inserts new types.
-- =============================================================================

-- 1. Add inner_mark column to marker_types
alter table public.marker_types
  add column inner_mark text not null default 'none'
  check (inner_mark in ('dot', 'dash', 'check', 'x', 'none'));

-- 2. Update shape constraint to include new shapes
-- First drop the existing check constraint on shape
alter table public.marker_types drop constraint if exists marker_types_shape_check;
alter table public.marker_types
  add constraint marker_types_shape_check
  check (shape in ('circle', 'diamond', 'flag', 'triangle', 'square', 'dashed-line'));

-- 3. Add no_longer_expected to markers
alter table public.markers
  add column no_longer_expected boolean not null default false;

-- 4. Archive old system marker types (soft-delete by setting display_order to -1)
-- These are the types being replaced or removed
update public.marker_types set display_order = -1 where id in (
  'a0000000-0000-0000-0000-000000000001', -- Projected Data Reported
  'a0000000-0000-0000-0000-000000000002', -- Data Reported
  'a0000000-0000-0000-0000-000000000003', -- Projected Regulatory Filing
  'a0000000-0000-0000-0000-000000000004', -- Submitted Regulatory Filing
  'a0000000-0000-0000-0000-000000000005', -- Label Projected Approval/Launch
  'a0000000-0000-0000-0000-000000000006', -- Label Update
  'a0000000-0000-0000-0000-000000000007', -- Est. Range of Potential Launch
  'a0000000-0000-0000-0000-000000000009', -- Change from Prior Update
  'a0000000-0000-0000-0000-000000000010', -- Event No Longer Expected
  'a0000000-0000-0000-0000-000000000014', -- Interim Data (old, wrong color)
  'a0000000-0000-0000-0000-000000000015', -- Full Data (old, wrong color)
  'a0000000-0000-0000-0000-000000000016', -- FDA Submission (merged)
  'a0000000-0000-0000-0000-000000000017', -- FDA Acceptance (merged)
  'a0000000-0000-0000-0000-000000000018', -- PDUFA Date (removed)
  'a0000000-0000-0000-0000-000000000019'  -- Launch Date (merged)
);

-- 5. Update existing types that stay but need new values

-- Topline Data: was a0...0013, update color + add inner_mark
update public.marker_types set
  color = '#4ade80',
  inner_mark = 'dot',
  display_order = 1
where id = 'a0000000-0000-0000-0000-000000000013';

-- PCD: update color to slate
update public.marker_types set
  color = '#475569',
  display_order = 7
where id = 'a0000000-0000-0000-0000-000000000008';

-- Trial Start: update shape to dashed-line, color to slate
update public.marker_types set
  shape = 'dashed-line',
  color = '#94a3b8',
  fill_style = 'filled',
  display_order = 8
where id = 'a0000000-0000-0000-0000-000000000011';

-- Trial End: update shape to dashed-line, color to slate
update public.marker_types set
  shape = 'dashed-line',
  color = '#94a3b8',
  fill_style = 'filled',
  display_order = 9
where id = 'a0000000-0000-0000-0000-000000000012';

-- LOE Date: update color + add inner_mark
update public.marker_types set
  color = '#78350f',
  inner_mark = 'x',
  display_order = 11
where id = 'a0000000-0000-0000-0000-000000000020';

-- Generic Entry Date: update color
update public.marker_types set
  color = '#d97706',
  display_order = 12
where id = 'a0000000-0000-0000-0000-000000000021';

-- 6. Insert new marker types for redesigned categories

insert into public.marker_types (id, space_id, name, icon, shape, fill_style, color, inner_mark, is_system, display_order, category_id)
values
  -- Data: Interim Data (new, with dash inner mark)
  ('a0000000-0000-0000-0000-000000000030', null, 'Interim Data',        'interim-data',     'circle',   'filled', '#22c55e', 'dash', true, 2, 'c0000000-0000-0000-0000-000000000002'),
  -- Data: Full Data (new, plain circle)
  ('a0000000-0000-0000-0000-000000000031', null, 'Full Data',           'full-data',        'circle',   'filled', '#16a34a', 'none', true, 3, 'c0000000-0000-0000-0000-000000000002'),
  -- Regulatory: Filing (orange, center dot)
  ('a0000000-0000-0000-0000-000000000032', null, 'Regulatory Filing',   'reg-filing',       'diamond',  'filled', '#f97316', 'dot',  true, 4, 'c0000000-0000-0000-0000-000000000003'),
  -- Regulatory: Submission (orange, plain)
  ('a0000000-0000-0000-0000-000000000033', null, 'Submission',          'submission',       'diamond',  'filled', '#f97316', 'none', true, 5, 'c0000000-0000-0000-0000-000000000003'),
  -- Regulatory: Acceptance (orange, checkmark)
  ('a0000000-0000-0000-0000-000000000034', null, 'Acceptance',          'acceptance',       'diamond',  'filled', '#f97316', 'check',true, 6, 'c0000000-0000-0000-0000-000000000003'),
  -- Approval: Approval (blue flag)
  ('a0000000-0000-0000-0000-000000000035', null, 'Approval',            'approval',         'flag',     'filled', '#3b82f6', 'none', true, 10, 'c0000000-0000-0000-0000-000000000004'),
  -- Approval: Launch (violet triangle)
  ('a0000000-0000-0000-0000-000000000036', null, 'Launch',              'launch',           'triangle', 'filled', '#7c3aed', 'none', true, 11, 'c0000000-0000-0000-0000-000000000004')
on conflict (id) do nothing;

-- 7. Update get_dashboard_data RPC to include new fields
-- The RPC needs to return inner_mark and no_longer_expected
create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null,
  p_phase_types text[] default null,
  p_statuses text[] default null,
  p_moas text[] default null,
  p_roas text[] default null,
  p_study_types text[] default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_start_date date;
  v_end_date date;
begin
  -- compute optional date-range boundaries
  if p_start_year is not null then
    v_start_date := make_date(p_start_year, 1, 1);
  end if;
  if p_end_year is not null then
    v_end_date := make_date(p_end_year, 12, 31);
  end if;

  select coalesce(jsonb_agg(row_data order by company_name, product_name, trial_name), '[]'::jsonb)
  into v_result
  from (
    select
      t.id                                        as trial_id,
      t.name                                      as trial_name,
      t.identifier                                as trial_identifier,
      t.phase_type                                as phase_type,
      t.phase_start_date                          as phase_start_date,
      t.phase_end_date                            as phase_end_date,
      t.status                                    as trial_status,
      t.study_type                                as study_type,
      p.id                                        as product_id,
      p.name                                      as product_name,
      p.moa                                       as moa,
      p.roa                                       as roa,
      c.id                                        as company_id,
      c.name                                      as company_name,
      c.logo_url                                  as company_logo_url,
      coalesce(
        (select jsonb_agg(ta.name)
         from public.trial_therapeutic_areas tta
         join public.therapeutic_areas ta on ta.id = tta.therapeutic_area_id
         where tta.trial_id = t.id),
        '[]'::jsonb
      )                                           as therapeutic_areas,
      'markers', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id',                  m.id,
            'title',               m.title,
            'projection',          m.projection,
            'event_date',          m.event_date,
            'end_date',            m.end_date,
            'description',         m.description,
            'source_url',          m.source_url,
            'metadata',            m.metadata,
            'is_projected',        m.is_projected,
            'no_longer_expected',  m.no_longer_expected,
            'marker_type', (
              select jsonb_build_object(
                'id',         mt.id,
                'name',       mt.name,
                'icon',       mt.icon,
                'shape',      mt.shape,
                'fill_style', mt.fill_style,
                'color',      mt.color,
                'inner_mark', mt.inner_mark,
                'category_name', mc.name
              )
              from public.marker_types mt
              left join public.marker_categories mc on mc.id = mt.category_id
              where mt.id = m.marker_type_id
            )
          )
          order by m.event_date
        )
        from public.marker_assignments ma
        join public.markers m on m.id = ma.marker_id
        where ma.trial_id = t.id
          and m.space_id = p_space_id
          and (v_start_date is null or m.event_date >= v_start_date)
          and (v_end_date   is null or m.event_date <= v_end_date)
      ), '[]'::jsonb)
    from public.trials t
    join public.products p on p.id = t.product_id
    join public.companies c on c.id = p.company_id
    where t.space_id = p_space_id
      and (p_company_ids is null or c.id = any(p_company_ids))
      and (p_product_ids is null or p.id = any(p_product_ids))
      and (p_therapeutic_area_ids is null or exists (
        select 1 from public.trial_therapeutic_areas tta
        where tta.trial_id = t.id and tta.therapeutic_area_id = any(p_therapeutic_area_ids)
      ))
      and (p_phase_types is null or t.phase_type = any(p_phase_types))
      and (p_statuses is null or t.status = any(p_statuses))
      and (p_moas is null or p.moa = any(p_moas))
      and (p_roas is null or p.roa = any(p_roas))
      and (p_study_types is null or t.study_type = any(p_study_types))
  ) sub(trial_id, trial_name, trial_identifier, phase_type, phase_start_date, phase_end_date,
        trial_status, study_type, product_id, product_name, moa, roa, company_id, company_name,
        company_logo_url, therapeutic_areas, markers_key, markers_val)
  cross join lateral jsonb_build_object(
    'trial_id',           trial_id,
    'trial_name',         trial_name,
    'trial_identifier',   trial_identifier,
    'phase_type',         phase_type,
    'phase_start_date',   phase_start_date,
    'phase_end_date',     phase_end_date,
    'trial_status',       trial_status,
    'study_type',         study_type,
    'product_id',         product_id,
    'product_name',       product_name,
    'moa',                moa,
    'roa',                roa,
    'company_id',         company_id,
    'company_name',       company_name,
    'company_logo_url',   company_logo_url,
    'therapeutic_areas',  therapeutic_areas,
    'markers',            markers_val
  ) as row_data;

  return v_result;
end;
$$;
```

- [ ] **Step 3: Update seed.sql with new marker types**

Replace the marker_types insert in `supabase/seed.sql` (lines 11-29) with:

```sql
insert into public.marker_types (id, space_id, created_by, name, icon, shape, fill_style, color, inner_mark, is_system, display_order, category_id)
values
  -- Data category (c...0002)
  ('a0000000-0000-0000-0000-000000000013', null, null, 'Topline Data',        'topline-data',  'circle',      'filled', '#4ade80', 'dot',  true,  1, 'c0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000030', null, null, 'Interim Data',        'interim-data',  'circle',      'filled', '#22c55e', 'dash', true,  2, 'c0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000031', null, null, 'Full Data',           'full-data',     'circle',      'filled', '#16a34a', 'none', true,  3, 'c0000000-0000-0000-0000-000000000002'),
  -- Regulatory category (c...0003)
  ('a0000000-0000-0000-0000-000000000032', null, null, 'Regulatory Filing',   'reg-filing',    'diamond',     'filled', '#f97316', 'dot',  true,  4, 'c0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000033', null, null, 'Submission',          'submission',    'diamond',     'filled', '#f97316', 'none', true,  5, 'c0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000034', null, null, 'Acceptance',          'acceptance',    'diamond',     'filled', '#f97316', 'check',true,  6, 'c0000000-0000-0000-0000-000000000003'),
  -- Clinical Trial category (c...0001)
  ('a0000000-0000-0000-0000-000000000008', null, null, 'Primary Completion Date (PCD)', 'pcd', 'circle',      'filled', '#475569', 'none', true,  7, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000011', null, null, 'Trial Start',         'trial-start',   'dashed-line', 'filled', '#94a3b8', 'none', true,  8, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000012', null, null, 'Trial End',           'trial-end',     'dashed-line', 'filled', '#94a3b8', 'none', true,  9, 'c0000000-0000-0000-0000-000000000001'),
  -- Approval category (c...0004)
  ('a0000000-0000-0000-0000-000000000035', null, null, 'Approval',            'approval',      'flag',        'filled', '#3b82f6', 'none', true, 10, 'c0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000036', null, null, 'Launch',              'launch',        'triangle',    'filled', '#7c3aed', 'none', true, 11, 'c0000000-0000-0000-0000-000000000004'),
  -- Loss of Exclusivity category (c...0005)
  ('a0000000-0000-0000-0000-000000000020', null, null, 'LOE Date',            'loe-date',      'square',      'filled', '#78350f', 'x',    true, 12, 'c0000000-0000-0000-0000-000000000005'),
  ('a0000000-0000-0000-0000-000000000021', null, null, 'Generic Entry Date',  'generic-entry', 'square',      'filled', '#d97706', 'none', true, 13, 'c0000000-0000-0000-0000-000000000005')
on conflict (id) do update set
  name = excluded.name,
  icon = excluded.icon,
  shape = excluded.shape,
  fill_style = excluded.fill_style,
  color = excluded.color,
  inner_mark = excluded.inner_mark,
  display_order = excluded.display_order,
  category_id = excluded.category_id;
```

- [ ] **Step 4: Test the migration**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
supabase db reset
```

Expected: All migrations apply cleanly, seed data loads, no errors.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/*_marker_visual_redesign.sql supabase/seed.sql
git commit -m "feat(db): add marker visual redesign migration

Add inner_mark column to marker_types, no_longer_expected to markers.
Archive 15 old marker types, insert 7 new ones, update 6 existing.
Update get_dashboard_data RPC to return inner_mark and no_longer_expected."
```

---

## Task 2: Update TypeScript Models

**Files:**
- Modify: `src/client/src/app/core/models/marker.model.ts`

- [ ] **Step 1: Update MarkerType interface**

In `src/client/src/app/core/models/marker.model.ts`, replace the `MarkerType` interface (lines 12-26):

```typescript
export type MarkerShape = 'circle' | 'diamond' | 'flag' | 'triangle' | 'square' | 'dashed-line';
export type FillStyle = 'outline' | 'filled';
export type InnerMark = 'dot' | 'dash' | 'check' | 'x' | 'none';

export interface MarkerType {
  id: string;
  space_id: string | null;
  created_by: string | null;
  category_id: string;
  name: string;
  icon: string | null;
  shape: MarkerShape;
  fill_style: FillStyle;
  color: string;
  inner_mark: InnerMark;
  is_system: boolean;
  display_order: number;
  created_at: string;
  marker_categories?: MarkerCategory;
}
```

- [ ] **Step 2: Add no_longer_expected to Marker interface**

In the same file, add `no_longer_expected` to the `Marker` interface after `is_projected`:

```typescript
export interface Marker {
  id: string;
  space_id: string;
  created_by: string;
  marker_type_id: string;
  title: string;
  projection: Projection;
  event_date: string;
  end_date: string | null;
  description: string | null;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
  is_projected: boolean;
  no_longer_expected: boolean;
  created_at: string;
  updated_at: string;
  marker_types?: MarkerType;
  marker_assignments?: MarkerAssignment[];
}
```

- [ ] **Step 3: Verify build**

```bash
cd src/client && ng build 2>&1 | head -30
```

Expected: Build errors related to missing shapes/fill_styles in consuming components (expected at this stage -- the icon components haven't been updated yet).

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/marker.model.ts
git commit -m "feat(models): update marker types for visual redesign

Add MarkerShape, FillStyle, InnerMark type aliases.
Add inner_mark to MarkerType, no_longer_expected to Marker.
Remove deprecated shapes (arrow, x, bar) and fill styles (striped, gradient)."
```

---

## Task 3: New SVG Icon Components (Triangle, Square, NLE Overlay)

**Files:**
- Create: `src/client/src/app/shared/components/svg-icons/triangle-icon.component.ts`
- Create: `src/client/src/app/shared/components/svg-icons/square-icon.component.ts`
- Create: `src/client/src/app/shared/components/svg-icons/nle-overlay.component.ts`

- [ ] **Step 1: Create TriangleIconComponent**

Create `src/client/src/app/shared/components/svg-icons/triangle-icon.component.ts`:

```typescript
import { Component, computed, input } from '@angular/core';
import { FillStyle } from '../../../core/models/marker.model';

@Component({
  selector: 'g[app-triangle-icon]',
  standalone: true,
  template: `
    <svg:polygon
      [attr.points]="trianglePoints()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : 0"
      stroke-linejoin="round"
    />
  `,
})
export class TriangleIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<FillStyle>('filled');

  trianglePoints = computed(() => {
    const s = this.size();
    const x1 = s * 0.15;
    const y1 = s * 0.1;
    const x2 = s * 0.9;
    const y2 = s / 2;
    const x3 = s * 0.15;
    const y3 = s * 0.9;
    return `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
  });
}
```

- [ ] **Step 2: Create SquareIconComponent**

Create `src/client/src/app/shared/components/svg-icons/square-icon.component.ts`:

```typescript
import { Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';

@Component({
  selector: 'g[app-square-icon]',
  standalone: true,
  template: `
    <svg:rect
      [attr.x]="padding()"
      [attr.y]="padding()"
      [attr.width]="innerSize()"
      [attr.height]="innerSize()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.5 : 0"
    />
    @if (innerMark() === 'x') {
      <svg:line
        [attr.x1]="size() * 0.3"
        [attr.y1]="size() * 0.3"
        [attr.x2]="size() * 0.7"
        [attr.y2]="size() * 0.7"
        [attr.stroke]="markColor()"
        stroke-width="2.5"
        stroke-linecap="round"
      />
      <svg:line
        [attr.x1]="size() * 0.7"
        [attr.y1]="size() * 0.3"
        [attr.x2]="size() * 0.3"
        [attr.y2]="size() * 0.7"
        [attr.stroke]="markColor()"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    }
  `,
})
export class SquareIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<FillStyle>('filled');
  innerMark = input<InnerMark>('none');

  padding = computed(() => this.size() * 0.1);
  innerSize = computed(() => this.size() * 0.8);
  markColor = computed(() => this.fillStyle() === 'outline' ? this.color() : 'white');
}
```

- [ ] **Step 3: Create NleOverlayComponent**

Create `src/client/src/app/shared/components/svg-icons/nle-overlay.component.ts`:

```typescript
import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'g[app-nle-overlay]',
  standalone: true,
  template: `
    <svg:line
      [attr.x1]="0"
      [attr.y1]="size() / 2"
      [attr.x2]="size()"
      [attr.y2]="size() / 2"
      stroke="#64748b"
      stroke-width="2.5"
    />
  `,
})
export class NleOverlayComponent {
  size = input<number>(16);
}
```

- [ ] **Step 4: Verify build**

```bash
cd src/client && ng build 2>&1 | head -20
```

Expected: New components compile without errors (they aren't imported anywhere yet).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/svg-icons/triangle-icon.component.ts
git add src/client/src/app/shared/components/svg-icons/square-icon.component.ts
git add src/client/src/app/shared/components/svg-icons/nle-overlay.component.ts
git commit -m "feat(icons): add triangle, square, and NLE overlay SVG components

TriangleIconComponent: right-pointing triangle for Launch markers.
SquareIconComponent: square with optional X inner mark for LOE markers.
NleOverlayComponent: horizontal strikethrough line for no-longer-expected state."
```

---

## Task 4: Update Circle and Diamond Icon Components with Inner Marks

**Files:**
- Modify: `src/client/src/app/shared/components/svg-icons/circle-icon.component.ts`
- Modify: `src/client/src/app/shared/components/svg-icons/diamond-icon.component.ts`

- [ ] **Step 1: Rewrite CircleIconComponent**

Replace the entire contents of `src/client/src/app/shared/components/svg-icons/circle-icon.component.ts`:

```typescript
import { Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';

@Component({
  selector: 'g[app-circle-icon]',
  standalone: true,
  template: `
    <svg:circle
      [attr.cx]="size() / 2"
      [attr.cy]="size() / 2"
      [attr.r]="size() / 2 - 1"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="1.5"
    />
    @if (innerMark() === 'dot') {
      <svg:circle
        [attr.cx]="size() / 2"
        [attr.cy]="size() / 2"
        [attr.r]="size() * 0.15"
        [attr.fill]="markColor()"
      />
    }
    @if (innerMark() === 'dash') {
      <svg:line
        [attr.x1]="size() * 0.28"
        [attr.y1]="size() / 2"
        [attr.x2]="size() * 0.72"
        [attr.y2]="size() / 2"
        [attr.stroke]="markColor()"
        stroke-width="2.5"
        stroke-linecap="round"
      />
    }
  `,
})
export class CircleIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<FillStyle>('filled');
  innerMark = input<InnerMark>('none');

  markColor = computed(() => this.fillStyle() === 'outline' ? this.color() : 'white');
}
```

- [ ] **Step 2: Rewrite DiamondIconComponent**

Replace the entire contents of `src/client/src/app/shared/components/svg-icons/diamond-icon.component.ts`:

```typescript
import { Component, computed, input } from '@angular/core';
import { FillStyle, InnerMark } from '../../../core/models/marker.model';

@Component({
  selector: 'g[app-diamond-icon]',
  standalone: true,
  template: `
    <svg:polygon
      [attr.points]="diamondPoints()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="1.5"
      stroke-linejoin="round"
    />
    @if (innerMark() === 'dot') {
      <svg:circle
        [attr.cx]="size() / 2"
        [attr.cy]="size() / 2"
        [attr.r]="size() * 0.15"
        [attr.fill]="markColor()"
      />
    }
    @if (innerMark() === 'check') {
      <svg:polyline
        [attr.points]="checkPoints()"
        fill="none"
        [attr.stroke]="markColor()"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    }
  `,
})
export class DiamondIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<FillStyle>('filled');
  innerMark = input<InnerMark>('none');

  markColor = computed(() => this.fillStyle() === 'outline' ? this.color() : 'white');

  diamondPoints = computed(() => {
    const s = this.size();
    const cx = s / 2;
    const cy = s / 2;
    const hw = s * 0.42;
    const hh = s * 0.48;
    return `${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}`;
  });

  checkPoints = computed(() => {
    const s = this.size();
    const x1 = s * 0.32;
    const y1 = s * 0.5;
    const x2 = s * 0.45;
    const y2 = s * 0.65;
    const x3 = s * 0.68;
    const y3 = s * 0.38;
    return `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
  });
}
```

- [ ] **Step 3: Update FlagIconComponent to use simplified fill**

Replace the entire contents of `src/client/src/app/shared/components/svg-icons/flag-icon.component.ts`:

```typescript
import { Component, computed, input } from '@angular/core';
import { FillStyle } from '../../../core/models/marker.model';

@Component({
  selector: 'g[app-flag-icon]',
  standalone: true,
  template: `
    <svg:line
      [attr.x1]="poleX()"
      [attr.y1]="1"
      [attr.x2]="poleX()"
      [attr.y2]="size() - 1"
      [attr.stroke]="color()"
      stroke-width="1.5"
      stroke-linecap="round"
    />
    <svg:path
      [attr.d]="flagPath()"
      [attr.fill]="fillStyle() === 'outline' ? 'white' : color()"
      [attr.stroke]="color()"
      [attr.stroke-width]="fillStyle() === 'outline' ? 1.2 : 0.5"
    />
  `,
})
export class FlagIconComponent {
  size = input<number>(16);
  color = input<string>('#000000');
  fillStyle = input<FillStyle>('filled');

  poleX = computed(() => this.size() * 0.15);

  flagPath = computed(() => {
    const s = this.size();
    const px = this.poleX();
    const fw = s * 0.8;
    const fh = s * 0.6;
    const cp1y = fh * 0.3;
    const cp2y = fh * 0.7;
    return `M${px},1 Q${px + fw * 0.5},${1 + cp1y} ${px + fw},${1} L${px + fw},${1 + fh} Q${px + fw * 0.5},${1 + cp2y} ${px},${1 + fh} Z`;
  });
}
```

- [ ] **Step 4: Verify build**

```bash
cd src/client && ng build 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/svg-icons/circle-icon.component.ts
git add src/client/src/app/shared/components/svg-icons/diamond-icon.component.ts
git add src/client/src/app/shared/components/svg-icons/flag-icon.component.ts
git commit -m "feat(icons): add inner mark support to circle, diamond, flag icons

CircleIconComponent: supports dot and dash inner marks.
DiamondIconComponent: supports dot and check inner marks.
FlagIconComponent: simplified to filled/outline only."
```

---

## Task 5: Rewrite Marker Component (SVG Rendering + NLE)

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/marker.component.ts`
- Modify: `src/client/src/app/features/dashboard/grid/marker.component.html`

- [ ] **Step 1: Rewrite marker.component.ts**

Replace the entire contents of `src/client/src/app/features/dashboard/grid/marker.component.ts`:

```typescript
import { Component, computed, inject, input, output, signal } from '@angular/core';

import { FillStyle, Marker, MarkerType } from '../../../core/models/marker.model';
import { TimelineService } from '../../../core/services/timeline.service';
import { CircleIconComponent } from '../../../shared/components/svg-icons/circle-icon.component';
import { DiamondIconComponent } from '../../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../../shared/components/svg-icons/flag-icon.component';
import { TriangleIconComponent } from '../../../shared/components/svg-icons/triangle-icon.component';
import { SquareIconComponent } from '../../../shared/components/svg-icons/square-icon.component';
import { NleOverlayComponent } from '../../../shared/components/svg-icons/nle-overlay.component';
import { MARKER_ICON_SIZE, MARKER_TOP_OFFSET } from '../../../shared/utils/grid-constants';
import { MarkerTooltipComponent } from './marker-tooltip.component';

@Component({
  selector: 'app-marker',
  standalone: true,
  imports: [
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
    NleOverlayComponent,
    MarkerTooltipComponent,
  ],
  templateUrl: './marker.component.html',
})
export class MarkerComponent {
  private readonly timeline = inject(TimelineService);

  marker = input.required<Marker>();
  startYear = input.required<number>();
  endYear = input.required<number>();
  totalWidth = input.required<number>();

  markerClick = output<Marker>();

  showTooltip = signal(false);

  readonly iconSize = MARKER_ICON_SIZE;
  readonly topOffset = MARKER_TOP_OFFSET;

  markerType = computed<MarkerType | undefined>(() => this.marker().marker_types);

  markerX = computed(() =>
    Math.max(
      0,
      this.timeline.dateToX(
        this.marker().event_date,
        this.startYear(),
        this.endYear(),
        this.totalWidth()
      )
    )
  );

  effectiveFillStyle = computed<FillStyle>(() => {
    return this.marker().projection === 'actual' ? 'filled' : 'outline';
  });

  isNle = computed(() => this.marker().no_longer_expected);

  isDashedLine = computed(() => this.markerType()?.shape === 'dashed-line');

  nleOpacity = computed(() => this.isNle() ? 0.3 : 1);

  shortDate = computed(() => {
    const d = new Date(this.marker().event_date);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
  });

  ariaLabel = computed(() => {
    const m = this.marker();
    return m.title || this.markerType()?.name || '';
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
```

- [ ] **Step 2: Rewrite marker.component.html**

Replace the entire contents of `src/client/src/app/features/dashboard/grid/marker.component.html`:

```html
@if (markerType(); as mt) {
  <div
    class="absolute cursor-pointer"
    [style.z-index]="showTooltip() ? 9999 : 10"
    [style.left.px]="markerX()"
    [style.top.px]="topOffset"
    (mouseenter)="showTooltip.set(true)"
    (mouseleave)="showTooltip.set(false)"
    (focus)="showTooltip.set(true)"
    (blur)="showTooltip.set(false)"
    (click)="onMarkerClick()"
    (keydown.enter)="onMarkerClick()"
    (keydown.space)="onMarkerClick()"
    tabindex="0"
    role="button"
    [attr.aria-label]="ariaLabel()"
  >
    @if (isDashedLine()) {
      <!-- Dashed vertical line for Trial Start / Trial End -->
      <svg [attr.width]="6" [attr.height]="28" class="overflow-visible" [style.margin-left.px]="-3">
        <line
          x1="3" y1="0" x2="3" y2="28"
          [attr.stroke]="isNle() ? mt.color : (effectiveFillStyle() === 'outline' ? '#cbd5e1' : mt.color)"
          stroke-width="1.5"
          stroke-dasharray="4,3"
          stroke-linecap="round"
          [attr.opacity]="isNle() ? 0.25 : 1"
        />
      </svg>
    } @else {
      <!-- Standard marker icon -->
      <svg [attr.width]="iconSize" [attr.height]="iconSize" class="overflow-visible drop-shadow-sm"
           [style.margin-left.px]="-iconSize / 2">
        <g [attr.opacity]="nleOpacity()">
          @switch (mt.shape) {
            @case ('circle') {
              <g app-circle-icon
                [size]="iconSize"
                [color]="mt.color"
                [fillStyle]="effectiveFillStyle()"
                [innerMark]="mt.inner_mark"
              />
            }
            @case ('diamond') {
              <g app-diamond-icon
                [size]="iconSize"
                [color]="mt.color"
                [fillStyle]="effectiveFillStyle()"
                [innerMark]="mt.inner_mark"
              />
            }
            @case ('flag') {
              <g app-flag-icon
                [size]="iconSize"
                [color]="mt.color"
                [fillStyle]="effectiveFillStyle()"
              />
            }
            @case ('triangle') {
              <g app-triangle-icon
                [size]="iconSize"
                [color]="mt.color"
                [fillStyle]="effectiveFillStyle()"
              />
            }
            @case ('square') {
              <g app-square-icon
                [size]="iconSize"
                [color]="mt.color"
                [fillStyle]="effectiveFillStyle()"
                [innerMark]="mt.inner_mark"
              />
            }
          }
        </g>
        @if (isNle()) {
          <g app-nle-overlay [size]="iconSize" />
        }
      </svg>
    }

    <div
      class="text-center whitespace-nowrap font-mono leading-none text-[8px] mt-px"
      [style.color]="mt.color"
      [style.margin-left.px]="isDashedLine() ? -12 : -iconSize / 2"
      [style.width.px]="isDashedLine() ? 30 : iconSize * 2"
    >
      {{ shortDate() }}
    </div>

    @if (showTooltip()) {
      <app-marker-tooltip
        [title]="marker().title"
        [typeName]="markerType()?.name ?? ''"
        [typeColor]="markerType()?.color ?? '#64748b'"
        [date]="marker().event_date"
        [projection]="marker().projection"
        [categoryName]="markerType()?.marker_categories?.name ?? ''"
        [description]="marker().description"
        [sourceUrl]="marker().source_url"
        [noLongerExpected]="isNle()"
      />
    }
  </div>
}
```

- [ ] **Step 3: Verify build**

```bash
cd src/client && ng build 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/marker.component.ts
git add src/client/src/app/features/dashboard/grid/marker.component.html
git commit -m "feat(marker): switch to SVG icon rendering with inner marks and NLE

Replace FontAwesome icon rendering with SVG components.
Support all new shapes (circle, diamond, flag, triangle, square, dashed-line).
Add no-longer-expected state rendering (dimmed + strikethrough).
Projection determines fill style: actual=filled, all others=outline."
```

---

## Task 6: Update Tooltip Projection Labels

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts`

- [ ] **Step 1: Update projection labels and add NLE badge**

In `src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts`, update the `projectionLabel` computed (lines 110-122):

```typescript
  noLongerExpected = input<boolean>(false);

  projectionLabel = computed(() => {
    switch (this.projection()) {
      case 'stout':
        return 'Stout estimate';
      case 'company':
        return 'Company guidance';
      case 'primary':
        return 'Primary source estimate';
      case 'actual':
      default:
        return '';
    }
  });
```

Also add the `noLongerExpected` input and NLE badge to the component. Add the input after the `sourceUrl` input (line 98):

```typescript
  noLongerExpected = input<boolean>(false);
```

And add the NLE badge to the template after the projection badge `}` closing (after line 67):

```html
        @if (noLongerExpected()) {
          <div class="mb-1.5 inline-flex items-center gap-1 rounded-full bg-slate-500/20 px-2 py-0.5">
            <span class="h-1.5 w-1.5 rounded-full bg-slate-400"></span>
            <span class="text-[10px] font-medium text-slate-300">No longer expected</span>
          </div>
        }
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts
git commit -m "feat(tooltip): update projection labels and add NLE badge

Projection labels now read 'Company guidance', 'Primary source estimate',
'Stout estimate'. Add 'No longer expected' badge when marker is NLE."
```

---

## Task 7: Update Legend Component

**Files:**
- Modify: `src/client/src/app/features/dashboard/legend/legend.component.ts`
- Modify: `src/client/src/app/features/dashboard/legend/legend.component.html`

- [ ] **Step 1: Update legend.component.ts**

Replace the entire contents of `src/client/src/app/features/dashboard/legend/legend.component.ts`:

```typescript
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';

import { MarkerType } from '../../../core/models/marker.model';
import { MarkerTypeService } from '../../../core/services/marker-type.service';
import { CircleIconComponent } from '../../../shared/components/svg-icons/circle-icon.component';
import { DiamondIconComponent } from '../../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../../shared/components/svg-icons/flag-icon.component';
import { TriangleIconComponent } from '../../../shared/components/svg-icons/triangle-icon.component';
import { SquareIconComponent } from '../../../shared/components/svg-icons/square-icon.component';

@Component({
  selector: 'app-legend',
  standalone: true,
  imports: [
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
  ],
  templateUrl: './legend.component.html',
})
export class LegendComponent implements OnInit {
  private markerTypeService = inject(MarkerTypeService);

  spaceId = input<string>();
  markerTypes = signal<MarkerType[]>([]);
  loading = signal(true);

  groupedMarkerTypes = computed(() => {
    const types = this.markerTypes().filter(t => t.display_order > 0);
    const groupMap = new Map<string, { label: string; order: number; types: MarkerType[] }>();

    for (const t of types) {
      const cat = t.marker_categories;
      const label = cat?.name ?? 'Other';
      const order = cat?.display_order ?? 999;

      let group = groupMap.get(label);
      if (!group) {
        group = { label, order, types: [] };
        groupMap.set(label, group);
      }
      group.types.push(t);
    }

    return Array.from(groupMap.values()).sort((a, b) => a.order - b.order);
  });

  async ngOnInit(): Promise<void> {
    try {
      const types = await this.markerTypeService.list(this.spaceId());
      this.markerTypes.set(types);
    } catch {
      this.markerTypes.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 2: Rewrite legend.component.html**

Replace the entire contents of `src/client/src/app/features/dashboard/legend/legend.component.html`:

```html
@if (loading()) {
  <div class="border-t border-slate-200 bg-slate-800 px-4 py-2">
    <span class="text-[10px] text-slate-500">Loading legend...</span>
  </div>
} @else if (groupedMarkerTypes().length === 0) {
  <div class="border-t border-slate-200 bg-slate-800 px-4 py-2">
    <span class="text-[10px] text-slate-500">No marker types configured</span>
  </div>
} @else {
  <div
    class="border-t border-slate-700 bg-slate-800 px-4 py-2"
    role="list"
    aria-label="Marker type legend"
  >
    <div class="flex flex-wrap items-center gap-x-6 gap-y-1.5">
      <!-- State indicators -->
      <div class="flex items-center gap-x-3 mr-2">
        <div class="flex items-center gap-1 text-[9px] text-slate-500">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="#64748b"/></svg>
          <span>Actual</span>
        </div>
        <div class="flex items-center gap-1 text-[9px] text-slate-500">
          <svg width="10" height="10"><circle cx="5" cy="5" r="4" fill="none" stroke="#64748b" stroke-width="1.2"/></svg>
          <span>Projected</span>
        </div>
        <div class="flex items-center gap-1 text-[9px] text-slate-500">
          <svg width="14" height="10">
            <circle cx="5" cy="5" r="4" fill="#64748b" opacity="0.3"/>
            <line x1="0" y1="5" x2="14" y2="5" stroke="#64748b" stroke-width="1.5"/>
          </svg>
          <span>NLE</span>
        </div>
      </div>

      <div class="h-3 w-px bg-slate-700"></div>

      @for (group of groupedMarkerTypes(); track group.label) {
        <div class="flex items-center gap-x-2">
          <span class="text-[9px] font-bold uppercase tracking-widest text-slate-500 mr-1">{{
            group.label
          }}</span>
          @for (mt of group.types; track mt.id) {
            <div class="flex items-center gap-1 text-[10px] text-slate-400" role="listitem">
              @if (mt.shape === 'dashed-line') {
                <svg width="10" height="12">
                  <line x1="5" y1="1" x2="5" y2="11" [attr.stroke]="mt.color" stroke-width="1.5" stroke-dasharray="3,2" stroke-linecap="round"/>
                </svg>
              } @else {
                <svg width="12" height="12">
                  @switch (mt.shape) {
                    @case ('circle') {
                      <g app-circle-icon [size]="12" [color]="mt.color" fillStyle="filled" [innerMark]="mt.inner_mark" />
                    }
                    @case ('diamond') {
                      <g app-diamond-icon [size]="12" [color]="mt.color" fillStyle="filled" [innerMark]="mt.inner_mark" />
                    }
                    @case ('flag') {
                      <g app-flag-icon [size]="12" [color]="mt.color" fillStyle="filled" />
                    }
                    @case ('triangle') {
                      <g app-triangle-icon [size]="12" [color]="mt.color" fillStyle="filled" />
                    }
                    @case ('square') {
                      <g app-square-icon [size]="12" [color]="mt.color" fillStyle="filled" [innerMark]="mt.inner_mark" />
                    }
                  }
                </svg>
              }
              <span>{{ mt.name }}</span>
            </div>
          }
        </div>
        @if (!$last) {
          <div class="h-3 w-px bg-slate-700"></div>
        }
      }
    </div>
  </div>
}
```

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/dashboard/legend/legend.component.ts
git add src/client/src/app/features/dashboard/legend/legend.component.html
git commit -m "feat(legend): switch to SVG icons with inner marks

Replace FontAwesome icons with SVG icon components.
Add universal state indicators (filled/outline/NLE) to legend header.
Filter out archived marker types (display_order <= 0)."
```

---

## Task 8: Phase Bar Tint + Outline Rendering

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/phase-bar.component.html`
- Modify: `src/client/src/app/features/dashboard/grid/phase-bar.component.ts`

- [ ] **Step 1: Update phase-bar.component.html**

Replace the `<svg:rect>` element (lines 1-19) with:

```html
<svg:rect
  [attr.x]="barX()"
  [attr.y]="8"
  [attr.width]="barWidth()"
  [attr.height]="barHeight"
  [attr.rx]="cornerRadius"
  [attr.fill]="barColor()"
  fill-opacity="0.12"
  [attr.stroke]="barColor()"
  stroke-width="1.2"
  class="cursor-pointer transition-opacity hover:fill-opacity-[0.25]"
  role="button"
  [attr.aria-label]="labelText() + ' phase'"
  tabindex="0"
  (click)="onClick()"
  (keydown.enter)="onClick()"
  (keydown.space)="onClick()"
/>
```

Also update the text fill on line 29. Replace:
```html
    [attr.fill]="showLabelInside() ? insideLabelColor() : '#64748b'"
```
with:
```html
    [attr.fill]="labelColor()"
```

- [ ] **Step 2: Update phase-bar.component.ts label color**

In `phase-bar.component.ts`, replace the `insideLabelColor` computed (around lines 74-82) with a simpler `labelColor` that returns a darker shade of the bar color:

```typescript
  labelColor = computed(() => {
    // For tinted bars, the label uses a saturated version of the bar color
    // For bars placed outside, keep the muted slate
    if (!this.showLabelInside()) return '#64748b';

    // Use the bar color directly -- it reads well against 12% tint
    return this.barColor();
  });
```

- [ ] **Step 3: Verify build**

```bash
cd src/client && ng build 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/phase-bar.component.html
git add src/client/src/app/features/dashboard/grid/phase-bar.component.ts
git commit -m "feat(phase-bars): switch to light tint + outline rendering

Phase bars now render at 12% fill opacity with 1.2px colored stroke.
Labels use the bar color directly against the light tint background.
Hover increases fill opacity to 25%."
```

---

## Task 9: Delete Deprecated Components and Utilities

**Files:**
- Delete: `src/client/src/app/shared/components/svg-icons/arrow-icon.component.ts`
- Delete: `src/client/src/app/shared/components/svg-icons/x-icon.component.ts`
- Delete: `src/client/src/app/shared/components/svg-icons/bar-icon.component.ts`
- Delete: `src/client/src/app/shared/utils/marker-icon.ts`

- [ ] **Step 1: Check for remaining imports**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/src/client
grep -r "ArrowIconComponent\|XIconComponent\|BarIconComponent\|getMarkerIcon\|marker-icon" src/app/ --include="*.ts" -l
```

If any files still import these, update them to remove the imports.

- [ ] **Step 2: Delete the files**

```bash
rm src/client/src/app/shared/components/svg-icons/arrow-icon.component.ts
rm src/client/src/app/shared/components/svg-icons/x-icon.component.ts
rm src/client/src/app/shared/components/svg-icons/bar-icon.component.ts
rm src/client/src/app/shared/utils/marker-icon.ts
```

- [ ] **Step 3: Verify build and lint**

```bash
cd src/client && ng lint && ng build
```

Expected: Clean build, no lint errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated icon components and marker-icon utility

Delete ArrowIconComponent, XIconComponent, BarIconComponent (shapes no longer used).
Delete getMarkerIcon utility (replaced by SVG component rendering)."
```

---

## Task 10: Final Verification

- [ ] **Step 1: Reset local Supabase and verify**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
supabase db reset
```

Expected: All migrations apply, seed loads 13 active marker types.

- [ ] **Step 2: Full build and lint**

```bash
cd src/client && ng lint && ng build
```

Expected: Clean build, no errors.

- [ ] **Step 3: Start dev server and visually verify**

```bash
cd src/client && ng serve
```

Open the dashboard in a browser. Verify:
- Phase bars render with light tint + outline (not solid fill)
- Data markers show circles with correct inner marks (dot, dash, plain) in correct greens
- Regulatory markers show diamonds in orange with correct inner marks (dot, plain, check)
- Approval shows blue flag, Launch shows violet triangle
- PCD shows slate circle
- Trial Start/End show dashed vertical lines
- LOE shows dark amber square with X, Generic Entry shows lighter amber plain square
- Projected markers render as outlines
- Legend shows all marker types with SVG icons grouped by category
- Legend includes universal state indicators (Actual / Projected / NLE)

- [ ] **Step 4: Commit any fixes from visual testing**

```bash
git add -A
git commit -m "fix: address visual issues found during testing"
```
