# design-sync notes

## Scope decision (2026-06-17): tokens-only, no components

Clint's app UI is **Angular 21 + PrimeNG + Tailwind v4**. claude.ai/design renders
**React** components, so Clint's components cannot be synced as a component library —
the converter's `_ds_bundle.js`/`.jsx` path does not apply. The user chose to sync
**design tokens only** so the design agent's React designs match Clint's palette and
typography.

This is therefore an **off-script** sync: the `ds-bundle/` layout is hand-authored, not
produced by `package-build.mjs`. There are no components, no `_ds_bundle.js`, no
previews to grade.

## Project

- Name: **Clint Design Tokens**
- projectId: `950b3ea6-ecb3-4046-9f0a-9f3cb2543ebd`
- URL: https://claude.ai/design/p/950b3ea6-ecb3-4046-9f0a-9f3cb2543ebd

## Token sources of truth (re-derive the bundle from these on re-sync)

| Token group | Source file |
|-------------|-------------|
| Brand (teal) scale | `src/client/src/styles.css` `@theme`; `src/client/src/app/config/primeng-theme.ts` `TEAL_SCALE` |
| Slate surface scale, radius=0, semantic UI mappings | `src/client/src/app/config/primeng-theme.ts` |
| Phase + development-status colors | `src/client/src/app/core/models/phase-colors.ts` |
| Marker colors (data/trial/regulatory/approval/launch/LOE) | `supabase/seed.sql` (`marker_types`) + `docs/brand.md` |
| Rules, personality, anti-patterns | `docs/brand.md`, `docs/design-system.md` |

Note: the brand teal scale is **whitelabel-overridable** in the live app
(`--brand-*: var(--brand-*, <teal>)`); teal is baked in as canonical Clint. Data colors
never shift with whitelabel.

## Re-sync mechanics

- `ds-bundle/_ds_sync.json` carries per-file sha256 under `sourceHashes` (shape
  `tokens`). A re-sync recomputes hashes over the rebuilt `ds-bundle/` and uploads only
  changed files, deletes orphans, writes `_ds_sync.json` last.
- Upload path: the project is pinned in `config.json`, so a re-sync takes the **atomic
  path** (update in one pass at the end).
- Conventions header lives at `.design-sync/conventions.md` (`readmeHeader`). It is
  human-editable — on re-sync, re-validate the names it lists against the rebuilt CSS,
  do not rewrite it.

## If Clint ever ships a real React component library

Switch `shape` back to `package` (or `storybook`) and run the normal converter against
that package's `dist/`; this tokens-only layout would then be superseded.
