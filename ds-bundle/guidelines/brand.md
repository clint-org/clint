# Clint — brand & design principles

**Competitive intelligence for pharma.** Clint covers pipeline intelligence,
catalyst tracking, clinical-trial timelines, and portfolio analysis. Its users are
pharma CI professionals (plus business development, strategy, portfolio, licensing,
and executive leadership) who scan dozens of trials, catalysts, and pipelines under
time pressure and make high-stakes investment and partnership calls on what they see.
The tool sits alongside Bloomberg Terminal, Evaluate Pharma, and Citeline.

## Personality: precise, authoritative, premium

Design like a serious analytical instrument built by people who understand clinical
data — closer to a medical journal or a regulatory document than a consumer SaaS app.
The emotional goals are confidence in the data, institutional authority, and
efficiency without clutter. Voice is terse and factual: no playfulness, no
cheerleading, **no emoji**.

References to aim for: **Bloomberg Terminal** (data density, gravity),
**Evaluate Pharma / Citeline** (domain familiarity), **Linear / Notion** (modern
craft, interaction polish, typographic discipline).

## The five principles

1. **Data density over decoration.** Maximize information per screen. If a pixel
   doesn't carry meaning or grouping, remove it. White space groups; it does not
   decorate.
2. **Instant visual parsing.** Markers pop, phase bars recede into the backdrop,
   company/asset grouping structures the layout. The eye should land on the answer,
   not hunt for it.
3. **Tinted neutrals, not flat grays.** Slate gives warmth and depth without color
   noise. Never reach for a generic gray scale.
4. **Authority through restraint.** Premium feel comes from precision alignment,
   consistent spacing, and typographic discipline — not from effects, gradients, or
   animation. Motion is purposeful and small.
5. **Accessibility as baseline.** WCAG 2.1 AA is a hard floor, not polish. Keyboard
   navigable with visible focus, semantic HTML, sufficient contrast on both
   interactive elements and data marks.

## Hard rules

- **Light mode only.** Dark mode is explicitly disabled. Never add a dark variant.
- **Zero border radius on data and control surfaces.** Buttons, inputs, dialogs,
  tables, and badges have square corners.
- **Brand teal for accents; slate for neutrals.** Use the `--brand-*` scale for the
  hero accent and active states, `--slate-*` for surfaces, text, and borders.
- **Data colors are a fixed semantic system** (phase, marker, status). Never repurpose
  them as decorative accents, and never invent new phase or marker colors.

## Anti-patterns — never look like

Consumer SaaS dashboards, playful startup aesthetics, generic indigo-600 accents,
pure grays, dark mode, glassmorphism, gradient text, pastel gradients,
rounded-everything, decorative illustrations, emoji. Phase bars must never dominate
the visual space; markers are the foreground.
