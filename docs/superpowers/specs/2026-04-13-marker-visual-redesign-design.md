# Marker Visual Redesign

## Summary

Redesign the marker icon system to be more visually distinct, internally consistent, and cohesive with the phase bar palette. Reduces 21 marker types to 12, introduces a universal projected/actual/no-longer-expected state system, adds inner marks for within-category differentiation, and switches phase bars to a light-tint-plus-outline rendering style.

## Goals

- Every marker type is visually unique at a glance (shape + color + inner mark)
- A universal state system (actual/projected/no-longer-expected) replaces per-type projected variants
- Phase bars recede into the background so markers pop as the visual foreground
- Projection source (Stout/Company/Primary) moves to tooltip labels only -- no visual distinction between sources
- "No longer expected" becomes a modifier on any marker, not its own marker type

## Non-Goals

- Restructuring the marker_categories or marker_assignments tables
- Notification system changes
- Dark mode
- Custom (user-created) marker types -- this redesign covers system marker types only

---

## Universal State System

Every marker type renders in exactly one of three states, determined by the `projection` field on the marker:

| State | Visual Treatment | When |
|---|---|---|
| **Actual** | Filled icon | `projection = 'actual'` |
| **Projected** | Outline icon (white fill, colored stroke) | `projection IN ('company', 'primary', 'stout')` |
| **No Longer Expected** | 30% opacity + horizontal strikethrough line (#64748b, 2.5px) | New boolean field `no_longer_expected` on the marker |

### Projection Source Labels (Tooltip Only)

| DB Value | Display Label |
|---|---|
| `actual` | Actual |
| `company` | Company guidance |
| `primary` | Primary source estimate |
| `stout` | Stout estimate |

These labels appear in the marker tooltip. There is no visual difference between projection sources on the timeline -- all non-actual projections render as outline icons.

---

## Marker Types

### 1. Data Category -- Circle shape, green family

| Marker | Inner Mark | Color | Description |
|---|---|---|---|
| **Topline Data** | Center dot | `#4ade80` | Initial high-level results |
| **Interim Data** | Horizontal dash | `#22c55e` | Partial or interim analysis |
| **Full Data** | None (plain solid) | `#16a34a` | Complete dataset published |

**Rendering details:**
- Topline actual: filled #4ade80 circle with white center dot (r=3 in a r=11 icon)
- Topline projected: white circle with #4ade80 stroke, green center dot
- Interim actual: filled #22c55e circle with white horizontal dash (stroke-width 2.5, stroke-linecap round)
- Interim projected: white circle with #22c55e stroke, green horizontal dash
- Full actual: solid filled #16a34a circle
- Full projected: white circle with #16a34a stroke

### 2. Regulatory Category -- Diamond shape, all orange #f97316

| Marker | Inner Mark | Color | Description |
|---|---|---|---|
| **Regulatory Filing** | Center dot | `#f97316` | IND/NDA/BLA filing |
| **Submission** | None (plain) | `#f97316` | Application submitted to agency |
| **Acceptance** | Checkmark | `#f97316` | Filing accepted for review |

All three use the same base color. Differentiated by inner marks only.

**Rendering details:**
- Filing actual: filled orange diamond with white center dot
- Filing projected: white diamond with orange stroke, orange center dot
- Submission actual: plain filled orange diamond
- Submission projected: plain white diamond with orange stroke
- Acceptance actual: filled orange diamond with white checkmark (polyline, stroke-width 2.5)
- Acceptance projected: white diamond with orange stroke, orange checkmark

### 3. Approval & Launch Category -- Distinct shapes, blue/violet

| Marker | Shape | Color | Description |
|---|---|---|---|
| **Approval** | Flag | `#3b82f6` | Regulatory approval granted |
| **Launch** | Right-pointing triangle | `#7c3aed` | Commercial launch date |

**Rendering details:**
- Approval actual: filled blue flag (pole + wavy Bezier flag body)
- Approval projected: blue pole, white flag body with blue stroke
- Launch actual: filled violet right-pointing triangle
- Launch projected: white triangle with violet stroke

### 4. Clinical Trial Category -- Structural markers, slate

| Marker | Shape | Color | Description |
|---|---|---|---|
| **Primary Completion Date (PCD)** | Circle (plain) | `#475569` | Last subject's last visit for primary outcome |
| **Trial Start** | Dashed vertical line | `#94a3b8` | Beginning of trial (bookend) |
| **Trial End** | Dashed vertical line | `#94a3b8` | End of trial (bookend) |

**Rendering details:**
- PCD actual: solid filled #475569 circle
- PCD projected: white circle with #475569 stroke
- Trial Start/End actual: dashed vertical line (#94a3b8, stroke-width 1.5, stroke-dasharray 4,3)
- Trial Start/End projected: lighter dashed line (#cbd5e1)
- Trial Start/End NLE: same line at 25% opacity (no strikethrough, just faded)

### 5. Loss of Exclusivity Category -- Square shape, amber

| Marker | Inner Mark | Color | Description |
|---|---|---|---|
| **LOE Date** | X mark | `#78350f` | Patent/exclusivity expiration |
| **Generic Entry** | None (plain) | `#d97706` | First generic competitor enters market |

**Rendering details:**
- LOE actual: filled #78350f square with white X (two diagonal lines, stroke-width 2.5)
- LOE projected: white square with #78350f stroke, amber X
- Generic Entry actual: plain filled #d97706 square
- Generic Entry projected: white square with #d97706 stroke

---

## No Longer Expected State

"No longer expected" is a universal modifier, not a standalone marker type. It applies to any marker.

**Data model:** Add a `no_longer_expected` boolean (default false) to the `markers` table.

**Visual treatment:**
- Icon renders at 30% opacity (both fill and inner marks)
- Horizontal strikethrough line drawn across the center (color #64748b, stroke-width 2.5)
- Line extends slightly beyond the icon bounds for visibility

**Exception:** Trial Start/End bookends render NLE as 25% opacity on the dashed line only (no strikethrough line -- it would look odd on a vertical line).

---

## Phase Bar Rendering

Phase bars switch from solid fill at 75% opacity to **light tint + outline**:

- Fill: phase color at **12% opacity** (`fill-opacity="0.12"`)
- Stroke: phase color at **1.2px width**
- Phase label text: uses a darker shade of the phase color for readability

### Phase Color Palette (Unchanged)

| Phase | Color | Hex |
|---|---|---|
| PRECLIN | Slate 300 | `#cbd5e1` |
| P1 | Slate 400 | `#94a3b8` |
| P2 | Cyan 300 | `#67e8f9` |
| P3 | Teal 400 | `#2dd4bf` |
| P4 | Violet 400 | `#a78bfa` |
| APPROVED | Violet 500 | `#8b5cf6` |
| LAUNCHED | Teal 600 | `#0d9488` |
| OBS | Amber 400 | `#fbbf24` |

The original hex values are preserved. The tint+outline rendering makes them recede sufficiently that markers dominate the foreground regardless of color overlap.

---

## Removed Marker Types

The following marker types are removed from the system:

- Data Reported (generic -- replaced by Topline/Interim/Full)
- Projected Data Reported (replaced by projected state on Topline/Interim/Full)
- Change from Prior Update
- Event No Longer Expected (now a universal state modifier)
- Projected Regulatory Filing (replaced by projected state on Filing)
- Submitted Regulatory Filing (merged into Submission)
- FDA Submission (merged into Submission)
- FDA Acceptance (merged into Acceptance)
- Label Projected Approval/Launch (replaced by projected state on Approval)
- Label Update
- Est. Range of Potential Launch (removed)
- PDUFA Date (removed)
- Launch Date (merged into Launch)
- Trial Start (triangle) -- replaced by dashed vertical line
- Trial End (triangle) -- replaced by dashed vertical line

---

## SVG Icon Components

Existing SVG icon components need to be updated:

- **CircleIconComponent** -- add `innerMark` input: `'dot' | 'dash' | 'none'`
- **DiamondIconComponent** -- add `innerMark` input: `'dot' | 'check' | 'none'`
- **FlagIconComponent** -- no changes needed
- **New: TriangleIconComponent** -- right-pointing triangle for Launch
- **New: SquareIconComponent** -- square with optional `innerMark`: `'x' | 'none'`
- **XIconComponent** -- can be removed (NLE is now a universal overlay, not a shape)
- **ArrowIconComponent** -- can be removed (Change from Prior Update is deleted)
- **BarIconComponent** -- can be removed (Est. Range removed)
- **Dashed line rendering** -- handled inline in the marker component for Trial Start/End (not a reusable icon component)

### Fill Style Simplification

The current `fill_style` field on `marker_types` supports `'outline' | 'filled' | 'striped' | 'gradient'`. This simplifies to:

- `'filled'` -- used as the base; actual state renders filled, projected renders outline
- `'striped'` and `'gradient'` -- no longer used, can be deprecated

The actual fill style is now determined at render time by the marker's `projection` field, not the marker type's `fill_style`.

---

## Legend Component

The legend groups markers by category, showing each marker type with its actual-state icon and name. The legend does not show projected or NLE variants -- those are explained by the universal state indicators.

### Legend layout:
```
DATA: [topline icon] Topline  [interim icon] Interim  [full icon] Full
REGULATORY: [filing icon] Filing  [submission icon] Submission  [acceptance icon] Acceptance
APPROVAL & LAUNCH: [approval icon] Approval  [launch icon] Launch
CLINICAL TRIAL: [pcd icon] PCD  [start icon] Trial Start  [end icon] Trial End
LOE: [loe icon] LOE Date  [generic icon] Generic Entry
```

Universal state indicators (filled = actual, outline = projected, strikethrough = NLE) should appear once in the legend header, not repeated per marker.

---

## Database Migration

### marker_types table changes:
- Update system marker type rows: reduce from 21 to 12, updating shape/color/inner_mark values
- Add `inner_mark` column: `text CHECK (inner_mark IN ('dot', 'dash', 'check', 'x', 'none'))` with default `'none'`
- Update `shape` CHECK constraint to include `'triangle'` and `'square'` (currently allows circle, diamond, flag, arrow, x, bar)
- New allowed shapes: `'circle' | 'diamond' | 'flag' | 'triangle' | 'square' | 'dashed-line'`
- Soft-delete removed marker types (set `is_system = false` or add `archived` flag) rather than hard-deleting, in case existing markers reference them

### TypeScript model changes:
- Add `inner_mark` to `MarkerType` interface: `inner_mark: 'dot' | 'dash' | 'check' | 'x' | 'none'`
- Update `shape` union type to include `'triangle' | 'square' | 'dashed-line'`
- Remove `'arrow' | 'x' | 'bar'` from shape union (deprecated)
- Add `no_longer_expected: boolean` to `Marker` interface

### markers table changes:
- Add `no_longer_expected boolean NOT NULL DEFAULT false`
- The existing `projection` and `is_projected` fields stay as-is

### Phase bar rendering:
- No database changes. Phase colors stay in the `DEFAULT_COLORS` constant in `phase-bar.component.ts`
- Update rendering from `fill={color} opacity="0.75"` to `fill={color} fill-opacity="0.12" stroke={color} stroke-width="1.2"`
