---
surface: PowerPoint Export
spec: docs/specs/export-to-powerpoint/spec.md
---

# PowerPoint Export

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
  summary: Client-side PPTX generation via pptxgenjs replicating the dashboard view, with configurable title slide, trial selection, date range, and zoom.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables:
    - trials
    - markers
    - marker_types
    - companies
    - products
  related:
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
- id: pptx-export-rendering
  summary: Phase-bar fills and marker shapes use exact dashboard colors, with marker date-label overlap detection and alternating row backgrounds.
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
