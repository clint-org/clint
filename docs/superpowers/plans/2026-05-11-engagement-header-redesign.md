# Engagement-landing header redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current pulse header + today brief on engagement-landing with a single three-row block: a mono identity line carrying inventory totals, an adaptive today brief that tiers across week/month/quarter, and a motion strip of five live signals (P3 readouts, catalysts, new intel, trial moves, loss of exclusivity).

**Architecture:** Extend the existing `get_space_landing_stats` RPC with five new motion counts. Refactor the engagement-landing component: replace `pulseStats` with `motionStats`, replace `briefHtml`/`briefVisible` with a structured `brief()` derived from a pure utility (`brief-window.ts`). Replace the header + standalone brief markup with a single bordered three-row block.

**Tech Stack:** Angular 19 standalone + signals + OnPush, Supabase Postgres with `has_space_access()`-gated SECURITY DEFINER RPCs, Tailwind v4 brand utilities, Vitest for unit tests, raw psql for SQL tests.

**Spec:** `docs/superpowers/specs/2026-05-11-engagement-header-redesign-design.md`

---

## Task 1: Pure utility for adaptive brief windows

**Why first:** The window-tiering logic is the most algorithmic piece. Extracting it to a pure function lets the component stay declarative and lets us unit-test all four states cheaply.

**Files:**
- Create: `src/client/src/app/features/engagement-landing/brief-window.ts`
- Create: `src/client/src/app/features/engagement-landing/brief-window.spec.ts`

- [ ] **Step 1: Write the failing spec**

Write to `src/client/src/app/features/engagement-landing/brief-window.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeBrief, BriefInput } from './brief-window';

const ANCHOR = new Date('2026-05-11T00:00:00Z'); // Mon May 11
const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => {
  const d = new Date(ANCHOR);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

const c = (
  marker_id: string,
  event_date: string,
  title = 'Catalyst',
  company_name: string | null = null
): BriefInput => ({ marker_id, event_date, title, company_name });

describe('computeBrief', () => {
  it('returns null when the input list is empty', () => {
    expect(computeBrief([], ANCHOR)).toBeNull();
  });

  it('returns null when nothing falls within 90 days', () => {
    const list = [c('m1', plusDays(91))];
    expect(computeBrief(list, ANCHOR)).toBeNull();
  });

  it('returns THIS WEEK when the nearest event is today', () => {
    const list = [c('m1', plusDays(0), 'REDEFINE-2 topline', 'Novo Nordisk')];
    const result = computeBrief(list, ANCHOR);
    expect(result).toEqual({
      window: 'THIS WEEK',
      lead: list[0],
      additional: 0,
    });
  });

  it('returns THIS WEEK on day 7 (inclusive boundary)', () => {
    const list = [c('m1', plusDays(7))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('THIS WEEK');
  });

  it('returns THIS MONTH on day 8 (just past the week boundary)', () => {
    const list = [c('m1', plusDays(8))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('THIS MONTH');
  });

  it('returns THIS MONTH on day 30 (inclusive boundary)', () => {
    const list = [c('m1', plusDays(30))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('THIS MONTH');
  });

  it('returns NEXT QUARTER on day 31', () => {
    const list = [c('m1', plusDays(31))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('NEXT QUARTER');
  });

  it('returns NEXT QUARTER on day 90 (inclusive boundary)', () => {
    const list = [c('m1', plusDays(90))];
    expect(computeBrief(list, ANCHOR)?.window).toBe('NEXT QUARTER');
  });

  it('counts additional catalysts in the same window', () => {
    const list = [c('m1', plusDays(2)), c('m2', plusDays(4)), c('m3', plusDays(6))];
    const result = computeBrief(list, ANCHOR);
    expect(result?.window).toBe('THIS WEEK');
    expect(result?.additional).toBe(2);
  });

  it('only counts additional catalysts that share the chosen window', () => {
    // First catalyst is in week; second is past the 7d window.
    const list = [c('m1', plusDays(3)), c('m2', plusDays(20))];
    const result = computeBrief(list, ANCHOR);
    expect(result?.window).toBe('THIS WEEK');
    expect(result?.additional).toBe(0);
  });

  it('skips events that already passed (date earlier than anchor)', () => {
    const list = [c('m_past', plusDays(-1)), c('m_future', plusDays(5))];
    const result = computeBrief(list, ANCHOR);
    expect(result?.lead.marker_id).toBe('m_future');
    expect(result?.additional).toBe(0);
  });
});
```

- [ ] **Step 2: Run the spec and confirm it fails**

```bash
cd src/client && npx vitest run src/app/features/engagement-landing/brief-window.spec.ts
```

Expected: `Cannot find module './brief-window'` or equivalent (file does not exist yet).

- [ ] **Step 3: Write the minimal implementation**

Write to `src/client/src/app/features/engagement-landing/brief-window.ts`:

```ts
export type BriefWindow = 'THIS WEEK' | 'THIS MONTH' | 'NEXT QUARTER';

export interface BriefInput {
  marker_id: string;
  event_date: string;
  title: string;
  company_name: string | null;
}

export interface BriefResult {
  window: BriefWindow;
  lead: BriefInput;
  additional: number;
}

const MS_PER_DAY = 86_400_000;

function daysUntil(eventDate: string, now: Date): number {
  const event = new Date(eventDate + 'T00:00:00Z').getTime();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((event - today) / MS_PER_DAY);
}

function windowDays(window: BriefWindow): number {
  if (window === 'THIS WEEK') return 7;
  if (window === 'THIS MONTH') return 30;
  return 90;
}

export function computeBrief(list: readonly BriefInput[], now: Date): BriefResult | null {
  const future = list.filter((c) => daysUntil(c.event_date, now) >= 0);
  if (future.length === 0) return null;
  const lead = future[0];
  const leadDays = daysUntil(lead.event_date, now);
  let window: BriefWindow;
  if (leadDays <= 7) window = 'THIS WEEK';
  else if (leadDays <= 30) window = 'THIS MONTH';
  else if (leadDays <= 90) window = 'NEXT QUARTER';
  else return null;
  const cap = windowDays(window);
  const sameWindow = future.filter((c) => daysUntil(c.event_date, now) <= cap);
  return { window, lead, additional: sameWindow.length - 1 };
}
```

- [ ] **Step 4: Run the spec and confirm it passes**

```bash
cd src/client && npx vitest run src/app/features/engagement-landing/brief-window.spec.ts
```

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/engagement-landing/brief-window.ts src/client/src/app/features/engagement-landing/brief-window.spec.ts
git commit -m "feat(engagement-landing): pure brief-window tiering utility

Drop-in computeBrief() that returns the nearest catalyst's window label
(THIS WEEK / THIS MONTH / NEXT QUARTER) plus a count of additional catalysts
in the same window, or null when nothing within 90 days. Pure function, no
component dependency, fully unit-tested across all boundary cases."
```

---

## Task 2: SQL migration extending the landing-stats RPC with motion counts

**Why second:** Backend contract has to exist before the service interface can carry the new fields.

**Files:**
- Create: `supabase/migrations/20260511120000_landing_stats_motion_signals.sql`
- Create: `supabase/tests/landing-stats-motion/01_motion_counts.sql`
- Create: `supabase/tests/landing-stats-motion/run.sh`

The current RPC lives in `supabase/migrations/20260501123148_engagement_landing_phase_2.sql:19-68`. The migration adds five fields: `p3_readouts_90d`, `catalysts_count_90d`, `new_intel_7d`, `trial_moves_30d`, `loe_365d`. (Note: rename `catalysts_90d` from the existing RPC to `catalysts_count_90d` so the new field reads naturally next to its siblings; the existing field stays for backward compat.)

Actually, looking at the existing RPC, `catalysts_90d` is already there and named correctly. **Do not rename.** Keep `catalysts_90d` for both the existing and new use; add the four other new fields and treat the existing `catalysts_90d` as cell #2 of the new strip.

- [ ] **Step 1: Write the failing SQL test**

Write to `supabase/tests/landing-stats-motion/01_motion_counts.sql`:

```sql
-- Tests for the five motion signals returned by get_space_landing_stats.
-- Seeds a single synthetic space with known fixtures and asserts each count.
-- Wrapped in a transaction so it rolls back cleanly.

begin;

-- Disable RLS so we can read back the RPC result without bothering with auth.
set local row_security = off;

-- Anchor everything to a fixed observation date so the test stays deterministic.
-- The RPC uses current_date for "now"; the test uses current_date + offsets.
do $$
declare
  v_space_id  uuid := gen_random_uuid();
  v_tenant_id uuid := gen_random_uuid();
  v_agency_id uuid := gen_random_uuid();
  v_company_id uuid := gen_random_uuid();
  v_product_id uuid := gen_random_uuid();
  v_trial_p3_a uuid := gen_random_uuid();
  v_trial_p3_b uuid := gen_random_uuid();
  v_trial_other uuid := gen_random_uuid();
  v_marker_p3_readout uuid := gen_random_uuid();
  v_marker_other_catalyst uuid := gen_random_uuid();
  v_marker_loe uuid := gen_random_uuid();
  v_intel_id uuid := gen_random_uuid();
  v_result jsonb;
begin
  -- Tenant + space (skip agency for brevity; space.agency_id is nullable).
  insert into public.tenants (id, name) values (v_tenant_id, 'Test Tenant');
  insert into public.spaces (id, tenant_id, name)
    values (v_space_id, v_tenant_id, 'Test Space');

  -- Company + product (asset).
  insert into public.companies (id, space_id, name)
    values (v_company_id, v_space_id, 'Test Co');
  insert into public.products (id, space_id, company_id, name)
    values (v_product_id, v_space_id, v_company_id, 'Test Product');

  -- Three trials: two Phase 3, one Phase 2.
  insert into public.trials (id, space_id, product_id, name, phase, recruitment_status)
  values
    (v_trial_p3_a, v_space_id, v_product_id, 'Trial P3 A', 'Phase 3', 'recruiting'),
    (v_trial_p3_b, v_space_id, v_product_id, 'Trial P3 B', 'Phase 3', 'recruiting'),
    (v_trial_other, v_space_id, v_product_id, 'Trial P2', 'Phase 2', 'recruiting');

  -- One P3 readout marker (Data category) within 90 days, assigned to a P3 trial.
  insert into public.markers (id, space_id, marker_type_id, event_date, title)
    values (
      v_marker_p3_readout,
      v_space_id,
      'a0000000-0000-0000-0000-000000000013', -- Topline Data (Data category)
      current_date + 30,
      'Topline readout'
    );
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_p3_readout, v_trial_p3_a);

  -- One non-P3 catalyst within 90 days (Regulatory category): counts toward
  -- catalysts_90d but NOT p3_readouts_90d.
  insert into public.markers (id, space_id, marker_type_id, event_date, title)
    values (
      v_marker_other_catalyst,
      v_space_id,
      'a0000000-0000-0000-0000-000000000018', -- PDUFA Date (Approval category)
      current_date + 14,
      'PDUFA decision'
    );
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_other_catalyst, v_trial_other);

  -- One LOE marker within 365 days (Loss of Exclusivity category).
  insert into public.markers (id, space_id, marker_type_id, event_date, title)
    values (
      v_marker_loe,
      v_space_id,
      'a0000000-0000-0000-0000-000000000020', -- LOE Date
      current_date + 200,
      'LOE expected'
    );

  -- Two trial_change_events in the last 30 days: 1 phase transition + 1 termination.
  insert into public.trial_change_events (trial_id, space_id, event_type, payload, observed_at)
  values
    (v_trial_p3_a, v_space_id, 'phase_transitioned',
      jsonb_build_object('from', 'Phase 2', 'to', 'Phase 3'),
      now() - interval '5 days'),
    (v_trial_p3_b, v_space_id, 'status_changed',
      jsonb_build_object('from', 'recruiting', 'to', 'TERMINATED'),
      now() - interval '10 days');

  -- One trial_change_event outside the 30d window: must NOT count.
  insert into public.trial_change_events (trial_id, space_id, event_type, payload, observed_at)
  values (v_trial_p3_a, v_space_id, 'phase_transitioned',
    jsonb_build_object('from', 'Phase 1', 'to', 'Phase 2'),
    now() - interval '40 days');

  -- Two published primary_intelligence rows in the last 7 days.
  insert into public.primary_intelligence
    (id, space_id, entity_type, entity_id, state, headline, thesis_md, published_at)
  values
    (gen_random_uuid(), v_space_id, 'trial', v_trial_p3_a, 'published',
     'Recent brief A', 'thesis', now() - interval '1 day'),
    (gen_random_uuid(), v_space_id, 'trial', v_trial_p3_b, 'published',
     'Recent brief B', 'thesis', now() - interval '6 days');

  -- One published older than 7 days: must NOT count.
  insert into public.primary_intelligence
    (id, space_id, entity_type, entity_id, state, headline, thesis_md, published_at)
  values
    (gen_random_uuid(), v_space_id, 'trial', v_trial_p3_a, 'published',
     'Older brief', 'thesis', now() - interval '14 days');

  -- One draft within 7 days: must NOT count.
  insert into public.primary_intelligence
    (id, space_id, entity_type, entity_id, state, headline, thesis_md)
  values
    (gen_random_uuid(), v_space_id, 'trial', v_trial_p3_a, 'draft',
     'Draft brief', 'thesis');

  -- Bypass has_space_access by calling the RPC with SECURITY DEFINER context.
  -- has_space_access returns true for postgres role; rely on that.
  v_result := public.get_space_landing_stats(v_space_id);

  raise notice 'result: %', v_result;

  assert (v_result ->> 'p3_readouts_90d')::int = 1,
    format('expected p3_readouts_90d = 1, got %s', v_result ->> 'p3_readouts_90d');
  assert (v_result ->> 'catalysts_90d')::int = 2,
    format('expected catalysts_90d = 2, got %s', v_result ->> 'catalysts_90d');
  assert (v_result ->> 'new_intel_7d')::int = 2,
    format('expected new_intel_7d = 2, got %s', v_result ->> 'new_intel_7d');
  assert (v_result ->> 'trial_moves_30d')::int = 2,
    format('expected trial_moves_30d = 2, got %s', v_result ->> 'trial_moves_30d');
  assert (v_result ->> 'loe_365d')::int = 1,
    format('expected loe_365d = 1, got %s', v_result ->> 'loe_365d');

  raise notice 'all motion-count assertions passed';
end;
$$;

rollback;
```

Write to `supabase/tests/landing-stats-motion/run.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${LANDING_STATS_DB_CONTAINER:-supabase_db_clint-v2}"
for f in "$HERE"/*.sql; do
  echo "--- $f"
  docker exec -i -e PSQLRC=/dev/null "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
echo "All landing-stats motion tests passed."
```

Make it executable: `chmod +x supabase/tests/landing-stats-motion/run.sh`.

- [ ] **Step 2: Run the test, confirm failure**

```bash
bash supabase/tests/landing-stats-motion/run.sh
```

Expected: psql assert fails on `p3_readouts_90d` (existing RPC does not return that field; `(v_result ->> 'p3_readouts_90d')` returns null; `null::int = 1` is false; assertion fails).

- [ ] **Step 3: Write the migration**

Write to `supabase/migrations/20260511120000_landing_stats_motion_signals.sql`:

```sql
-- Extends get_space_landing_stats with five motion signals consumed by the
-- redesigned engagement-landing header strip:
--   p3_readouts_90d  - data-readout markers (Data category) on Phase 3 trials
--                      with event_date in [now, now+90d].
--   new_intel_7d     - primary_intelligence rows in state=published with
--                      published_at within the last 7 days.
--   trial_moves_30d  - distinct trial_id with a phase transition or terminal
--                      status change in trial_change_events in the last 30d.
--   loe_365d         - markers in the Loss of Exclusivity category with
--                      event_date in [now, now+365d].
--
-- catalysts_90d and the three inventory counts (active_trials, companies,
-- programs) are preserved from the phase-2 RPC unchanged.
-- intelligence_total is preserved for backward compat; the new header drops
-- it but other surfaces may still reference it.
--
-- read more: docs/superpowers/specs/2026-05-11-engagement-header-redesign-design.md

create or replace function public.get_space_landing_stats(
  p_space_id uuid
) returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not public.has_space_access(p_space_id) then null
    else jsonb_build_object(
      'active_trials', (
        select count(*)::int
        from public.trials t
        where t.space_id = p_space_id
          and (
            t.recruitment_status is null
            or lower(t.recruitment_status) not in (
              'completed',
              'withdrawn',
              'terminated'
            )
          )
      ),
      'companies', (
        select count(distinct p.company_id)::int
        from public.products p
        where p.space_id = p_space_id
          and p.company_id is not null
      ),
      'programs', (
        select count(*)::int
        from public.products p
        where p.space_id = p_space_id
      ),
      'catalysts_90d', (
        select count(*)::int
        from public.markers m
        where m.space_id = p_space_id
          and m.event_date between current_date and current_date + interval '90 days'
      ),
      'intelligence_total', (
        select count(*)::int
        from public.primary_intelligence pi
        where pi.space_id = p_space_id
          and pi.state = 'published'
      ),
      'p3_readouts_90d', (
        select count(distinct m.id)::int
        from public.markers m
        join public.marker_assignments ma on ma.marker_id = m.id
        join public.trials t on t.id = ma.trial_id
        join public.marker_types mt on mt.id = m.marker_type_id
        where m.space_id = p_space_id
          and mt.category_id = 'c0000000-0000-0000-0000-000000000002'
          and t.phase = 'Phase 3'
          and m.event_date between current_date and current_date + interval '90 days'
      ),
      'new_intel_7d', (
        select count(*)::int
        from public.primary_intelligence pi
        where pi.space_id = p_space_id
          and pi.state = 'published'
          and pi.published_at >= now() - interval '7 days'
      ),
      'trial_moves_30d', (
        select count(distinct trial_id)::int
        from public.trial_change_events
        where space_id = p_space_id
          and observed_at >= now() - interval '30 days'
          and (
            event_type = 'phase_transitioned'
            or (event_type = 'status_changed'
                and payload->>'to' in ('TERMINATED','WITHDRAWN','SUSPENDED','COMPLETED'))
          )
      ),
      'loe_365d', (
        select count(distinct m.id)::int
        from public.markers m
        join public.marker_types mt on mt.id = m.marker_type_id
        where m.space_id = p_space_id
          and mt.category_id = 'c0000000-0000-0000-0000-000000000005'
          and m.event_date between current_date and current_date + interval '365 days'
      )
    )
  end;
$$;

comment on function public.get_space_landing_stats(uuid) is
  'Returns engagement-landing stats for a space. Inventory: active_trials, companies, programs. '
  'Catalyst totals: catalysts_90d, intelligence_total. Motion signals: p3_readouts_90d, '
  'new_intel_7d, trial_moves_30d, loe_365d. Gated on has_space_access.';
```

- [ ] **Step 4: Rebuild local database**

```bash
supabase db reset
```

Expected: clean reset, all migrations apply including the new one.

- [ ] **Step 5: Run the SQL test, confirm pass**

```bash
bash supabase/tests/landing-stats-motion/run.sh
```

Expected: `all motion-count assertions passed`, exit 0.

- [ ] **Step 6: Run advisors**

```bash
supabase db advisors --local --type all
```

Expected: no new warnings beyond what existed before.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260511120000_landing_stats_motion_signals.sql supabase/tests/landing-stats-motion/
git commit -m "feat(db): extend get_space_landing_stats with five motion signals

Adds p3_readouts_90d, new_intel_7d, trial_moves_30d, and loe_365d alongside
the existing inventory counts. catalysts_90d and intelligence_total are
preserved unchanged. Test fixture asserts each count against a seeded space."
```

---

## Task 3: Extend service interface

**Files:**
- Modify: `src/client/src/app/features/engagement-landing/engagement-landing.service.ts:14-28,56-70`

- [ ] **Step 1: Update `SpaceLandingStats` and `RawSpaceLandingStats`**

Replace lines 14-28 of `engagement-landing.service.ts` with:

```ts
/**
 * Stats returned by `get_space_landing_stats` (see migration
 * 20260511120000_landing_stats_motion_signals.sql). The RPC returns
 * `programs` on the wire; the service aliases it to `assets` so the frontend
 * uses the unified vocabulary.
 */
export interface SpaceLandingStats {
  active_trials: number;
  companies: number;
  assets: number;
  catalysts_90d: number;
  intelligence_total: number;
  p3_readouts_90d: number;
  new_intel_7d: number;
  trial_moves_30d: number;
  loe_365d: number;
}

interface RawSpaceLandingStats {
  active_trials: number;
  companies: number;
  programs: number;
  catalysts_90d: number;
  intelligence_total: number;
  p3_readouts_90d: number;
  new_intel_7d: number;
  trial_moves_30d: number;
  loe_365d: number;
}
```

- [ ] **Step 2: Update the mapper**

Replace lines 56-70 of `engagement-landing.service.ts` (the `getStats` body):

```ts
  async getStats(spaceId: string): Promise<SpaceLandingStats | null> {
    const { data, error } = await this.supabase.client.rpc('get_space_landing_stats', {
      p_space_id: spaceId,
    });
    if (error) throw error;
    const raw = data as RawSpaceLandingStats | null;
    if (!raw) return null;
    return {
      active_trials: raw.active_trials,
      companies: raw.companies,
      assets: raw.programs,
      catalysts_90d: raw.catalysts_90d,
      intelligence_total: raw.intelligence_total,
      p3_readouts_90d: raw.p3_readouts_90d,
      new_intel_7d: raw.new_intel_7d,
      trial_moves_30d: raw.trial_moves_30d,
      loe_365d: raw.loe_365d,
    };
  }
```

- [ ] **Step 3: Type-check**

```bash
cd src/client && npx tsc --noEmit -p tsconfig.app.json
```

Expected: no errors. (The component still imports the old fields; new fields are additive so types still compile.)

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/engagement-landing/engagement-landing.service.ts
git commit -m "feat(engagement-landing): extend SpaceLandingStats with motion fields

Adds p3_readouts_90d, new_intel_7d, trial_moves_30d, loe_365d to the typed
service contract. Mapper passes them through; existing fields unchanged."
```

---

## Task 4: Component computeds for the new three-row header

**Files:**
- Modify: `src/client/src/app/features/engagement-landing/engagement-landing.component.ts`
- Create: `src/client/src/app/features/engagement-landing/engagement-landing.component.spec.ts`

Goals for this task:
- Replace `pulseStats` with `motionStats` (the new 5 cells).
- Add `inventoryTotals` for Row 1.
- Add `engagementName` and `activeSince` computeds (replaces `eyebrowParts` and reshapes `activeSinceLabel`).
- Add a `brief` computed that wraps `computeBrief()` over `upcoming()`.
- Add a `dateAnchor` computed (replaces `todayLabel`) returning `{ day: 'MON', date: 'MAY 11' }`.
- Drop: `pulseStats`, `eyebrowParts`, `activeSinceLabel`, `briefHtml`, `briefVisible`, `catalystsThisWeek`, `todayLabel`, the `escapeHtml` helper.

- [ ] **Step 1: Write the failing component spec**

Write to `src/client/src/app/features/engagement-landing/engagement-landing.component.spec.ts`:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';
import { EngagementLandingComponent } from './engagement-landing.component';
import { EngagementLandingService, SpaceLandingStats, UpcomingCatalyst } from './engagement-landing.service';
import { DashboardService } from '../../core/services/dashboard.service';
import { SpaceService } from '../../core/services/space.service';
import { TenantService } from '../../core/services/tenant.service';
import { PrimaryIntelligenceService } from '../../core/services/primary-intelligence.service';

function makeStats(overrides: Partial<SpaceLandingStats> = {}): SpaceLandingStats {
  return {
    active_trials: 36,
    companies: 13,
    assets: 28,
    catalysts_90d: 7,
    intelligence_total: 8,
    p3_readouts_90d: 3,
    new_intel_7d: 2,
    trial_moves_30d: 1,
    loe_365d: 2,
    ...overrides,
  };
}

function setup(stats: SpaceLandingStats | null = makeStats()) {
  const route = {
    snapshot: {
      paramMap: {
        has: (k: string) => k === 'tenantId' || k === 'spaceId',
        get: (k: string) => (k === 'tenantId' ? 't1' : 's1'),
      },
      parent: null,
    },
  };
  TestBed.configureTestingModule({
    imports: [EngagementLandingComponent],
    providers: [
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { navigate: vi.fn() } },
      {
        provide: EngagementLandingService,
        useValue: { getStats: vi.fn().mockResolvedValue(stats), isAgencyMemberOfTenant: vi.fn().mockResolvedValue(false) },
      },
      { provide: DashboardService, useValue: { getDashboardData: vi.fn().mockResolvedValue({ companies: [] }) } },
      { provide: SpaceService, useValue: { getSpace: vi.fn().mockResolvedValue({ id: 's1', name: 'Test', created_at: '2026-04-01T00:00:00Z' }) } },
      { provide: TenantService, useValue: { getTenant: vi.fn().mockResolvedValue({ id: 't1', name: 'Pfizer' }) } },
      { provide: PrimaryIntelligenceService, useValue: { list: vi.fn().mockResolvedValue({ rows: [] }) } },
    ],
  });
  const fixture = TestBed.createComponent(EngagementLandingComponent);
  return fixture.componentInstance;
}

describe('EngagementLandingComponent header computeds', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('engagementName uppercases the space name', () => {
    const c = setup();
    (c as any).space.set({ id: 's1', name: 'Cardio Engagement', created_at: '2026-04-01T00:00:00Z' });
    expect(c.engagementName()).toBe('CARDIO ENGAGEMENT');
  });

  it('activeSince derives quarter from space.created_at', () => {
    const c = setup();
    (c as any).space.set({ id: 's1', name: 'Test', created_at: '2026-04-15T00:00:00Z' });
    expect(c.activeSince()).toBe('Active since 2026-Q2');
  });

  it('inventoryTotals returns the three counts from stats', () => {
    const c = setup();
    (c as any).stats.set(makeStats({ active_trials: 36, companies: 13, assets: 28 }));
    expect(c.inventoryTotals()).toEqual({ trials: 36, companies: 13, assets: 28 });
  });

  it('inventoryTotals returns null when stats are still loading', () => {
    const c = setup(null);
    (c as any).stats.set(null);
    expect(c.inventoryTotals()).toBeNull();
  });

  it('motionStats produces 5 cells in fixed order', () => {
    const c = setup();
    (c as any).stats.set(makeStats());
    const cells = c.motionStats();
    expect(cells.map((cell: any) => cell.key)).toEqual([
      'p3Readouts',
      'catalysts',
      'newIntel',
      'trialMoves',
      'loe',
    ]);
  });

  it('motionStats sets warn=true on P3 readouts, catalysts, and LOE when > 0', () => {
    const c = setup();
    (c as any).stats.set(makeStats({ p3_readouts_90d: 3, catalysts_90d: 7, loe_365d: 2, trial_moves_30d: 1, new_intel_7d: 2 }));
    const cells = c.motionStats();
    const byKey = Object.fromEntries(cells.map((cell: any) => [cell.key, cell]));
    expect(byKey['p3Readouts'].warn).toBe(true);
    expect(byKey['catalysts'].warn).toBe(true);
    expect(byKey['loe'].warn).toBe(true);
    expect(byKey['trialMoves'].warn).toBe(false);
    expect(byKey['newIntel'].warn).toBe(false);
  });

  it('motionStats clears warn on cells with zero values', () => {
    const c = setup();
    (c as any).stats.set(makeStats({ p3_readouts_90d: 0, catalysts_90d: 0, loe_365d: 0 }));
    const cells = c.motionStats();
    const byKey = Object.fromEntries(cells.map((cell: any) => [cell.key, cell]));
    expect(byKey['p3Readouts'].warn).toBe(false);
    expect(byKey['catalysts'].warn).toBe(false);
    expect(byKey['loe'].warn).toBe(false);
  });

  it('newIntel cell prefixes value with + when > 0', () => {
    const c = setup();
    (c as any).stats.set(makeStats({ new_intel_7d: 2 }));
    const cell = c.motionStats().find((s: any) => s.key === 'newIntel');
    expect(cell?.display).toBe('+2');
  });

  it('newIntel cell shows 0 (no plus) when zero', () => {
    const c = setup();
    (c as any).stats.set(makeStats({ new_intel_7d: 0 }));
    const cell = c.motionStats().find((s: any) => s.key === 'newIntel');
    expect(cell?.display).toBe('0');
  });
});
```

- [ ] **Step 2: Run the spec and confirm failures**

```bash
cd src/client && npx vitest run src/app/features/engagement-landing/engagement-landing.component.spec.ts
```

Expected: failures referencing missing `engagementName`, `activeSince`, `inventoryTotals`, `motionStats` getters on the component.

- [ ] **Step 3: Replace `pulseStats` and supporting computeds**

Edit `engagement-landing.component.ts`:

a. Add the import for `computeBrief` and types at the top of the file, near the other relative imports:

```ts
import { BriefResult, computeBrief } from './brief-window';
```

b. Replace the `Stat` interface (lines 40-46) with the new shape:

```ts
interface MotionCell {
  key: 'p3Readouts' | 'catalysts' | 'newIntel' | 'trialMoves' | 'loe';
  label: string;
  windowLabel: string;
  value: number | null;
  display: string;
  route: unknown[] | null;
  queryParams: Record<string, string> | null;
  warn: boolean;
}

interface InventoryTotals {
  trials: number;
  companies: number;
  assets: number;
}
```

c. Replace the entire `pulseStats` computed (lines 137-177) with the new `motionStats` + helpers:

```ts
  readonly motionStats = computed<MotionCell[]>(() => {
    const s = this.stats();
    const tid = this.tenantId();
    const sid = this.spaceId();
    const hasRoute = !!(tid && sid);
    const v = (n: number | undefined | null): number | null => (n == null ? null : n);
    const cells: MotionCell[] = [
      {
        key: 'p3Readouts',
        label: 'P3 readouts',
        windowLabel: 'next 90d',
        value: v(s?.p3_readouts_90d),
        display: s?.p3_readouts_90d == null ? '' : String(s.p3_readouts_90d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { phase: 'P3', within: '90d' } : null,
        warn: (s?.p3_readouts_90d ?? 0) > 0,
      },
      {
        key: 'catalysts',
        label: 'Catalysts',
        windowLabel: 'next 90d',
        value: v(s?.catalysts_90d),
        display: s?.catalysts_90d == null ? '' : String(s.catalysts_90d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { within: '90d' } : null,
        warn: (s?.catalysts_90d ?? 0) > 0,
      },
      {
        key: 'newIntel',
        label: 'New intel',
        windowLabel: 'last 7d',
        value: v(s?.new_intel_7d),
        display:
          s?.new_intel_7d == null
            ? ''
            : s.new_intel_7d > 0
              ? `+${s.new_intel_7d}`
              : '0',
        route: hasRoute ? ['/t', tid, 's', sid, 'intelligence'] : null,
        queryParams: hasRoute ? { since: '7d' } : null,
        warn: false,
      },
      {
        key: 'trialMoves',
        label: 'Trial moves',
        windowLabel: 'last 30d',
        value: v(s?.trial_moves_30d),
        display: s?.trial_moves_30d == null ? '' : String(s.trial_moves_30d),
        route: hasRoute ? ['/t', tid, 's', sid, 'activity'] : null,
        queryParams: hasRoute
          ? { eventTypes: 'phase_transitioned,status_changed', within: '30d' }
          : null,
        warn: false,
      },
      {
        key: 'loe',
        label: 'Loss of excl.',
        windowLabel: 'next 365d',
        value: v(s?.loe_365d),
        display: s?.loe_365d == null ? '' : String(s.loe_365d),
        route: hasRoute ? ['/t', tid, 's', sid, 'catalysts'] : null,
        queryParams: hasRoute ? { markerKind: 'loe', within: '365d' } : null,
        warn: (s?.loe_365d ?? 0) > 0,
      },
    ];
    return cells;
  });
```

d. Replace `eyebrowParts` and `activeSinceLabel` (lines 179-192) with:

```ts
  readonly engagementName = computed(() => this.spaceName().toUpperCase());

  readonly activeSince = computed(() => {
    const s = this.space();
    if (!s?.created_at) return '';
    const d = new Date(s.created_at);
    const year = d.getUTCFullYear();
    const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Active since ${year}-Q${quarter}`;
  });

  readonly inventoryTotals = computed<InventoryTotals | null>(() => {
    const s = this.stats();
    if (!s) return null;
    return { trials: s.active_trials, companies: s.companies, assets: s.assets };
  });
```

e. Replace `catalystsThisWeek`, `briefVisible`, `briefHtml`, `todayLabel` (lines 194-221) with the new brief shape and date anchor:

```ts
  readonly brief = computed<BriefResult | null>(() => {
    if (this.statsLoading() || this.upcomingLoading()) return null;
    const list = this.upcoming().map((c) => ({
      marker_id: c.marker_id,
      event_date: c.event_date,
      title: c.title,
      company_name: c.company_name,
    }));
    return computeBrief(list, new Date());
  });

  readonly briefVisible = computed(() => this.brief() !== null);

  readonly dateAnchor = computed(() => {
    const now = new Date();
    const day = now.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
    const date = now
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      .toUpperCase();
    return { day, date };
  });
```

f. Update the `trackStat` arrow function (line 346) so it tracks the new `MotionCell` shape:

```ts
  trackStat = (_: number, s: MotionCell): string => s.key;
```

g. Delete the `escapeHtml` helper at the bottom of the file (lines 504-511). It is no longer used.

- [ ] **Step 4: Run the spec and confirm it passes**

```bash
cd src/client && npx vitest run src/app/features/engagement-landing/
```

Expected: both `brief-window.spec.ts` and `engagement-landing.component.spec.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/engagement-landing/engagement-landing.component.ts src/client/src/app/features/engagement-landing/engagement-landing.component.spec.ts
git commit -m "feat(engagement-landing): motion-strip + structured brief computeds

Replaces pulseStats with motionStats (5 cells in fixed order, with display
strings and warn rules). Adds engagementName, activeSince, inventoryTotals,
brief, dateAnchor signals. Drops eyebrowParts, activeSinceLabel, briefHtml,
catalystsThisWeek, todayLabel, escapeHtml."
```

---

## Task 5: Replace the header template

**Files:**
- Modify: `src/client/src/app/features/engagement-landing/engagement-landing.component.html:9-108`

Replace the existing `<header>` block (lines 13-85) and the standalone today-brief block (lines 88-108) with a single three-row container.

- [ ] **Step 1: Replace lines 13-108 with the new markup**

```html
  <!-- Engagement pulse: identity, adaptive brief, motion strip -->
  <section
    class="flex flex-col border border-slate-200 bg-white"
    aria-label="Engagement summary"
  >
    <!-- Row 1: identity -->
    <div
      class="flex flex-wrap items-baseline justify-between gap-3 border-b border-slate-200 px-5 py-2.5 max-[800px]:flex-col max-[800px]:items-start max-[800px]:gap-1.5"
    >
      <div class="flex items-baseline gap-3">
        <h1
          class="m-0 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-slate-900"
        >
          {{ engagementName() || 'ENGAGEMENT' }}
        </h1>
        @if (activeSince()) {
          <span class="font-mono text-[10px] tracking-[0.08em] text-slate-400">
            {{ activeSince() }}
          </span>
        }
      </div>
      @if (inventoryTotals(); as inv) {
        <div
          class="flex items-baseline gap-3.5 font-mono text-[10px] tracking-[0.08em] tabular-nums text-slate-400"
          aria-label="Engagement inventory"
        >
          <span><b class="font-semibold text-slate-600">{{ inv.trials }}</b> trials</span>
          <span><b class="font-semibold text-slate-600">{{ inv.companies }}</b> companies</span>
          <span><b class="font-semibold text-slate-600">{{ inv.assets }}</b> assets</span>
        </div>
      }
    </div>

    <!-- Row 2: adaptive brief -->
    @if (brief(); as b) {
      <div
        class="flex items-center gap-3 border-b border-brand-200 bg-brand-50 px-5 py-2.5"
        role="status"
        aria-live="polite"
      >
        <span class="shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-slate-900">
          <span class="font-semibold text-slate-500">{{ dateAnchor().day }}</span>
          {{ dateAnchor().date }}
        </span>
        <span
          class="shrink-0 bg-brand-100 px-1.5 py-[3px] font-mono text-[9px] font-bold uppercase tracking-[0.16em] text-brand-700"
        >
          {{ b.window }}
        </span>
        <span class="flex-1 truncate text-[13px] leading-[1.45] text-slate-900">
          <b class="font-semibold">{{ b.lead.title }}</b>
          @if (b.lead.company_name) {
            <span class="text-slate-500"> · {{ b.lead.company_name }}</span>
          }
          @if (b.additional > 0) {
            <span class="text-slate-500">
              · {{ b.additional }} more catalyst{{ b.additional === 1 ? '' : 's' }} ahead
            </span>
          }
        </span>
        <a
          class="inline-flex h-6 w-6 cursor-pointer items-center justify-center text-[11px] text-brand-700 no-underline hover:text-brand-800 focus-visible:text-brand-800"
          [routerLink]="catalystsRoute()"
          [queryParams]="{ markerId: b.lead.marker_id }"
          aria-label="View catalyst"
        >
          <i class="fa-solid fa-arrow-right"></i>
        </a>
      </div>
    }

    <!-- Row 3: motion strip -->
    <ul
      class="m-0 grid list-none grid-cols-5 p-0 max-[700px]:grid-cols-3 max-[700px]:gap-y-3"
      role="list"
      aria-label="Engagement motion signals"
    >
      @for (stat of motionStats(); track trackStat($index, stat)) {
        <li
          class="flex min-w-0 flex-col justify-center border-r border-slate-100 px-[18px] py-3 last:border-r-0 max-[700px]:px-3"
          [attr.aria-busy]="stat.value === null ? true : null"
        >
          @if (stat.route && stat.value !== null) {
            <a
              class="group flex flex-col gap-1 py-1 text-inherit no-underline outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              [routerLink]="stat.route"
              [queryParams]="stat.queryParams"
              [attr.aria-label]="stat.label + ': ' + stat.value"
            >
              <span
                class="font-mono text-2xl font-semibold leading-none tracking-[-0.01em] tabular-nums"
                [class]="
                  stat.warn
                    ? 'text-amber-700 group-hover:text-amber-800 group-focus-visible:text-amber-800'
                    : (stat.key === 'newIntel' && stat.value > 0)
                      ? 'text-cyan-700 group-hover:text-cyan-800 group-focus-visible:text-cyan-800'
                      : 'text-slate-900 group-hover:text-brand-700 group-focus-visible:text-brand-700'
                "
              >{{ stat.display }}</span>
              <span class="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500 group-hover:text-brand-700 group-focus-visible:text-brand-700">
                {{ stat.label }}
              </span>
              <span class="font-mono text-[8px] uppercase tracking-[0.08em] text-slate-400">
                {{ stat.windowLabel }}
              </span>
            </a>
          } @else {
            <div class="flex flex-col gap-1 py-1">
              @if (stat.value === null) {
                <span class="font-mono text-2xl font-semibold leading-none tracking-[-0.01em] tabular-nums text-slate-900">
                  <app-skeleton w="36px" h="22px" />
                </span>
              } @else {
                <span
                  class="font-mono text-2xl font-semibold leading-none tracking-[-0.01em] tabular-nums"
                  [class]="
                    stat.warn
                      ? 'text-amber-700'
                      : (stat.key === 'newIntel' && stat.value > 0)
                        ? 'text-cyan-700'
                        : 'text-slate-900'
                  "
                >{{ stat.display }}</span>
              }
              <span class="font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {{ stat.label }}
              </span>
              <span class="font-mono text-[8px] uppercase tracking-[0.08em] text-slate-400">
                {{ stat.windowLabel }}
              </span>
            </div>
          }
        </li>
      }
    </ul>
  </section>
```

- [ ] **Step 2: Remove `NgClass` from the component imports**

Since the template now uses `[class]` bindings instead of `[ngClass]`, remove the `NgClass` import in `engagement-landing.component.ts:10` and the corresponding entry in the `imports:` array (line 69). Keep `DatePipe` and the others; they are still used by the body below the header.

- [ ] **Step 3: Lint and build**

```bash
cd src/client && npx ng lint
cd src/client && npx ng build
```

Expected: both clean. (If the lint reports any `NgClass` references in the post-header markup, restore `NgClass` to imports.)

- [ ] **Step 4: Manual smoke test**

```bash
cd src/client && npx ng serve
```

Open `http://localhost:4200/t/<tenantId>/s/<spaceId>` against a seeded engagement. Verify:

- Row 1 shows `ENGAGEMENT-NAME · Active since YYYY-Q#` left + `N trials · N companies · N assets` right.
- Row 2 appears when there is a catalyst within 90 days; shows the date anchor, the correct window pill (THIS WEEK / THIS MONTH / NEXT QUARTER), the lead title and company name, and a "+N more" suffix when applicable.
- Row 3 shows five cells in the documented order with correct counts; P3 readouts, Catalysts, and LOE cells turn amber when their counts are > 0; New intel cell shows `+N` in cyan when count > 0.
- Click each cell, confirm it routes to the documented destination (catalysts, intelligence, activity).
- Empty engagement (zero of everything): cells all show `0`, Row 1 shows zeros, Row 2 collapses entirely.

- [ ] **Step 5: AXE check**

In the browser devtools, run an AXE accessibility scan on the engagement-landing page. Confirm no new violations introduced by the new block (existing violations from elsewhere on the page may be unrelated).

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/engagement-landing/engagement-landing.component.html src/client/src/app/features/engagement-landing/engagement-landing.component.ts
git commit -m "feat(engagement-landing): three-row header markup with motion strip

Replaces the old eyebrow + h1 + subtitle + 5-stat inventory strip + standalone
today brief with a single bordered three-row block: identity row carrying
inventory totals, adaptive brief that tiers across week/month/quarter, and a
five-cell motion strip. New intel cell uses cyan to read as additive motion;
P3 readouts, catalysts, and LOE use amber when non-zero."
```

---

## Task 6: Audit and adapt destination-page query filters

**Why:** The motion-strip cells route into the catalysts, intelligence, and activity pages with query params (`?phase=P3&within=90d`, `?since=7d`, `?eventTypes=phase_transitioned,status_changed&within=30d`, `?markerKind=loe&within=365d`). If those pages don't currently honor those params, the strip is dead-end-clickable. Audit each one and patch only the ones that need patching.

This task is intentionally scoped as an audit-then-patch rather than a fixed list of changes, because the destination pages were authored separately and we should not assume their state.

- [ ] **Step 1: Audit catalysts page**

```bash
grep -nE "queryParams|queryParamMap" src/client/src/app/features/catalysts/*.ts 2>/dev/null
```

If the catalysts page already filters by `phase`, `markerKind`, and `within`, this step is done; otherwise write a small spec covering each missing filter, then add the handling.

- [ ] **Step 2: Audit intelligence page**

```bash
grep -nE "queryParams|queryParamMap" src/client/src/app/features/intelligence/*.ts 2>/dev/null
```

Add `since=7d` support if missing.

- [ ] **Step 3: Audit activity page**

```bash
grep -nE "queryParams|queryParamMap" src/client/src/app/features/activity/*.ts 2>/dev/null
```

Add `eventTypes` and `within` support if missing.

- [ ] **Step 4: For each missing filter, write a failing component spec and add minimal handling**

For each page whose audit revealed a gap, follow the existing query-param wiring pattern in that file. Two cases will likely arise:

- **`within=<N>d` on catalysts/activity pages:** the page already exposes a date-window filter signal; bind a route-effect that reads `route.queryParamMap` and calls `setWindow(N)`. Spec asserts that the rendered row set respects the window.
- **`since=<N>d` on intelligence page / `phase=P3` on catalysts / `markerKind=loe` on catalysts / `eventTypes=...` on activity:** the page may already filter on this dimension via UI controls. If a backing signal exists, just wire the query param into that signal on init. Spec asserts the filter is applied after navigation.

If the audit finds a filter that does not have a backing mechanism (e.g. `markerKind` on a catalysts page that does not yet support filtering by category), pause and discuss with the spec owner before extending scope. Do not silently invent new filtering surfaces inside this task.

- [ ] **Step 6: End-to-end click-through**

Restart dev server and click each of the five motion cells. Verify the destination page lands with the right filter applied.

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/features/catalysts/ src/client/src/app/features/intelligence/ src/client/src/app/features/activity/
git commit -m "feat(activity,intelligence,catalysts): support motion-strip cell filters

Adds query-param filtering needed by the engagement-landing motion cells:
catalysts (phase, markerKind, within), intelligence (since), activity
(eventTypes, within). Each new filter is paired with a unit spec."
```

If all three pages already supported their respective filters, this task is a no-op and no commit is created.

---

## Task 7: End-to-end verification

**Files:** none modified; this is the sign-off pass.

- [ ] **Step 1: Full lint + build**

```bash
cd src/client && npm run lint && npx ng build
```

Expected: clean.

- [ ] **Step 2: Full unit suite**

```bash
cd src/client && npm run test:units
```

Expected: all green, including the two new specs.

- [ ] **Step 3: Re-run SQL test**

```bash
bash supabase/tests/landing-stats-motion/run.sh
```

Expected: pass.

- [ ] **Step 4: Re-run advisors**

```bash
supabase db advisors --local --type all
```

Expected: no new warnings.

- [ ] **Step 5: Final manual smoke**

In a browser, visit at least two seeded engagements that differ in catalyst density (one with catalysts in next 7d, one with none in 90d) and confirm both render correctly.

- [ ] **Step 6: Update runbook**

The header redesign touches `engagement-landing.component.{ts,html}`, `engagement-landing.service.ts`, and `get_space_landing_stats`. Per `CLAUDE.md`, regenerate the autogen blocks and patch any hand-written prose that referenced the old pulse strip:

```bash
cd src/client && npm run docs:arch
```

Review `docs/runbook/05-frontend-architecture.md`, `docs/runbook/06-backend-architecture.md`, and `docs/runbook/03-features.md` for hand-written prose mentioning the old pulse header. Update those paragraphs in place.

- [ ] **Step 7: Commit any runbook diffs**

```bash
git add docs/runbook/
git commit -m "docs(runbook): regenerate after engagement-landing header redesign"
```

- [ ] **Step 8: Push**

```bash
git push
```
