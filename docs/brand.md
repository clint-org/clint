# Clinical Trial Dashboard -- Brand Guide

## Personality
**Precise. Authoritative. Premium.**
Clean, structured, data-dense. Inspired by medical journals, regulatory documents, and financial terminals. Feels like a serious analytical tool built by people who understand clinical data. Should convey institutional credibility -- users make high-stakes investment and partnership decisions based on what they see.

## Target Audience
Pharma executives and BD teams scanning competitive landscapes under time pressure, often reviewing dozens of trials across multiple companies. Prioritize instant visual parsing over decoration -- every pixel should earn its place.

## Emotional Goals
- **Confidence:** Users trust the data and feel certain in their reads
- **Authority:** The tool feels premium and institutionally credible
- **Efficiency:** Dense without being cluttered -- meaning is extracted in seconds, not minutes

## References
- **Bloomberg Terminal:** Data density, professional gravity, information-first
- **Evaluate Pharma / Citeline:** Pharma-domain familiarity, audience expectations
- **Linear / Notion:** Modern craft, interaction polish, typographic discipline

## Color Palette

### Primary
- **Teal** -- hero accent, active states, key UI affordances
- **Slate** -- primary neutral family (replaces generic gray)

### Phase Bar Colors
Each clinical phase has a distinct, meaningful color:
- P1 (early/exploratory): muted slate
- P2 (building evidence): cyan/teal family
- P3 (pivotal trials): teal -- the hero color, most prominent
- P4 (post-approval): violet, distinct from trial phases
- OBS (observational): amber, caution-adjacent

### Marker Colors (from seed data)
- Data events (circles): green
- Regulatory events (diamonds): red
- Approval/Launch events (flags, bars): blue
- Change/status events (arrow, x): orange, red

## Visual Hierarchy
1. **Markers** are the primary visual element -- they represent the events executives scan for. They must pop.
2. **Phase bars** are secondary context -- subtle, lower opacity, providing timeline backdrop.
3. **Company/Product grouping** provides structural navigation on the left.
4. **Legend** is a reference tool, compact and grouped by category.

## Typography
- Mono/tabular for timeline headers (data-instrument feel)
- Company names: uppercase, tracked, small -- structural labels
- Product names: medium weight, standard size
- Trial names: normal weight, readable

## UI Principles
- No decoration without function
- Tinted neutrals (slate) over pure grays
- Thin teal accent line at top of page (brand signature)
- Active nav states use teal underline
- Controls use slate-800 for active states (not indigo)
- Borders are slate-200, not gray-300
- Subtle alternating row tints, not stark zebra striping

## PrimeNG Theming

- Base preset: **Aura** (from `@primeng/themes/aura`)
- Primary palette: **Teal** (50-950) -- maps to brand hero accent
- Surface palette: **Slate** (50-950) -- maps to brand neutrals
- Dark mode: **Disabled** (`darkModeSelector: false`)
- Icons: **FontAwesome** (`@fortawesome/fontawesome-free`) for custom icons
- Theme config: `src/client/src/app/config/primeng-theme.ts`

## Design Principles
1. **Data density over decoration** -- maximize information per screen. White space is for grouping, not aesthetics.
2. **Instant visual parsing** -- markers pop, phase bars recede, structure guides the eye.
3. **Tinted neutrals, not flat grays** -- slate palette gives warmth and depth without color noise.
4. **Authority through restraint** -- premium feel comes from precision alignment, consistent spacing, and typographic discipline, not from effects or animation.
5. **Accessibility as baseline** -- WCAG 2.1 AA compliance. Keyboard navigable, screen reader friendly, sufficient contrast on all interactive and data elements.

## Anti-Patterns (Avoid)
- Generic indigo-600 as accent (use teal)
- Pure gray palette (use slate-tinted)
- Dark mode / glassmorphism / gradient text
- Overly rounded corners on data elements
- Phase bars dominating the visual space
- Flat, ungrouped legends
- Consumer dashboard aesthetics, playful SaaS patterns
- Pastel gradients, rounded-everything
