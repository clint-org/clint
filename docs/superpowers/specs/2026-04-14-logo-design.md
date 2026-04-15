# Logo Design -- Triple C Mark

## Overview

A geometric abstract mark for Clint (Clinical Trial Dashboard) built from three nested open squares forming the letter C. The mark conveys layers of analysis converging inward to insight -- the core job the product does for pharma executives scanning competitive landscapes.

## The Mark

Three concentric C shapes (squares with the right side removed), all opening to the right. Tight, equal spacing between layers. Subtle progressive stroke weight pulls the eye inward.

### Geometry

All three shapes share the same vertical center. Each is a polyline forming three sides of a square (top, left, bottom), open on the right.

Coordinates at the reference viewBox of `0 0 140 140`:

| Layer  | Points                              | Stroke Width | Color              |
|--------|--------------------------------------|--------------|--------------------|
| Outer  | `112,24 24,24 24,116 112,116`       | 1.5          | `#cbd5e1` slate-300 |
| Middle | `96,40 40,40 40,100 96,100`         | 2.2          | `#94a3b8` slate-400 |
| Inner  | `80,56 56,56 56,84 80,84`           | 3.0          | `#0d9488` teal-600  |

All strokes use `stroke-linecap="round"` and `stroke-linejoin="round"`. No fill.

### Dark Background Variant

For use on dark backgrounds (sidebar, login, email, merchandise):

| Layer  | Color              |
|--------|--------------------|
| Outer  | `#475569` slate-600 |
| Middle | `#64748b` slate-500 |
| Inner  | `#14b8a6` teal-500  |

### Size Adaptations

Strokes must thicken at small sizes to remain legible. Target weights by rendered size:

| Rendered Size | Outer | Middle | Inner | Context              |
|---------------|-------|--------|-------|----------------------|
| 80px          | 1.5   | 2.2    | 3.0   | Hero / login screen  |
| 48px          | 2.5   | 3.5    | 5.0   | Large display        |
| 32px          | 4.0   | 5.5    | 7.5   | Sidebar expanded     |
| 24px          | 5.0   | 7.0    | 9.0   | Sidebar collapsed    |
| 16px          | 7.0   | 9.0    | 11.0  | Favicon / browser tab |

These are viewBox-relative stroke widths (the viewBox stays `0 0 140 140`; the rendered size changes via the SVG `width`/`height` attributes).

### Reference SVG

```svg
<svg width="80" height="80" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg">
  <polyline points="112,24 24,24 24,116 112,116" stroke="#cbd5e1" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="96,40 40,40 40,100 96,100" stroke="#94a3b8" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <polyline points="80,56 56,56 56,84 80,84" stroke="#0d9488" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

## Wordmark Lockups

### Mark + Name (primary)

The mark sits to the left of "Clint" set in the app's system font at `font-weight: 600`, `letter-spacing: -0.01em`. 12px gap between mark and text.

### Mark + Name + Full Title

Mark | "Clint" | 1px divider (slate-200) | "CLINICAL TRIAL DASHBOARD" in `font-size: 12px`, `font-weight: 500`, `letter-spacing: 0.04em`, `text-transform: uppercase`, color slate-500.

## Application Contexts

### Sidebar (collapsed, dark background)

- 24px mark using dark variant colors
- Replaces the current "C" teal square at `sidebar.component.ts`

### Header bar

- 20px mark using light variant colors
- Paired with "Clint" wordmark text
- Replaces the plain text "Clint" link at `header.component.ts`

### Favicon

- 16px mark with thickened strokes
- Generated as `.ico` and `.png` formats
- Referenced in `index.html`

### Login screen

- 56px mark centered above "CLINICAL TRIAL DASHBOARD" title
- Above the Google sign-in button

### Browser tab

- 14-16px favicon with page title "Clint -- {page name}"

## Implementation Scope

1. **Create SVG logo component** -- standalone Angular component rendering the mark at any size with automatic stroke adaptation
2. **Generate favicon assets** -- 16px, 32px, and 180px (Apple touch) PNG exports; `.ico` file
3. **Update sidebar** -- replace the teal "C" square with the logo component
4. **Update header** -- replace the plain text "Clint" with mark + wordmark lockup
5. **Update index.html** -- add favicon references
6. **Update login screen** -- add centered logo above sign-in

## Design Principles Applied

- **Authority through restraint** -- pure geometry, no decoration, no effects
- **Tinted neutrals** -- slate palette, never pure gray
- **Data density over decoration** -- the mark is compact and information-rich (three layers of meaning in minimal space)
- **Instant visual parsing** -- progressive weight creates clear hierarchy without effort
