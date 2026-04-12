---
id: spec-2026-003
title: Export to PowerPoint
slug: export-to-powerpoint
status: approved
created: 2026-03-15
updated: 2026-03-15
---

# Export to PowerPoint

## Summary

Add a client-side PowerPoint export that generates a high-fidelity `.pptx` file matching the dashboard's timeline visualization. The export renders company/product/trial labels, phase bars, event markers, and a legend onto a single widescreen slide, using PptxGenJS to programmatically construct native PowerPoint shapes with precise positioning. The user can choose the zoom level before exporting, and the export respects the currently active filters.

## Goals

- Generate a `.pptx` file that visually matches the web dashboard as closely as possible
- Export runs entirely client-side (no server needed) using PptxGenJS
- Respect current dashboard filters (company, product, therapeutic area, year range)
- Let the user choose the zoom level (yearly, quarterly, monthly, daily) via a dialog before export
- Fit all visible data onto a single slide (scaling down if necessary)
- Include the legend at the bottom of the slide
- Produce files that open correctly in PowerPoint, Keynote, and Google Slides

## Non-Goals

- Multi-slide pagination (single slide only for MVP)
- Editable chart objects in PowerPoint (shapes are static, not linked to data)
- Server-side rendering or PDF export
- Exporting marker tooltips or note content (just the visual timeline)
- Drag-to-create or interactive features in the exported file

---

## Architecture Overview

```
Dashboard Component
  └── Export Button (top bar, next to filters)
        └── Export Dialog (PrimeNG p-dialog)
              ├── Zoom level selector (p-selectbutton)
              └── "Export" button
                    └── PptxExportService.exportDashboard(data, options)
                          ├── Creates PptxGenJS Presentation
                          ├── Adds single slide with:
                          │   ├── Title + subtitle text
                          │   ├── Timeline header (year/quarter/month columns)
                          │   ├── Grid lines (vertical)
                          │   ├── Row labels (company, product, trial)
                          │   ├── Phase bars (colored rectangles)
                          │   ├── Markers (circles, diamonds, flags, etc.)
                          │   └── Legend (bottom section)
                          └── Triggers browser download (.pptx)
```

All export logic lives in a standalone Angular service (`PptxExportService`) that takes the dashboard data model and rendering options, constructs the PowerPoint programmatically, and triggers a file download. No database changes, no API changes.

---

## Frontend Design

### New Dependencies

- `pptxgenjs` (v4.0.1) -- client-side PowerPoint generation

### New Files

- `src/client/src/app/core/services/pptx-export.service.ts` -- Core export logic
- `src/client/src/app/features/dashboard/export-dialog/export-dialog.component.ts` -- Export options dialog

### Modified Files

- `src/client/src/app/features/dashboard/dashboard.component.ts` -- Add export button and dialog
- `src/client/src/app/features/dashboard/dashboard.component.html` -- Add export button and dialog template

### PptxExportService Design

The service receives the same `DashboardCompany[]` data that the grid component uses, plus export options (zoom level, year range). It maps the data to PptxGenJS API calls.

**Slide Layout (Widescreen 13.33" x 7.5"):**

```
┌──────────────────────────────────────────────────────────┐
│  Clinical Trial Dashboard                    [date]      │  <- Title bar (0.3")
├────────┬─────────────────────────────────────┬───────────┤
│Company │ 2014  2015  2016  2017  2018  ...   │  Notes    │  <- Header (0.3")
│Product │                                     │           │
│Trial   │                                     │           │
├────────┼─────────────────────────────────────┼───────────┤
│AZ      │  ████ P1 ████  ████ P2 ███ ● ◆     │           │  <- Data rows
│Farxiga │                                     │           │     (dynamic height)
│DAPA-HF │                                     │           │
│        │        ████████ P3 ████████  ◆ ⚑   │           │
│...     │                                     │           │
├────────┴─────────────────────────────────────┴───────────┤
│  ● Data Reported  ◇ Projected Filing  ⚑ Approval  ...   │  <- Legend (0.5")
└──────────────────────────────────────────────────────────┘
```

**Coordinate System:**
- Labels column: x=0, width=2.5"
- Timeline area: x=2.5", width=9.33" (adjustable)
- Notes column: x=11.83", width=1.5"
- Title bar: y=0, height=0.3"
- Header: y=0.3", height=0.3"
- Data area: y=0.6", height=dynamic (scales to fit)
- Legend: bottom 0.5"

**Row Height Calculation:**
- Available height for data = 7.5" - 0.3" (title) - 0.3" (header) - 0.5" (legend) = 6.4"
- Row height = 6.4" / number_of_trials (minimum ~0.12" for readability)
- If rows would be smaller than 0.12", scale fonts proportionally

**Phase Bar Rendering:**
- Map `start_date`/`end_date` to x coordinates within the timeline area
- Use `addShape(pptx.ShapeType.roundRect, { x, y, w, h, fill, line })` with the phase color
- Apply corner radius matching the web (rx=3 maps to ~0.02" rectRadius)
- Add phase label as text inside the shape if width permits

**Marker Rendering:**
- Map `event_date` to x coordinate
- For each marker shape type, use the appropriate PptxGenJS shape:
  - `circle` -> `ShapeType.ellipse` (small, ~0.1" diameter)
  - `diamond` -> `ShapeType.diamond`
  - `flag` -> `ShapeType.rect` with custom line (flagpole) + triangle
  - `arrow` -> `ShapeType.upArrow`
  - `x` -> Two crossed lines
  - `bar` -> `ShapeType.roundRect` (range marker)
- Color and fill based on marker_type properties
- Add date label below marker in 6pt monospace font

**Legend Rendering:**
- Positioned at bottom of slide
- Groups: Clinical Trial | Data | Regulatory | Approval | Loss of Exclusivity
- Each entry: colored shape + label text
- Horizontal layout with even spacing

**Color Mapping:**
Uses the exact hex colors from the web dashboard:
- Phase bars: P1=#94a3b8, P2=#67e8f9, P3=#2dd4bf, P4=#a78bfa, OBS=#fbbf24
- Markers: green=#22c55e, red=#ef4444, blue=#3b82f6, gray=#374151, orange=#f97316

### Export Dialog Component

A simple PrimeNG dialog with:
- Zoom level selector (p-selectbutton: Year, Quarter, Month, Day)
- Export button that triggers the service
- Loading state while generating

---

## Tasks

```yaml
tasks:
  - id: T1
    title: "Install PptxGenJS and create export service"
    description: |
      1. Install pptxgenjs as a production dependency
      2. Create PptxExportService in src/client/src/app/core/services/pptx-export.service.ts
      3. The service should have a single public method:
         exportDashboard(companies: DashboardCompany[], options: ExportOptions): Promise<void>
         where ExportOptions = { zoomLevel: ZoomLevel, startYear: number, endYear: number }
      4. Implementation steps:
         a. Create a new pptxgenjs Presentation with LAYOUT_WIDE (13.33" x 7.5")
         b. Add a single slide
         c. Render title bar: "Clinical Trial Dashboard" + current date
         d. Flatten companies > products > trials into rows (same logic as dashboard-grid)
         e. Calculate row height: available_height / num_trials
         f. Render timeline header with year/quarter/month labels based on zoom
         g. Render vertical grid lines at year/quarter/month boundaries
         h. For each row, render:
            - Company name (only on first row of company group, uppercase, small font)
            - Product name (only on first row of product group)
            - Trial name
            - Phase bars as rounded rectangles with correct colors and positions
            - Markers as shapes (ellipse, diamond, etc.) with correct colors and positions
            - Date labels below markers in monospace font
         i. Render legend at bottom of slide grouped by category
         j. Render alternating row backgrounds (white / light gray)
         k. Trigger file download via pres.writeFile({ fileName: 'clinical-trial-dashboard.pptx' })
      5. Use TimelineService for date-to-position calculations (inject it)
      6. Phase bar colors: P1=#94a3b8, P2=#67e8f9, P3=#2dd4bf, P4=#a78bfa, OBS=#fbbf24
      7. Marker rendering rules:
         - circle/filled: solid ellipse
         - circle/outline: ellipse with line border, no fill
         - diamond/filled: solid diamond shape
         - diamond/outline: diamond with border, no fill
         - flag/filled or striped: small rectangle + vertical line
         - bar/gradient: horizontal rect for date range
         - arrow/filled: upward arrow shape
         - x/filled: two crossed diagonal lines
    files:
      - modify: src/client/package.json
      - create: src/client/src/app/core/services/pptx-export.service.ts
    dependencies: []
    verification: "cd src/client && npm install && npx ng lint && npx ng build"

  - id: T2
    title: "Create export dialog and wire up to dashboard"
    description: |
      1. Create ExportDialogComponent at
         src/client/src/app/features/dashboard/export-dialog/export-dialog.component.ts
         - Inline template with p-dialog, p-selectbutton for zoom level, p-button for export
         - Input: companies (DashboardCompany[]), startYear, endYear
         - Uses PptxExportService to generate the file
         - Shows loading state during generation
         - Closes dialog on completion
      2. Update dashboard.component.ts:
         - Add ExportDialogComponent to imports
         - Add exportDialogOpen signal
         - Add openExportDialog() method
      3. Update dashboard.component.html:
         - Add p-button with "Export" label and fa-solid fa-file-powerpoint icon
           in the top bar, after the filter panel
         - Add <app-export-dialog> with [(visible)] binding
         - Pass companies(), startYear(), endYear() to the dialog
      4. The export button should only be visible when data is loaded (not during loading/error)
    files:
      - create: src/client/src/app/features/dashboard/export-dialog/export-dialog.component.ts
      - modify: src/client/src/app/features/dashboard/dashboard.component.ts
      - modify: src/client/src/app/features/dashboard/dashboard.component.html
    dependencies: [T1]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T3
    title: "Visual verification with Playwright"
    description: |
      Use the Playwright MCP browser tools to verify the export feature works:
      1. Navigate to the dashboard at localhost (with authenticated session)
      2. Verify the "Export" button appears in the top bar
      3. Click the Export button, verify the dialog opens
      4. Verify the dialog contains zoom level options and an Export button
      5. Select "Year" zoom level
      6. Click Export and verify no console errors occur
      7. Verify the dialog closes after export
      8. Take screenshots of:
         - Dashboard with Export button visible
         - Export dialog open
    files: []
    dependencies: [T2]
    verification: "Playwright browser checks pass with no console errors"
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| PptxGenJS shape positioning may not perfectly match web pixel layout | Use the same TimelineService calculations; iterate on positioning with visual comparison |
| Very dense data (50+ trials) may produce unreadable single-slide output | Calculate minimum row height; add a warning in the dialog if row count exceeds threshold |
| Bundle size increase from PptxGenJS (~2.6MB unpacked) | PptxGenJS tree-shakes well; monitor build size; can lazy-load the module |
| Marker shapes in PPTX may not exactly match SVG rendering | Map each shape type to the closest PptxGenJS built-in shape; accept minor visual differences |
| Date label overlap when markers are close together | Skip date labels when markers are within 20px of each other |

---

## Open Questions

None -- scope is well-defined as a client-side, single-slide export matching current dashboard filters.
