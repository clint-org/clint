---
surface: PowerPoint Export
spec: docs/specs/export-to-powerpoint/spec.md
---

# PowerPoint Export

The `PptxExportService` generates a `.pptx` file replicating the dashboard view using `pptxgenjs`. The export runs directly from the timeline's header Export menu (shared `<app-export-button>` published via `TopbarStateService.exportActions`; there is no format dialog) and captures the current view: active filters, auto-fitted date range, and the on-screen zoom level.

Export details:
- Fixed slide dimensions: 13.33" x 7.5" (widescreen)
- Label column width: 2.8" (Company / Asset / Trial names)
- Phase bars rendered as a tinted wash (12% fill) with a colored border and short phase labels (PH 3), using the canonical phase colors, matching the dashboard
- Markers rendered via a shared visual descriptor (`resolveMarkerVisual` in `core/models/marker-visual.ts`): shape and color come from the marker type, fill is driven by projection (actual = filled, projected = outline), plus inner marks (dot/dash/check/x) and a strike overlay for no-longer-expected. The timeline and the legend share one `drawMarkerGlyph` renderer (`core/services/pptx-marker-glyph.ts`), so they cannot drift; the same descriptor and `GLYPH_RATIOS` drive the on-screen SVG icons
- Date labels on markers with overlap detection
- Alternating row backgrounds for readability
- Legend showing all marker types
- Runs entirely client-side -- no file is sent to a server

## Branded PowerPoint Exports

`PptxExportService` reads from `BrandContextService`:
- **Cover slide** with tenant logo (downloaded as base64 once at slide build), `app_display_name` as title (28pt bold, primary color), "Clinical Trial Landscape" subtitle, today's date
- **Title bar accent** and trial label labels tinted with `brand.primary_color`
- **Per-slide footer** with `app_display_name` left, page number right
- Phase-bar fills, marker colors, slate / amber / red / green / cyan / violet stay hard-coded — those are data colors, not brand
- Logo download failure falls back to text-only header without failing the export

## Capabilities

```yaml
- id: pptx-export-generation
  summary: Client-side PPTX generation via pptxgenjs replicating the dashboard view as shown, at the current on-screen zoom, directly from the header Export menu.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables:
    - trials
    - markers
    - marker_types
    - companies
    - assets
  related:
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
- id: pptx-export-rendering
  summary: Phase bars render as a 12% tinted wash with colored border and short labels (PH 3); markers render via the shared resolveMarkerVisual descriptor (projection-driven fill, inner marks, NLE strike) through one drawMarkerGlyph shared by timeline and legend. Includes marker date-label overlap detection and alternating row backgrounds.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables:
    - marker_types
  related:
    - pptx-export-generation
    - timeline-phase-bars
    - timeline-event-markers
  user_facing: true
  role: viewer
  status: active
- id: pptx-export-branded
  summary: Cover slide and per-slide footer use tenant logo, app display name, and primary color tinting from BrandContextService.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables:
    - tenants
  related:
    - pptx-export-generation
    - whitelabel-tenant-branding
  user_facing: true
  role: viewer
  status: active
- id: pptx-export-legend
  summary: Exported deck includes a legend slide listing all marker types with shapes and labels.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables:
    - marker_types
    - marker_categories
  related:
    - pptx-export-generation
    - timeline-legend
  user_facing: true
  role: viewer
  status: active
```
