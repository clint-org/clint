# Clint Loader and Brand Presence

Date: 2026-06-11
Status: Approved design, pending implementation plan

## Problem

1. **Loading indicators render huge and off-brand.** Every `p-progressspinner` asks for a small brand-colored spinner via Tailwind `styleClass` sizing and a stroke override, and loses both fights: Tailwind v4 emits utilities inside a CSS cascade layer while PrimeNG injects unlayered styles, so PrimeNG's default `width: 100px; height: 100px` beats any `w-[1.25rem]` utility. Separately, PrimeNG's spinner animates its stroke through four colors via keyframes, which beat the static `stroke: var(--brand-600)` rule in `primeng-overrides.css`. Result: the giant green spinner in the export dialog, filter pane, and detail drawers.
2. **The Clint mark is nearly invisible in the product.** It appears only in the collapsed dark sidebar at 24px, the login card fallback, onboarding, and the 404 page. Exports, the surface that travels furthest, can render with no mark at all.
3. **Co-branding has no defined hierarchy.** Agency-branded hosts (e.g. Stout) currently evict the Clint mark entirely from the sidebar. The product should feel whitelabeled while everyone still calls it Clint.

## Decisions (from brainstorm, 2026-06-11)

- Loader style: **draw-through** treatment of the triple-C mark (each C strokes itself in and releases, staggered), chosen over arc, sweep, data bars, cascade pulse, and comet trace.
- Co-brand hierarchy: **Clint-led lockup** (lockup B): Clint owns product identity, agency rides along as "delivered by".
- Export footer: **all three parties** (option B): Clint, agency, tenant.
- Empty states get a faded mark watermark. Topbar corner mark rejected.
- Login keeps its tenant-logo-led card; Clint mark joins the page footer.
- AI surfaces are sub-branded **Clint Intelligence**.
- Animation policy: the mark animates **only during actual loading or AI activity**. At rest it is static. The marketing landing hero gets a one-shot draw-in on load. All animation is disabled under `prefers-reduced-motion: reduce` (static mark at full opacity instead).

## Design

### 1. Shared mark geometry: `clint-mark.ts`

New constants file in `src/client/src/app/shared/components/`:

- `CLINT_MARK_VIEWBOX` (`0 0 140 140`) and the three polyline point strings (outer, middle, inner).
- `clintMarkStrokes(size)`: the existing size-to-stroke-width tiers from `ClintLogoComponent`.

Consumers: `ClintLogoComponent` (refactored, no behavior change), the new loader, the new watermark, the new intelligence badge, and `marketing-landing.component.ts` (which currently hand-inlines the polylines twice). The mark is defined exactly once.

### 2. `app-loader` component

`src/client/src/app/shared/components/loader/loader.component.ts` (+ `.spec.ts`), standalone, OnPush.

- **Inputs:** `size` (number, default 20), `label` (optional string; renders an uppercase tracked mono caption beside the mark, replacing the hand-rolled spans at today's call sites).
- **Visuals:** two stacked copies of the mark in one SVG. Bottom: static track at 18% opacity. Top: animated polylines with `pathLength="1"`, `stroke-dasharray: 1`, keyframes `stroke-dashoffset 1 -> 0 -> -1` over 1.8s, `cubic-bezier(0.5, 0.05, 0.45, 0.95)`, ring delays 0 / 150ms / 300ms. Colors: outer slate-300, middle slate-400, inner `var(--brand-600)` so whitelabel hosts tint automatically.
- **A11y:** host `role="status"`; `aria-label` falls back to `label` or "Loading". Caption is visible text; the SVG is `aria-hidden`.
- **Reduced motion:** animation removed, track at full opacity (static mark).

### 3. Spinner call-site replacements

Replace all five `p-progressspinner` usages with `app-loader`:

| Surface | File | Size |
| --- | --- | --- |
| Export dialog ("Generating image/PowerPoint") | `features/dashboard/export-dialog/export-dialog.component.ts` | 20 |
| Landscape filter bar ("Loading filters...") | `features/landscape/landscape-filter-bar.component.html` | 16 |
| Entity marker drawer | `features/landscape/entity-marker-drawer.component.ts` | 28 |
| Marker detail panel | `features/landscape/landscape-shell.component.ts` | 28 |
| Events page detail panel | `features/events/events-page.component.html` | 28 |

Remove the dead `.p-progressspinner-circle` override from `primeng-overrides.css` and the `ProgressSpinner` imports. Button `[loading]` spinners and skeletons are unchanged.

### 4. Boot splash

Today the stretch between the OAuth redirect and Angular rendering (including the pre-bootstrap `get_brand_by_host` RPC) is a blank white page. Add a static splash to `index.html`: the draw-through mark centered, implemented as inline CSS only (duplicated from the loader by necessity; it runs before any bundle loads).

- **All-slate, no wordmark:** the splash renders before the host's brand is known, so no color or name can flash wrong on whitelabel domains.
- Angular replaces it on bootstrap (it lives inside `<app-root>` as projected placeholder content).
- Reduced motion: static mark.

### 5. Sidebar identity lockup (revised 2026-06-12)

`core/layout/sidebar.component.ts`:

- Top identity slot, expanded: Clint mark (20px, dark variant) + tracked uppercase CLINT wordmark (`PLATFORM_OPERATOR`, never the brand display name: the first cut used `appDisplayName()`, which rendered the tenant's name, duplicated the topbar tenant chooser, and tracked badly on long names).
- Agency credit, expanded only: an "INTELLIGENCE BY" colophon pinned at the sidebar's very bottom edge, below the account row (microlabel + agency logo in a small white chip, agency name text fallback). Passive signage on every page, since the sidebar is global chrome.
- Collapsed rail: the Clint mark only, top slot; no agency chip (a 52px rail has no room for a third bottom row, and the agency keeps its presence in the expanded state, login, and exports).

### 6. Empty-state watermark

New `app-mark-watermark` presentational component (shared/components/watermark/): absolutely positioned, centered, the mark at ~100px and 7% opacity in slate-900, `aria-hidden="true"`, `pointer-events: none`. Parent supplies `position: relative`.

Opt-in on the major visualization empty states, which are centered flex containers: timeline ("no clinical trial data"), bullseye ("no assets match"), heatmap ("no data matches"). The catalysts and events tables render their empty states as table rows where an absolutely positioned watermark does not fit; they stay text-only. Static, never animated.

### 7. Export footer: three parties (PNG and PPTX)

Both export footers carry the same ordered segments:

1. Clint mark (16px) + the artifact label "Timeline" in bold (revised 2026-06-12: the leading slot first used `appDisplayName()`, which on tenant-named hosts duplicated the PREPARED FOR tenant segment). It never uses the host brand `logo_url` (that produced a double-agency footer on agency hosts).
2. Divider, "DELIVERED BY" microlabel + agency logo (name text fallback). Hidden when no agency.
3. Divider, "PREPARED FOR" microlabel + tenant logo (initial-badge fallback) + tenant name, truncated with ellipsis at a max width. Hidden if tenant context is somehow absent.
4. Export date right-aligned (PPTX also keeps page numbers).

Surfaces: `features/dashboard/export/export-snapshot-host.component.ts` (PNG) and `core/services/pptx-export.service.ts` `addFooter` / `FooterBrand` (PPTX). `FooterBrand` gains the tenant name and the rendered Clint mark (rasterized once, reused per slide). The PPTX cover keeps its existing co-brand layout.

### 8. Login page

The card hierarchy stays exactly as shipped: tenant logo leads, "Sign in to the {appName} workspace", provider buttons, agency credit foot ("Competitive intelligence by" + agency logo). Changes:

- Page footer: a small static Clint mark (12px) joins the existing "Powered by Clint" line.
- Default hosts without a tenant logo keep the Clint mark in the card (current fallback), now sourced from the shared geometry.

### 9. Marketing landing

- Replace the two hand-inlined mark SVGs with the shared geometry (header 24px static, hero 56px).
- Hero mark plays the draw-in once on page load (`animation-iteration-count: 1`), then rests as the full mark. Skipped under reduced motion.

### 10. Clint Intelligence sub-brand

New `app-intelligence-badge` (shared/components/intelligence-badge/): mark (14px) + tracked mono label. Input `active` (boolean): when true the badge's mark runs the draw-through animation (the badge becomes the loader); when false it is static.

**Revised 2026-06-13: always Clint, in Clint teal.** The badge first read "{APPDISPLAYNAME} INTELLIGENCE" with the accent in `text-brand-600`, which on a whitelabel host rendered the tenant's product name and brand color (e.g. "BI INTELLIGENCE" in blue). But the AI engine is the platform operator's capability, not the tenant's product, so the badge now always reads "{PLATFORM_OPERATOR} INTELLIGENCE" ("Clint Intelligence") with "INTELLIGENCE" and the mark's inner ring in fixed Clint teal `#0d9488` (matching `ClintLogoComponent`), never the host brand. This is the same "platform identity is always Clint" call as the sidebar lockup (section 5). The generic `app-loader` still tints its inner ring to `var(--brand-600)`: that is functional loading UI, not a Clint signature, and should feel host-themed.

Surfaces:

- **Source import**: both progress blocks get the badge as their header (active while working) with the active step's pulsing dot replaced by a 16px `app-loader`. Step labels unchanged. This covers `import-page.component.ts` (From URL / From text extraction) and, added 2026-06-13, `nct-input/nct-input.component.ts` (the NCT-list path, which has its own parallel progress block the first cut missed).
- **Future "Ask Clint"**: panel header badge + loader while streaming. Nothing new to design when it ships.

### Whitelabel rules summary

- Loader inner ring: `var(--brand-600)` (host brand). The intelligence badge is the exception (revised 2026-06-13): it is always Clint in fixed Clint teal, since it signs Clint's own AI capability, not the host's product.
- Tenant-facing wordmarks: `appDisplayName()`, never a hard-coded "Clint" string. Platform-identity wordmarks (sidebar lockup, public footer, intelligence badge) are the inverse: always `PLATFORM_OPERATOR` ("Clint"), never the host name.
- Agency presence: "delivered by" treatment (sidebar, login foot, export footer).
- Tenant presence: login card, topbar (existing), export "prepared for".
- Boot splash: brand-neutral all-slate by design.
- The mark geometry itself is Clint's and appears on all hosts; it reads as an abstract nested-frames motif.

## Non-goals

- Topbar corner mark (rejected in brainstorm).
- Button `[loading]` icons and table/widget skeletons (separate, working patterns).
- Fixing the general PrimeNG-unlayered-CSS-vs-Tailwind-layers cascade problem. Known issue: any Tailwind utility on a PrimeNG component's `styleClass` can silently lose. Worth a dedicated pass (PrimeNG `cssLayer` option) later.
- Any brand data-model or RPC change. "Call it Clint" is the existing `app_display_name` default.
- Redesigning the PPTX cover slide.

## Testing

Each component ships with its Vitest spec in the same task (no deferred test phase):

- `loader.component.spec.ts`: renders 3 track + 3 animated polylines, stroke tiers follow `size`, caption renders from `label`, `role="status"` and aria-label fallback.
- `clint-logo` spec updated for the shared-geometry refactor (no visual change).
- `sidebar` spec: lockup branches (no agency, agency with logo, agency without logo); wordmark uses `appDisplayName`.
- `export-snapshot-host` spec: three-party footer segments, hidden-when-absent, truncation class present; existing attribution test updated.
- `pptx-export` spec: `FooterBrand` carries tenant name; footer text assembly.
- `mark-watermark` spec: renders aria-hidden mark.
- `intelligence-badge` spec: label composition from `appDisplayName`, active toggles animation class.
- `import-page` spec: badge active during extraction, loader on the active step.

Manual: exercise export dialog, filter bar, drawers, import flow, login, landing in the browser; verify reduced-motion behavior with the OS setting.

## Documentation

- `docs/design-system.md`: add loader, watermark, and intelligence badge to the primitives inventory, plus a short "Loading states" rule: skeletons preserve layout during fetch of row/table content; `app-loader` for operations and panel loads; button `[loading]` for button-scoped actions; mark animates only while something loads.
- Runbook `05-frontend-architecture.md`: only if prose drifts (shared components list).

## Known issues recorded

PrimeNG injects unlayered CSS that beats Tailwind v4 layered utilities; `styleClass` sizing on any PrimeNG component is unreliable until a `cssLayer` strategy is adopted. Out of scope here; tracked as the root cause behind the original bug.
