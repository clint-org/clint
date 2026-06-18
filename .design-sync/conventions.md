# Clint Design Tokens — how to build on-brand

This is a **tokens-only** design system. Clint's production UI is Angular + PrimeNG,
which can't render in this React runtime, so there are no prebuilt components here.
What ships is Clint's complete visual language — palette, typography, and foundational
rules — as plain CSS custom properties. Build with your own React components, but
style them entirely from these tokens and they will look like Clint.

## Setup

Everything is delivered through one stylesheet. Ensure `styles.css` is loaded; it
`@import`s the full token closure (palette, semantic roles, fonts, typography,
foundations). After that, every `--*` variable below resolves anywhere in the design.
No provider, no wrapper, no build step.

## The styling idiom: CSS custom properties

Style via `var(--token)`, not hard-coded hex. Always prefer a **semantic** token over a
raw scale value — it carries Clint's meaning and survives whitelabel re-theming.

Core families (all defined in the bound `styles.css` import closure):

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

Two structural-label helper classes are also provided: `.ds-label` (the small
uppercase, mono, tracked label Clint uses for section actions, field labels, and
company names) and `.ds-tabular` (mono tabular figures for data columns).

## Non-negotiable rules

- **Light mode only.** No dark variant exists or should be added.
- **Zero radius on data/control surfaces** — use `--radius-data`. Square corners on
  buttons, inputs, dialogs, tables, badges.
- **Brand teal for accent, slate for neutral.** Never indigo, never a gray scale.
- **Data colors (phase / marker / feedback) are a fixed system** — never decorative,
  never invent new ones. `success` is brand teal, not green (green means data markers).
- Terse, factual copy. **No emoji.**

## Where the truth lives

Read these bound files before styling: `styles.css` (and its imports under `tokens/`
and `fonts/`) for the exact tokens; `tokens/tokens.json` for a machine-readable export;
`guidelines/brand.md` for personality and anti-patterns; `guidelines/color-system.md`
for the full phase/marker/feedback role tables.

## One idiomatic snippet

```css
/* A Clint data card: square corners, slate border, brand accent line, mono label. */
.card {
  background: var(--surface-card);
  border: 1px solid var(--border-default);
  border-top: 2px solid var(--accent);   /* thin teal signature line */
  border-radius: var(--radius-data);      /* 0 */
  padding: var(--space-4);
  color: var(--text-default);
}
.card__label {                            /* same as .ds-label */
  font-family: var(--font-mono);
  font-size: var(--text-2xs);
  font-weight: 700;
  letter-spacing: var(--tracking-label);
  text-transform: uppercase;
  color: var(--text-link);
}
.card__value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-strong);
}
```
