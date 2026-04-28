# Whitelabel branded PPT exports (Plan 8)

## Goal

Wire `BrandContextService` into the existing `PptxExportService` so generated PPTX
files reflect the active tenant's brand: tenant logo + name on the cover, primary
color tinting prominent labels, and a per-slide footer with the app display name and
page numbers.

## Constraints

- Modify only `src/client/src/app/core/services/pptx-export.service.ts` and this plan.
- Phase-bar colors (`PHASE_COLORS`) and marker colors (data colors) MUST stay.
- Slate / amber / red / green / cyan / violet remain hard-coded -- those are data
  colors, not brand.
- BrandContext default (`#0d9488` teal) should preserve today's visual behavior.
- pptxgenjs accepts hex colors WITHOUT the `#`. Must strip when passing.
- Logo download is async; failures must fall back gracefully (no logo, no error).

## Surface area

`PptxExportService` currently:
- Has a single `exportDashboard(companies, options)` method that creates one slide.
- Renders title bar (`renderTitle`), header (`renderHeader`), grid lines, rows, and
  legend on that slide.
- Does NOT have a cover slide, footer, or page numbers.
- Uses `1e293b` for the title text and `14b8a6` for the title-bar accent line.
- Uses `94a3b8` for company-name labels (left rail).

## Steps

1. Inject `BrandContextService`.
2. Add `loadLogoAsBase64(url)` private helper -- fetch + base64-encode, return null on
   failure.
3. Add `addFooter(slide, name, pageNum, totalPages)` private helper.
4. In `exportDashboard`, capture `appDisplayName`, `logoUrl`, `primaryColor` into
   locals at the top. Strip leading `#` for pptxgenjs.
5. Build cover slide BEFORE the data slide:
   - Optional logo (top-left, ~2x0.8 in, contain).
   - App display name as title (28pt bold, primary color).
   - "Clinical Trial Landscape" subtitle (14pt slate).
   - Today's date (11pt slate).
6. Recolor the existing title bar's accent line and the title text to use the
   primary color (these were already brand-coded with teal -- they just become
   tenant-aware).
7. Track total page count = 2 (cover + data slide). Call `addFooter` on each slide
   with the right page number.
8. Verify build (`npx ng build`) and lint pass.

## What I will NOT touch

- Phase bar fill colors.
- Marker colors (driven by `marker_types.color` from DB).
- Legend background (slate `f8fafc`) -- not brand.
- Grid line color (`e2e8f0`) -- structural.
- Header text (`64748b`, `475569`) -- structural slate.
- Row alternate tint (`f8fafc`) -- structural.

## Risk

- pptxgenjs slide count: we now have two slides instead of one. The cover is small
  and content is preserved. No regression to the data slide layout.
- Logo fetch from a remote origin may CORS-fail; the helper returns null and the
  cover degrades gracefully (just title + date, no logo).
- Brand color contrast on cover title: `#0d9488` on white is fine; tenants that
  pick a very pale color could regress, but that's a brand-config concern, not
  this change.

## Verification

- `cd src/client && npx ng build` succeeds.
- `npx ng lint` clean (modulo pre-existing warnings).
- Manual smoke if a dev environment is available: trigger export, open the file,
  confirm cover slide and footer are present.
