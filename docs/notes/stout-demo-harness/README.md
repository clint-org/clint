# Stout demo harness — prod seed scripts

Seeds the live demo spaces for the Stout walkthrough (NSCLC ADC pitch story + obesity open).
Companion run sheet: `docs/notes/stout-demo-prep.md`.

## What it builds (all on PROD)
- **Boehringer Ingelheim tenant** (`bi.clintapp.com`): `Obesity Competitive Landscape` (S0) via the standard `seed_demo_data()`.
- **Pfizer tenant** (`pfizer.clintapp.com`): `NSCLC ADC — New Space` (empty import canvas), `— Pitch`, `— 3 Months In`, `— 1 Year In (Renewal)`. One NSCLC ADC dataset (ADC core + broader field), tier-sliced so each space reads as the same engagement at a later point — by **depth** (more events / intelligence / materials / detected activity), not by clock.

Density per slice (current PROD state):

| Slice | tier | companies | assets | trials | events | intel | materials | change-feed |
|-------|------|-----------|--------|--------|--------|-------|-----------|-------------|
| Pitch | 1 | 5 | 7 | 13 | 51 | 4 | 0 | 0 |
| 3 Months In | 2 | 9 | 15 | 21 | 81 | 6 | 2 | 3 |
| 1 Year In (Renewal) | 3 | 15 | 24 | 30 | 169 | 12 | 5 | 7 |

The 1-Year slice is calibrated to the obesity `seed_demo_data` feel (~165+ events, full projection-tier and date-precision variety, a populated "What changed" + "Recent materials", and a Pfizer-anchored home hero).

All content is owned/authored by aadityamadala@gmail.com; all four owner accounts are granted on every space.

## Files (current = v2)
- `seed-nsclc-lib.sql` — pure `pg_temp` helpers: `ensure_space`, `grant_members`, `mk_event` (auto actual-if `date<=asof` else the given tier), `mk_intel` (backdated version history), `mk_change` (a `trial_change_events` row → lights "What changed (7d)"), `mk_material` (a `materials` row + `material_links` → lights "Recent materials"), and `seed_nsclc_space` (the ADC core: 5 companies / 7 assets / 13 trials + 4 briefs).
- `seed-nsclc-field.sql` — `seed_nsclc_field(space, asof, tier)`: broader field (tier 2 = major franchises; tier 3 = full field). At tier ≥ 2 it adds the Jul–Sep 2026 near-term catalysts (incl. the Pfizer sigvotatug-1L home hero), light materials + detected activity. At tier 3 it adds per-trial Primary-Completion / readout / Launch / LOE / regulatory markers with projection (actual/company/primary/forecasted) + precision (exact/month/quarter/half/year) variety, corporate lifecycle (Financial/Leadership/Distribution/Strategic), fuzzy bar-ends, the full materials set, and a richer change feed.
- `wipe-reseed-v2.sql` — **the current run**. `\i` lib + field, then per slice: wipe content (keeping the space row + id stable), `seed_nsclc_space` + `seed_nsclc_field` at the slice tier, grant members. Run with `-v commit=1` to commit; default rolls back (faithful dry run). Prints a state table + the 1-Year projection/precision spread + its `[today, today+90]` upcoming window (hero check) + ring distribution.
- `seed-nsclc-lib`/`-orch`/`-prod`/`-dryrun.sql` (v1) and `fix-orphans.sql` — superseded; kept for reference.

### Why no future as-of for the renewal slice
The home page's hero, "Next 90 days", and "What changed" all key off the **browser's real today**, ignoring the seed `asof`. A future `asof` (e.g. 2027) only forces near-term markers to `actual`, killing projection-tier variety in the upcoming window. So the 1-Year slice uses `asof = 2026-06-28` (≈ today): markers before today read `actual`, markers after read their projected tier, and the depth (169 events, a year of dated briefs, materials, detected activity) is what reads as "a year in". The five trials that previously all ended `2026-06-30` (their auto Trial-End dots dominated the hero) were moved to 2027 completion dates.

## Run (PROD)
```bash
infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env prod --path /supabase -- \
  bash -c 'psql "$SUPABASE_PROD_DB_POOLER_URL" -v commit=1 -f docs/notes/stout-demo-harness/wipe-reseed-v2.sql'
```
Drop `-v commit=1` for a dry run. The `\i` paths inside `wipe-reseed-v2.sql` are repo-relative to this directory, so run from the repo root.

## Notes / gotchas baked in
- Timeline dots are `events` (no `markers` table on prod). Intelligence anchors use `entity_type='product'` for assets (events use `anchor_type='asset'`); space-level briefs anchor on the space id.
- `create_trial` auto-creates Trial Start/End dots from the phase dates — don't add explicit trial-start events. The Trial-End dot is `actual` if `phase_end_date <= current_date` (real UTC today) else `company`-projected; a future `phase_end_date` therefore lands the dot in the home "Next 90 days" window, so keep ongoing trials' end dates out of the next ~90 days unless you want them as upcoming events.
- `trial_change_events` (the "What changed" / Activity feed) only carries **trial-anchored** changes; `get_activity_feed` shows the newest by `observed_at` (the widget caps at 3). Seed rows via `mk_change` with `observed_at = now() - interval` and payload shapes from `change-event-summary.ts` (`status_changed {from,to}`, `date_moved {which_date,direction,days_diff,from,to}`, etc.).
- `materials.material_type` ∈ `briefing | priority_notice | ad_hoc | conference_report`; `material_links.entity_type` uses `product` for assets (same split as intelligence anchors). File paths are plausible-but-absent; downloads 404 cleanly.
- Version history = rows in `primary_intelligence` (no revisions table on prod); backdated via `published_at/created_at/updated_at`.
- A space cannot be cascade-deleted (an event-delete audit trigger references the space mid-cascade); delete child entities while the space still exists.
