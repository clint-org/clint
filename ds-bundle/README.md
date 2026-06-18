# Clint Design Tokens — how to build on-brand

This is a **tokens-only** design system. Clint's production UI is Angular + PrimeNG,
which can't render in this React runtime, so there are no prebuilt components here.
What ships is Clint's complete visual language — palette, typography, and foundational
rules — as plain CSS custom properties. Build with your own React components, but
style them entirely from these tokens and they will look like Clint.

## Setup

Everything is delivered through one stylesheet. Ensure `styles.css` is loaded; it
`@import`s the full token closure (palette, semantic roles, fonts, typography,
foundations). After that, every `--*` variable resolves anywhere in the design.
No provider, no wrapper, no build step.

## The styling idiom: CSS custom properties

Style via `var(--token)`, not hard-coded hex. Always prefer a **semantic** token over a
raw scale value — it carries Clint's meaning and survives whitelabel re-theming.

| Family | Variables | Use for |
|--------|-----------|---------|
| Brand accent | `--brand-50` … `--brand-950`, `--accent`, `--accent-hover`, `--accent-wash` | hero accent, active states, primary actions |
| Neutrals | `--slate-50` … `--slate-950` | surfaces, text, borders (never a gray scale) |
| Surfaces | `--surface-page`, `--surface-card`, `--surface-header` | backgrounds |
| Text | `--text-strong`, `--text-default`, `--text-muted`, `--text-link` | type color |
| Borders | `--border-subtle`, `--border-default`, `--border-strong` | hairlines, card/field borders |
| Phase | `--phase-preclin`, `--phase-p1`, `--phase-p2`, `--phase-p3`, `--phase-p4`, `--phase-obs` | clinical-trial phase color |
| Marker | `--marker-data`, `--marker-trial`, `--marker-regulatory`, `--marker-approval`, `--marker-launch`, `--marker-loe` | event markers |
| Feedback | `--feedback-success`, `--feedback-error`, `--feedback-warn`, `--feedback-info` | status / severity |
| Type | `--font-sans`, `--font-mono`, `--text-2xs` … `--text-xl`, `--tracking-label` | typography |
| Foundations | `--radius-data` (0), `--space-1` … `--space-6`, `--focus-ring-shadow` | radius, spacing, focus |

Helper classes: `.ds-label` (small uppercase mono tracked label for section actions,
field labels, company names) and `.ds-tabular` (mono tabular figures for data columns).

## Non-negotiable rules

- **Light mode only.** No dark variant.
- **Zero radius on data/control surfaces** — `--radius-data`. Square corners.
- **Brand teal for accent, slate for neutral.** Never indigo, never a gray scale.
- **Data colors (phase / marker / feedback) are a fixed system** — never decorative,
  never invent new ones. `success` is brand teal, not green.
- Terse, factual copy. **No emoji.**

## What's in this project

```
styles.css              Entry — @imports the full token closure below.
tokens/
  palette.css           Raw scales: brand (teal), slate, and data colors.
  semantic.css          Role tokens: surfaces, text, borders, phase, marker, feedback.
  typography.css        Type scale, weights, tracking, .ds-label / .ds-tabular.
  foundations.css       Radius (0), spacing rhythm, focus, motion.
  tokens.json           Machine-readable export of every token.
fonts/
  fonts.css             System sans + mono stacks (--font-sans / --font-mono).
  fonts/README.md       Why Clint ships no web fonts.
guidelines/
  brand.md              Personality, the five principles, anti-patterns.
  color-system.md       Full phase / marker / feedback role tables.
```

## Where the truth lives

Read `styles.css` (and its `tokens/` + `fonts/` imports) for exact tokens,
`tokens/tokens.json` for the machine-readable export, and the `guidelines/` docs for
the brand rationale and the full color-role tables.
