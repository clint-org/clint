# Clint — color system

Color in Clint carries meaning. There are two strictly separate roles: **brand**
(one teal accent) and **data** (a fixed semantic palette). Style against the semantic
tokens in `tokens/semantic.css`, never the raw scales, so a design inherits Clint's
meaning instead of just its hues.

## Brand vs data

- **Brand = teal (`--brand-*`).** The hero accent: active states, primary buttons, the
  thin signature line at the top of a page, the active-nav underline, selected-row
  wash. In the live app this scale is whitelabel-overridable per tenant; teal is the
  canonical Clint brand. Use `--accent`, `--accent-hover`, `--accent-wash`, `--text-link`.
- **Slate = neutral (`--slate-*`).** Surfaces, text, and borders. Borders are
  `--border-default` (slate-200), not gray-300. Never use a pure-gray scale.
- **Data colors** (green / cyan / blue / violet / amber / orange) are reserved for the
  semantic roles below and never used decoratively.

## Visual hierarchy

1. **Markers** are the primary visual element — the events users scan for. They must pop.
2. **Phase bars** are secondary context — subtle, lower opacity, a timeline backdrop.
3. **Company / product grouping** provides structural navigation.
4. **Legends** are compact reference tools, grouped by category.

## Clinical phase colors

Trial phases (`--phase-*`). PRECLIN and P1 are muted slate so the eye lands on later
phases; P3 is the hero teal; P4 violet marks the regulatory transition; OBS amber sits
caution-adjacent.

| Phase | Token | Hex | Role |
|-------|-------|-----|------|
| Preclinical | `--phase-preclin` | `#cbd5e1` | recedes behind active phases |
| Phase 1 | `--phase-p1` | `#94a3b8` | early / exploratory (muted slate) |
| Phase 2 | `--phase-p2` | `#67e8f9` | building evidence (cyan) |
| Phase 3 | `--phase-p3` | `#2dd4bf` | **pivotal — the hero color** |
| Phase 4 | `--phase-p4` | `#a78bfa` | post-approval (violet) |
| Observational | `--phase-obs` | `#fbbf24` | observational (amber) |

Development-status badges add two commercial milestones beyond the trial phases:
`--status-approved` `#8b5cf6` and `--status-launched` `#0d9488`.

## Marker colors

Markers are the foreground. Each event category has a fixed color and glyph shape.

| Category | Token | Hex | Glyph |
|----------|-------|-----|-------|
| Data (topline / interim / full) | `--marker-data` | `#16a34a` (green) | circle |
| Trial milestone (PCD / start / end) | `--marker-trial` | `#475569` (slate) | circle, dashed line |
| Regulatory (filing / submission / acceptance) | `--marker-regulatory` | `#f97316` (orange) | diamond |
| Approval | `--marker-approval` | `#3b82f6` (blue) | flag |
| Launch | `--marker-launch` | `#7c3aed` (violet) | triangle |
| Loss of exclusivity (LOE / generic entry) | `--marker-loe` | `#78350f` (amber) | square |

Filled glyph = an actual/confirmed event; outline = projected/expected.

## Feedback severity

Note `success = brand teal`, not green — green is reserved for data markers.

| Severity | Token | Use |
|----------|-------|-----|
| Success | `--feedback-success` (brand-700) | confirmations |
| Error | `--feedback-error` (red-800) | failures, invalid input |
| Warn | `--feedback-warn` (amber-800) | cautions |
| Info | `--feedback-info` (slate-700) | neutral notices |
