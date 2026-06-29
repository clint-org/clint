# Event glyph + color system: corporate family and a documented allocation rule

Date: 2026-06-29
Status: design, pending implementation

## Problem

The event-model overhaul added four corporate/business event categories (Commercial,
Leadership, Financial, Strategic) without extending the visual system to cover them:

- **Leadership Change, Financial, and Strategic are identical slate circles** -- they
  cannot be told apart, and slate already means "trial milestone," so they collide with
  clinical events.
- **Distribution** uses teal, which collides with the brand hero color and the P2/P3
  phase-bar teal, and teal was never added to the documented color rule.
- The **editorial color rule** (the `markers-help` page), **`brand.md`**, and
  **`design-system.md`** still document only the original six clinical roles. The four
  corporate categories were never given a color/glyph convention anywhere.

There was also no documented rule for *how* a glyph is allocated (what shape vs color vs
inner-mark each encode), so future event types have nothing to slot into.

## Capacity analysis (why the design is shaped this way)

Usable mark colors after the clinical lifecycle: essentially **one** (rose) -- green,
slate, orange, blue, violet, amber are spent on Data/Trial/Regulatory/Approval/Launch/LOE,
and teal is reserved for the brand + phase bars. Free shapes: **one** (hexagon). So the
business axis cannot get a color per category; it has to be a **single color family**,
differentiated internally by shape + inner-mark. The "one corporate family" decision is
forced by the palette, not a preference.

## The allocation rule (documented in `brand.md` + the Event-glyphs help page)

- **Color = the family / editorial role.** green=Data, slate=Trial milestones,
  orange=Regulatory, blue=Approval, violet=Launch & commercial, amber=Loss of exclusivity,
  **rose=Corporate** (new).
- **Shape = the family's signature glyph.** circle=Data/clinical, diamond=Regulatory,
  flag=Approval, triangle=Launch, square=LOE, dashed-line=Trial Start/End,
  **hexagon=commercial/corporate** (violet hexagon = commercial availability;
  rose hexagon = corporate).
- **Inner-mark = the specific type within a family.** Caps at the five marks
  (none/dot/dash/check/x); beyond that, analyst-added custom types use their own glyph.

Teal stays exclusively the brand + phase-bar color and is never a mark color.

## Taxonomy change

Restructure the corporate categories (Option B -- Distribution is *commercial lifecycle*,
the rest are *company governance*):

| Before (category -> type) | After |
| --- | --- |
| Commercial -> Distribution (teal hexagon) | **Commercial** -> Distribution (**violet** hexagon) |
| Leadership -> Leadership Change (slate circle) | **Corporate** (rose) -> Leadership Change (**rose hexagon**, no mark) |
| Financial -> Financial (slate circle) | **Corporate** -> Financial (**rose hexagon** - dot) |
| Strategic -> Strategic (slate circle) | **Corporate** -> Strategic (**rose hexagon** - dash) |

- Three categories (Leadership, Financial, Strategic) collapse into one new **Corporate**
  category, color rose-700 `#be123c`.
- The existing **Commercial** category is kept but recolored teal -> violet `#7c3aed`
  (commercial availability sits with Launch in the violet commercialization family); its
  one type, Distribution, keeps the hexagon shape.
- Corporate governance types are rose hexagons differentiated by inner-mark:
  Leadership Change (none), Financial (dot), Strategic (dash). Headroom: check, x, then
  extend inner-marks.
- Significance is unchanged: corporate events stay low-significance (feed-only unless
  pinned). The crisp glyphs only make them legible where they do appear.
- Type **ids are preserved** (we `UPDATE` shape/color/inner_mark/category_id, not recreate),
  so existing events and `seed_demo` references stay valid.

## Surfaces

1. **Migration** (Stage 3 lane 0400xx, system-row data change; respects the D2
   unique-name + system partial-index constraints; remote-safe smoke):
   - Insert the `Corporate` event_type_category (rose, system, ordered).
   - Re-parent Leadership Change / Financial / Strategic to Corporate; set
     `shape='hexagon'`, `color='#be123c'`, `inner_mark` in (`none`,`dot`,`dash`).
   - Recolor the Distribution type to `color='#7c3aed'` (keep `shape='hexagon'`). Color
     lives only on `event_types` -- `event_type_categories` has no color column -- so there
     is no category-level color change; the Commercial category simply keeps Distribution.
   - Delete the now-empty Leadership / Financial / Strategic categories.
   - `notify pgrst, 'reload schema'` not required (no signature change), but harmless.
2. **`hexagon-icon.component`**: add `dash` and `x` inner-mark rendering (it already
   renders `dot` and `check`). No new shape primitive -- `hexagon` already exists in the
   `MarkerShape` enum, the DB check constraint, and every glyph `@switch`.
3. **Docs**:
   - `markers-help` editorial `colorRules`: add the **Rose = Corporate** row; reword
     **Violet** to "Commercial launch & availability"; add the allocation rule note.
     Add `MARKER_DEFINITIONS` entries for Leadership Change / Financial / Strategic /
     Distribution.
   - `brand.md` "Marker Colors": add the rose Corporate row + the allocation rule; note
     teal is reserved for brand/phase only.
   - `design-system.md`: add the allocation rule if it documents mark colors.
4. **Seed** (`_seed_demo_*`): unaffected -- references type ids, which are preserved. No
   producer edit; coordinate via the board only if the seed stream is active.
5. **Deck**: recapture the legend/glyph shots after this lands so they show the final
   rose Corporate family. (Deck recapture is paused on this.)

## Testing

- The existing `glyph-shape-coverage` guard auto-covers the change (no new shape; it reads
  the `MarkerShape` enum and asserts every shape renders in all glyph surfaces).
- Add a focused unit test for the hexagon icon's new `dash` / `x` inner-marks (mirrors the
  circle/square inner-mark coverage), if a per-icon spec pattern exists; otherwise assert
  via `marker-visual` / the legend coverage.
- Migration: in-migration smoke asserts the four types resolve to the expected
  shape/color/inner_mark/category after the change; run `db reset` + `advisors` +
  `features:check` + `migrations:check-redefs` + the integration suite (under a DB-TAKE).
- a11y/visual: confirm on dev that the timeline legend, Event-glyphs help, and Taxonomies
  Event Types tab render the rose hexagons with distinct inner-marks and the violet
  Distribution.

## Out of scope

- No new shape primitive (hexagon already exists).
- No change to clinical-lifecycle glyphs beyond Distribution's recolor.
- Extending the inner-mark vocabulary (ring/plus/bar) for >5 corporate system types is a
  later follow-up, only if the governance family grows past five.
