# Unified Intelligence Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/intelligence` render one curated stream of published intelligence briefs and all events interleaved by recency, with a Kind toggle + event-category chips, no significance gating.

**Architecture:** A new SECURITY INVOKER RPC `list_intelligence_feed` UNIONs the published-brief leg (the `list_primary_intelligence` base) with an all-events leg into a unified jsonb row carrying a `kind` discriminator, sorted by `feed_ts desc` (briefs = `updated_at`, events = `created_at`). A new `IntelligenceFeedService` + discriminated-union model feed a kind-switching `IntelligenceFeedComponent`; the `/intelligence` page swaps its data source and gains the Kind toggle + chips and a read-only event detail drawer (`app-marker-detail-panel`).

**Tech Stack:** Postgres/Supabase (plpgsql, RLS), Angular 19 standalone + signals + PrimeNG 21, Vitest (units + integration), Playwright (e2e/visual).

## Global Constraints

- Branch `feat/unified-intelligence-feed` off `origin/develop`, worktree `.worktrees/unified-intelligence-feed`; node_modules symlinked. All paths below are relative to that worktree.
- Shared local Docker Postgres across worktrees. Before any `supabase db reset` / `npm run test:integration`: append a `DB-TAKE` block to `~/.clint-coordination/inbox.md`, check the tail for an open `DB-TAKE` with no later `DB-RELEASE`, wait if held; append `DB-RELEASE` after. (At plan time `fix/event-edit-save-source-url` held the token.)
- Migration lane: `20260629130000` is taken by an unmerged branch. Use `20260629160000`.
- New RPC is SECURITY INVOKER + `set search_path = ''`, relies on RLS, granted to `authenticated`, revoked from `public`/`anon`. End the migration with `notify pgrst, 'reload schema';`. In-migration smoke must be remote-safe: read tables directly, wrap any guard-sensitive call in `exception when insufficient_privilege then null`.
- No em dashes or emoji in any code, comment, copy, or doc. Count unit is "entry". Vocabulary: brief = Intelligence, event = Event; the page is the Intelligence feed.
- Angular: standalone, OnPush, `inject()`, `input()`/`output()`/`model()`, signals + `computed()`, native control flow (`@if`/`@for`/`@switch`), `class`/`style` bindings, PrimeNG for controls, `pTooltip` (never `title=`), `bg-brand-*` not `bg-teal-*`. Any plain prop bound via `[(ngModel)]` that feeds a `computed()` must be a signal.
- Do NOT push to develop. When gate-green, post a `READY` block to the inbox and tell the user to verify + merge. Pre-push e2e is flaky; verify real suites, push `--no-verify` if the hook flakes.
- Unit tests: `cd src/client && npm run test:units`. Integration: `npm run test:integration` (needs `SUPABASE_SERVICE_ROLE_KEY` from `supabase status`). Lint/build: `cd src/client && ng lint && ng build`.

---

### Task 1: Integration test for `list_intelligence_feed` (RED first)

Written before the migration (TDD). It cannot run green until Task 2's migration is applied via `db reset`; both verify together in Task 2's DB step. The test seeds its own space with one published brief and three events at controlled timestamps.

**Files:**
- Create: `src/client/integration/tests/intelligence-feed-rpc.integration.spec.ts`
- Reference harness: `src/client/integration/fixtures/personas.ts` (`adminClient`, `buildPersonas`, `Personas`), `src/client/integration/harness/as.ts` (`as`, `expectOk`), and `src/client/integration/tests/event-read-rpcs.integration.spec.ts` for the seeding pattern and stable system `event_type` UUIDs.

**Interfaces:**
- Consumes: the RPC `list_intelligence_feed(p_space_id, p_kinds, p_categories, p_since, p_query, p_limit, p_offset)` returning jsonb `{ rows, total, limit, offset }` (defined in Task 2).
- Produces: nothing downstream (test only).

- [ ] **Step 1: Write the failing integration test**

```ts
/**
 * list_intelligence_feed: the merged Intelligence-feed RPC.
 *
 * Proves the unified briefs+events stream: feed_ts-desc interleave (briefs by
 * updated_at, events by created_at), NO significance/visibility gating, the
 * kind/category/since/query filters, pagination + total, and RLS scoping.
 *
 * Seeds its own space (not the shared QA fixture) so the timestamps that drive
 * the interleave assertion are controlled.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { adminClient, buildPersonas, Personas } from '../fixtures/personas';
import { as, expectOk } from '../harness/as';

const ET_TOPLINE = 'a0000000-0000-0000-0000-000000000013'; // Clinical-family, high
const ET_LEADERSHIP = 'a0000000-0000-0000-0000-000000000050'; // Leadership, low
const ET_LOE = 'a0000000-0000-0000-0000-000000000020'; // LOE, high

interface FeedRow {
  kind: 'brief' | 'event';
  id: string;
  feed_ts: string;
  title: string;
  entity_type: string | null;
  category_name?: string;
  significance?: string | null;
  visibility?: string | null;
}
interface FeedResult { rows: FeedRow[]; total: number; limit: number; offset: number }

let p: Personas;
let spaceId: string;
let companyId: string;
let briefId: string;

beforeAll(async () => {
  p = await buildPersonas();
  spaceId = p.spaceId;

  // a company to anchor company-level events
  const co = await adminClient
    .from('companies')
    .insert({ space_id: spaceId, name: 'FeedCo' })
    .select('id')
    .single();
  expectOk(co);
  companyId = co.data!.id;

  // one published brief, updated_at = 2026-03-10
  const anchor = await adminClient
    .from('primary_intelligence_anchors')
    .insert({ space_id: spaceId, entity_type: 'company', entity_id: companyId, is_lead: true, display_order: 0 })
    .select('id')
    .single();
  expectOk(anchor);
  const brief = await adminClient
    .from('primary_intelligence')
    .insert({
      space_id: spaceId,
      anchor_id: anchor.data!.id,
      state: 'published',
      headline: 'FeedCo competitive read',
      summary_md: 'Body about FeedCo.',
      implications_md: 'x',
      watch_md: 'x',
      last_edited_by: p.ownerId,
      version_number: 1,
      published_at: '2026-03-10T12:00:00Z',
      updated_at: '2026-03-10T12:00:00Z',
    })
    .select('id')
    .single();
  expectOk(brief);
  briefId = brief.data!.id;

  // three events. created_at controls feed order; event_date is unrelated.
  // - leadership (LOW significance), created 2026-03-12  -> must still appear (no gating)
  // - LOE (HIGH) but visibility='hidden', created 2026-03-08 -> must still appear (no gating)
  // - topline clinical (HIGH) anchored to company, created 2026-03-05
  const rows = [
    { event_type_id: ET_LEADERSHIP, title: 'CEO comment', event_date: '2026-01-15', created_at: '2026-03-12T09:00:00Z', visibility: null },
    { event_type_id: ET_LOE, title: 'Hidden LOE', event_date: '2030-06-01', created_at: '2026-03-08T09:00:00Z', visibility: 'hidden' },
    { event_type_id: ET_TOPLINE, title: 'Topline readout', event_date: '2026-09-01', created_at: '2026-03-05T09:00:00Z', visibility: null },
  ];
  for (const r of rows) {
    const ins = await adminClient.from('events').insert({
      space_id: spaceId,
      event_type_id: r.event_type_id,
      title: r.title,
      event_date: r.event_date,
      anchor_type: 'company',
      anchor_id: companyId,
      visibility: r.visibility,
      projection: 'actual',
      created_by: p.ownerId,
      created_at: r.created_at,
    }).select('id').single();
    expectOk(ins);
  }
});

async function feed(args: Record<string, unknown>): Promise<FeedResult> {
  const res = await as(p.owner).rpc('list_intelligence_feed', {
    p_space_id: spaceId, p_kinds: null, p_categories: null,
    p_since: null, p_query: null, p_limit: 25, p_offset: 0, ...args,
  });
  expectOk(res);
  return res.data as FeedResult;
}

describe('list_intelligence_feed', () => {
  it('interleaves briefs (updated_at) and events (created_at) feed_ts-desc', async () => {
    const r = await feed({});
    expect(r.total).toBe(4);
    // order by feed_ts desc: leadership(03-12), brief(03-10), hiddenLOE(03-08), topline(03-05)
    expect(r.rows.map((x) => x.title)).toEqual([
      'CEO comment', 'FeedCo competitive read', 'Hidden LOE', 'Topline readout',
    ]);
    expect(r.rows.map((x) => x.kind)).toEqual(['event', 'brief', 'event', 'event']);
  });

  it('does NOT gate on significance or visibility (low-sig + hidden both appear)', async () => {
    const r = await feed({ p_kinds: ['event'] });
    const titles = r.rows.map((x) => x.title);
    expect(titles).toContain('CEO comment'); // low significance
    expect(titles).toContain('Hidden LOE'); // visibility = hidden
    expect(r.total).toBe(3);
  });

  it('p_kinds filters legs', async () => {
    expect((await feed({ p_kinds: ['brief'] })).total).toBe(1);
    expect((await feed({ p_kinds: ['event'] })).total).toBe(3);
  });

  it('p_categories filters the event leg only; briefs unaffected', async () => {
    const r = await feed({ p_categories: ['Leadership'] });
    // 1 leadership event + the 1 brief (briefs have no category, so they pass)
    expect(r.total).toBe(2);
    expect(r.rows.filter((x) => x.kind === 'event').map((x) => x.title)).toEqual(['CEO comment']);
    expect(r.rows.some((x) => x.kind === 'brief')).toBe(true);
  });

  it('p_query matches brief headline/summary OR event title/description', async () => {
    expect((await feed({ p_query: 'topline' })).total).toBe(1);
    expect((await feed({ p_query: 'feedco' })).total).toBe(1); // brief headline
  });

  it('p_since filters on feed_ts across both kinds', async () => {
    const r = await feed({ p_since: '2026-03-09T00:00:00Z' });
    // leadership(03-12) + brief(03-10) only
    expect(r.total).toBe(2);
  });

  it('paginates with a stable total', async () => {
    const page1 = await feed({ p_limit: 2, p_offset: 0 });
    const page2 = await feed({ p_limit: 2, p_offset: 2 });
    expect(page1.total).toBe(4);
    expect(page1.rows).toHaveLength(2);
    expect(page2.rows).toHaveLength(2);
    expect(page1.rows[0].title).toBe('CEO comment');
    expect(page2.rows[0].title).toBe('Hidden LOE');
  });

  it('RLS: a non-member sees nothing', async () => {
    const r = await as(p.outsider).rpc('list_intelligence_feed', {
      p_space_id: spaceId, p_kinds: null, p_categories: null,
      p_since: null, p_query: null, p_limit: 25, p_offset: 0,
    });
    expectOk(r);
    expect((r.data as FeedResult).total).toBe(0);
  });
});
```

- [ ] **Step 2: Confirm the test references real personas fields**

Run: `grep -nE "ownerId|outsider|spaceId|owner\b" src/client/integration/fixtures/personas.ts`
Expected: `buildPersonas()` exposes `spaceId`, `ownerId`, `owner`, `outsider`. If the field names differ (e.g. `viewer`/`stranger`), adjust the test to the real names before running. Do not invent fields.

- [ ] **Step 3: Commit the RED test**

```bash
git add src/client/integration/tests/intelligence-feed-rpc.integration.spec.ts
git commit -m "test(intelligence): RED integration spec for list_intelligence_feed"
```

---

### Task 2: `list_intelligence_feed` migration (RPC + grant + smoke)

**Files:**
- Create: `supabase/migrations/20260629160000_list_intelligence_feed.sql`

**Interfaces:**
- Consumes: tables `primary_intelligence`, `primary_intelligence_anchors`, `primary_intelligence_links`, `events`, `event_types`, `event_type_categories`, `companies`, `assets`, `trials`.
- Produces: `list_intelligence_feed(uuid, text[], text[], timestamptz, text, int, int) returns jsonb` with envelope `{ rows, total, limit, offset }` and per-row keys listed in the spec. Consumed by Task 4 (`IntelligenceFeedService`) and Task 1 (integration test).

- [ ] **Step 1: Write the migration**

```sql
-- list_intelligence_feed: the one curated stream for /intelligence.
--
-- Merges published intelligence briefs (the list_primary_intelligence base) with
-- ALL events into one recency-ordered feed. Unlike the timeline, the feed is NOT
-- significance/visibility gated: every event appears. Sort key feed_ts is the
-- brief's updated_at and the event's created_at (when each entered the stream);
-- event_date is carried for display but is never the sort key, so future-dated
-- projections do not jump the feed.
--
-- SECURITY INVOKER + RLS (mirrors list_primary_intelligence): the select policies
-- on primary_intelligence and events do the space scoping. No has_space_access in
-- the body, so the in-migration smoke is remote-safe.

create or replace function public.list_intelligence_feed(
  p_space_id   uuid,
  p_kinds      text[]      default null,  -- subset of {'brief','event'}; null = both
  p_categories text[]      default null,  -- event category NAMES; null = all; event leg only
  p_since      timestamptz default null,  -- on feed_ts
  p_query      text        default null,  -- brief headline/summary OR event title/description
  p_limit      int         default 25,
  p_offset     int         default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_query_pattern text;
begin
  v_query_pattern := case
    when p_query is null or length(trim(p_query)) = 0 then null
    else '%' || lower(trim(p_query)) || '%'
  end;

  with brief_rows as (
    select
      p.updated_at as feed_ts,
      jsonb_build_object(
        'kind', 'brief',
        'id', p.id,
        'space_id', p.space_id,
        'feed_ts', p.updated_at,
        'title', p.headline,
        'entity_type', a.entity_type,
        'entity_id', a.entity_id,
        'entity_name', null,
        'anchor_id', p.anchor_id,
        'is_lead', a.is_lead,
        'summary_md', p.summary_md,
        'last_edited_by', p.last_edited_by,
        'state', p.state,
        'links', coalesce((
          select jsonb_agg(jsonb_build_object(
            'entity_type', l.entity_type,
            'entity_id', l.entity_id,
            'relationship_type', l.relationship_type,
            'gloss', l.gloss
          ) order by l.display_order, l.created_at)
          from public.primary_intelligence_links l
          where l.primary_intelligence_id = p.id
        ), '[]'::jsonb),
        'contributors', case
          when p.last_edited_by is null then '[]'::jsonb
          else jsonb_build_array(p.last_edited_by)
        end
      ) as row
    from public.primary_intelligence p
    join public.primary_intelligence_anchors a on a.id = p.anchor_id
    where p.space_id = p_space_id
      and a.space_id = p_space_id
      and p.state = 'published'
      and (p_kinds is null or 'brief' = any(p_kinds))
      and (p_since is null or p.updated_at >= p_since)
      and (
        v_query_pattern is null
        or lower(p.headline) like v_query_pattern
        or lower(p.summary_md) like v_query_pattern
      )
  ),
  event_rows as (
    select
      e.created_at as feed_ts,
      jsonb_build_object(
        'kind', 'event',
        'id', e.id,
        'space_id', e.space_id,
        'feed_ts', e.created_at,
        'title', e.title,
        -- anchor_type 'asset' maps to the client entity_type 'product'
        'entity_type', case e.anchor_type when 'asset' then 'product' else e.anchor_type end,
        'entity_id', e.anchor_id,
        'entity_name', coalesce(co.name, a.name, t.name),
        'event_date', e.event_date,
        'date_precision', e.date_precision,
        'end_date', e.end_date,
        'end_date_precision', e.end_date_precision,
        'is_ongoing', e.is_ongoing,
        'projection', e.projection,
        'is_projected', e.is_projected,
        'significance', coalesce(e.significance, et.default_significance),
        'visibility', e.visibility,
        'no_longer_expected', e.no_longer_expected,
        'category_name', ec.name,
        'marker_shape', et.shape,
        'marker_color', et.color,
        'marker_inner_mark', et.inner_mark,
        'marker_fill_style', et.fill_style,
        'anchor_type', e.anchor_type,
        'description', e.description
      ) as row
    from public.events e
    join public.event_types et on et.id = e.event_type_id
    join public.event_type_categories ec on ec.id = et.category_id
    left join public.companies co on e.anchor_type = 'company' and co.id = e.anchor_id
    left join public.assets a on e.anchor_type = 'asset' and a.id = e.anchor_id
    left join public.trials t on e.anchor_type = 'trial' and t.id = e.anchor_id
    where e.space_id = p_space_id
      and (p_kinds is null or 'event' = any(p_kinds))
      and (p_since is null or e.created_at >= p_since)
      and (p_categories is null or ec.name = any(p_categories))
      and (
        v_query_pattern is null
        or lower(e.title) like v_query_pattern
        or lower(coalesce(e.description, '')) like v_query_pattern
      )
  ),
  feed as (
    select feed_ts, row from brief_rows
    union all
    select feed_ts, row from event_rows
  ),
  counted as (
    select count(*)::int as total from feed
  ),
  paged as (
    select feed_ts, row from feed
    order by feed_ts desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row order by feed_ts desc) from paged), '[]'::jsonb),
    'total', (select total from counted),
    'limit', p_limit,
    'offset', p_offset
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.list_intelligence_feed(uuid, text[], text[], timestamptz, text, int, int) from public, anon;
grant execute on function public.list_intelligence_feed(uuid, text[], text[], timestamptz, text, int, int) to authenticated;

-- in-migration smoke: remote-safe. Runs as the migration role (RLS-bypassing), reads
-- no access-guarded RPC. Asserts the envelope shape for an arbitrary space that has data,
-- or trivially passes on an empty DB.
do $$
declare v_space uuid; v_res jsonb;
begin
  select space_id into v_space from public.events limit 1;
  if v_space is null then
    select space_id into v_space from public.primary_intelligence limit 1;
  end if;
  if v_space is not null then
    v_res := public.list_intelligence_feed(v_space, null, null, null, null, 5, 0);
    if v_res is null or not (v_res ? 'rows') or not (v_res ? 'total') then
      raise exception 'list_intelligence_feed smoke failed: bad envelope %', v_res;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
```

- [ ] **Step 2: Take the DB token, then apply + verify**

First serialize the shared DB (see Global Constraints). Append to `~/.clint-coordination/inbox.md`:

```
## [feed] <ts> EDT
TYPE: DB-TAKE
BRANCH: feat/unified-intelligence-feed
MSG: db reset to apply 20260629160000_list_intelligence_feed + run feed integration spec. ~6min.
```

Check the tail; if another session holds an open DB-TAKE, wait. Then:

Run: `supabase db reset`
Expected: completes with no error; the in-migration smoke does not raise.

- [ ] **Step 3: Run the integration test (Task 1) green**

Run: `cd src/client && export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env 2>/dev/null | grep SERVICE_ROLE | cut -d= -f2 || true); npm run test:integration -- intelligence-feed-rpc`
Expected: all 8 `list_intelligence_feed` tests PASS. (If `SUPABASE_SERVICE_ROLE_KEY` extraction differs, get it from `supabase status` per the integration-tests-local note.)

- [ ] **Step 4: Advisors clean, then release the DB token**

Run: `supabase db advisors --local --type all`
Expected: no new warnings attributable to the new function.

Append to `~/.clint-coordination/inbox.md`:

```
## [feed] <ts> EDT
TYPE: DB-RELEASE
BRANCH: feat/unified-intelligence-feed
MSG: feed RPC verified: db reset clean, integration green, advisors clean. Token free.
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260629160000_list_intelligence_feed.sql
git commit -m "feat(intelligence): list_intelligence_feed RPC (briefs + events, recency)"
```

---

### Task 3: Client model `intelligence-feed-item.model.ts`

**Files:**
- Create: `src/client/src/app/core/models/intelligence-feed-item.model.ts`
- Test: `src/client/src/app/core/models/intelligence-feed-item.model.spec.ts`

**Interfaces:**
- Consumes: `IntelligenceEntityType`, `PrimaryIntelligenceLink` from `primary-intelligence.model.ts`; `MarkerShape`, `InnerMark`, `FillStyle`, `DatePrecision` from `marker.model.ts`.
- Produces: `FeedItem = BriefFeedItem | EventFeedItem` (discriminated on `kind`); `FeedResult`; the type guard `isEventItem(i): i is EventFeedItem`. Consumed by Tasks 4, 5, 6.

- [ ] **Step 1: Write the model + guard**

```ts
import type { DatePrecision, FillStyle, InnerMark, MarkerShape } from './marker.model';
import type { IntelligenceEntityType, PrimaryIntelligenceLink } from './primary-intelligence.model';

/** One row of the unified Intelligence feed. `kind` discriminates the two shapes. */
export type FeedItem = BriefFeedItem | EventFeedItem;

interface FeedItemBase {
  id: string;
  space_id: string;
  /** Recency sort key: brief.updated_at or event.created_at. ISO string. */
  feed_ts: string;
  title: string;
}

export interface BriefFeedItem extends FeedItemBase {
  kind: 'brief';
  entity_type: IntelligenceEntityType;
  entity_id: string;
  entity_name: null;
  anchor_id: string;
  is_lead: boolean;
  summary_md: string;
  last_edited_by: string;
  state: string;
  links: Pick<PrimaryIntelligenceLink, 'entity_type' | 'entity_id' | 'relationship_type' | 'gloss'>[];
  contributors: string[];
}

export interface EventFeedItem extends FeedItemBase {
  kind: 'event';
  /** 'product' for asset-anchored, else the anchor_type; 'space' has no entity_id. */
  entity_type: 'company' | 'product' | 'trial' | 'space';
  entity_id: string | null;
  entity_name: string | null;
  event_date: string;
  date_precision: DatePrecision;
  end_date: string | null;
  end_date_precision: DatePrecision;
  is_ongoing: boolean;
  projection: 'forecasted' | 'company' | 'primary' | 'actual';
  is_projected: boolean;
  significance: 'high' | 'low' | null;
  visibility: 'pinned' | 'hidden' | null;
  no_longer_expected: boolean;
  category_name: string;
  marker_shape: MarkerShape;
  marker_color: string;
  marker_inner_mark: InnerMark;
  marker_fill_style: FillStyle;
  anchor_type: 'space' | 'company' | 'asset' | 'trial';
  description: string | null;
}

export interface FeedResult {
  rows: FeedItem[];
  total: number;
  limit: number;
  offset: number;
}

export function isEventItem(item: FeedItem): item is EventFeedItem {
  return item.kind === 'event';
}
```

- [ ] **Step 2: Write the guard unit test**

```ts
import { describe, expect, it } from 'vitest';
import { isEventItem, type EventFeedItem, type BriefFeedItem } from './intelligence-feed-item.model';

describe('isEventItem', () => {
  it('narrows event rows', () => {
    const e = { kind: 'event', id: '1', category_name: 'Clinical' } as EventFeedItem;
    expect(isEventItem(e)).toBe(true);
    if (isEventItem(e)) expect(e.category_name).toBe('Clinical');
  });
  it('rejects brief rows', () => {
    const b = { kind: 'brief', id: '2' } as BriefFeedItem;
    expect(isEventItem(b)).toBe(false);
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `cd src/client && npm run test:units -- intelligence-feed-item.model`
Expected: PASS.

```bash
git add src/client/src/app/core/models/intelligence-feed-item.model.ts src/client/src/app/core/models/intelligence-feed-item.model.spec.ts
git commit -m "feat(intelligence): FeedItem discriminated-union model"
```

---

### Task 4: `IntelligenceFeedService`

**Files:**
- Create: `src/client/src/app/core/services/intelligence-feed.service.ts`
- Test: `src/client/src/app/core/services/intelligence-feed.service.spec.ts`

**Interfaces:**
- Consumes: `RpcCache`, `SupabaseService` (DI), `FeedResult` from Task 3.
- Produces: `IntelligenceFeedService.list(opts): Promise<FeedResult>` where `opts = { spaceId; kinds?: ('brief'|'event')[] | null; categories?: string[] | null; since?: string | null; query?: string | null; limit?: number; offset?: number }`. Consumed by Task 6.

- [ ] **Step 1: Write the service (mirror `PrimaryIntelligenceService.list`)**

```ts
import { inject, Injectable } from '@angular/core';

import { FeedResult } from '../models/intelligence-feed-item.model';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

const HEAVY_TTL = { fresh: 30 * 1000, stale: 5 * 60 * 1000 };

/**
 * The unified Intelligence feed: published briefs + all events, interleaved by
 * recency. Thin wrapper over list_intelligence_feed, mirroring the Promise-based
 * shape of PrimaryIntelligenceService.
 */
@Injectable({ providedIn: 'root' })
export class IntelligenceFeedService {
  private supabase = inject(SupabaseService);
  private cache = inject(RpcCache);

  async list(opts: {
    spaceId: string;
    kinds?: ('brief' | 'event')[] | null;
    categories?: string[] | null;
    since?: string | null;
    query?: string | null;
    limit?: number;
    offset?: number;
  }): Promise<FeedResult> {
    return this.cache.get('list_intelligence_feed', opts, {
      ttl: HEAVY_TTL,
      // Invalidated by both brief publishes and event writes for this space.
      tags: [
        `space:${opts.spaceId}:primary-intelligence`,
        `space:${opts.spaceId}:events`,
      ],
      fetch: async () => {
        const { data } = await this.supabase.client
          .rpc('list_intelligence_feed', {
            p_space_id: opts.spaceId,
            p_kinds: opts.kinds ?? null,
            p_categories: opts.categories ?? null,
            p_since: opts.since ?? null,
            p_query: opts.query ?? null,
            p_limit: opts.limit ?? 25,
            p_offset: opts.offset ?? 0,
          })
          .throwOnError();
        return (data as FeedResult) ?? { rows: [], total: 0, limit: 25, offset: 0 };
      },
    });
  }
}
```

- [ ] **Step 2: Write the unit test (param passthrough)**

Mirror `src/client/src/app/core/services/event.service.spec.ts` for the SupabaseService/RpcCache mock shape. Read that spec first to copy its harness.

```ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { IntelligenceFeedService } from './intelligence-feed.service';
import { RpcCache } from './rpc-cache.service';
import { SupabaseService } from './supabase.service';

describe('IntelligenceFeedService', () => {
  it('passes mapped params to list_intelligence_feed', async () => {
    const rpc = vi.fn().mockReturnValue({ throwOnError: () => ({ data: { rows: [], total: 0, limit: 25, offset: 0 } }) });
    TestBed.configureTestingModule({
      providers: [
        IntelligenceFeedService,
        { provide: SupabaseService, useValue: { client: { rpc } } },
        { provide: RpcCache, useValue: { get: (_k: string, _a: unknown, o: { fetch: () => Promise<unknown> }) => o.fetch() } },
      ],
    });
    const svc = TestBed.inject(IntelligenceFeedService);
    await svc.list({ spaceId: 's1', kinds: ['event'], categories: ['Clinical'], since: '2026-01-01', query: 'x', limit: 10, offset: 5 });
    expect(rpc).toHaveBeenCalledWith('list_intelligence_feed', {
      p_space_id: 's1', p_kinds: ['event'], p_categories: ['Clinical'],
      p_since: '2026-01-01', p_query: 'x', p_limit: 10, p_offset: 5,
    });
  });
});
```

- [ ] **Step 3: Run + commit**

Run: `cd src/client && npm run test:units -- intelligence-feed.service`
Expected: PASS. (If the mock shape mismatches `RpcCache`/`SupabaseService`, align it to `event.service.spec.ts`.)

```bash
git add src/client/src/app/core/services/intelligence-feed.service.ts src/client/src/app/core/services/intelligence-feed.service.spec.ts
git commit -m "feat(intelligence): IntelligenceFeedService over list_intelligence_feed"
```

---

### Task 5: `IntelligenceFeedComponent` renders by `kind`

Extend the shared feed component to accept `FeedItem[]` and render a brief row (unchanged) or an event row, and to emit an `eventOpen` event on event-row click. The brief path stays byte-identical so the landing "Latest from Stout" is untouched.

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-feed/intelligence-feed.component.ts`
- Test: `src/client/src/app/shared/components/intelligence-feed/intelligence-feed.component.spec.ts` (create)

**Interfaces:**
- Consumes: `FeedItem`/`isEventItem` (Task 3); `MarkerIconComponent` (`src/app/shared/components/svg-icons/marker-icon.component.ts`); `formatMarkerExtent` (`src/app/core/models/marker-date-precision.ts`); `formatShortDate` (`src/app/shared/utils/marker-fields.ts`); `buildEntityRouterLink`.
- Produces: input `rows = input<FeedItem[]>([])` (was `IntelligenceFeedRow[]`); output `eventOpen = output<string>()` (emits the event id). Consumed by Task 6 and the landing (which passes only brief items, so behavior is unchanged).

- [ ] **Step 1: Write the component test first**

```ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { IntelligenceFeedComponent } from './intelligence-feed.component';
import { BrandContextService } from '../../../core/services/brand-context.service';
import type { FeedItem } from '../../../core/models/intelligence-feed-item.model';

const brief: FeedItem = {
  kind: 'brief', id: 'b1', space_id: 's', feed_ts: '2026-03-10T00:00:00Z',
  title: 'A brief', entity_type: 'company', entity_id: 'c1', entity_name: null,
  anchor_id: 'a1', is_lead: true, summary_md: 'body', last_edited_by: 'u', state: 'published',
  links: [], contributors: [],
};
const event: FeedItem = {
  kind: 'event', id: 'e1', space_id: 's', feed_ts: '2026-03-12T00:00:00Z',
  title: 'An event', entity_type: 'product', entity_id: 'p1', entity_name: 'Zepbound',
  event_date: '2026-09-01', date_precision: 'quarter', end_date: null, end_date_precision: 'exact',
  is_ongoing: false, projection: 'primary', is_projected: true, significance: 'high', visibility: null,
  no_longer_expected: false, category_name: 'Clinical', marker_shape: 'circle', marker_color: '#4ade80',
  marker_inner_mark: 'dot', marker_fill_style: 'filled', anchor_type: 'asset', description: 'd',
};

function mount(rows: FeedItem[]): ComponentFixture<IntelligenceFeedComponent> {
  TestBed.configureTestingModule({
    imports: [IntelligenceFeedComponent],
    providers: [
      provideRouter([]),
      { provide: BrandContextService, useValue: { brand: () => ({ kind: 'tenant', app_display_name: 'Stout', agency: { name: 'Stout' } }) } },
    ],
  });
  const f = TestBed.createComponent(IntelligenceFeedComponent);
  f.componentRef.setInput('rows', rows);
  f.componentRef.setInput('tenantId', 't');
  f.componentRef.setInput('spaceId', 's');
  f.detectChanges();
  return f;
}

describe('IntelligenceFeedComponent', () => {
  it('renders a brief row with the entity-type chip and headline', () => {
    const el = mount([brief]).nativeElement as HTMLElement;
    expect(el.textContent).toContain('A brief');
    expect(el.textContent).toContain('Company');
  });

  it('renders an event row with category chip, title, and fuzzy date label', () => {
    const el = mount([event]).nativeElement as HTMLElement;
    expect(el.textContent).toContain('An event');
    expect(el.textContent).toContain('Clinical');
    expect(el.querySelector('app-marker-icon')).toBeTruthy();
    expect(el.textContent).toMatch(/Q3 ?.?26|Q3/); // fuzzy quarter label
  });

  it('emits eventOpen with the event id when an event row is activated', () => {
    const f = mount([event]);
    let opened: string | null = null;
    f.componentInstance.eventOpen.subscribe((id) => (opened = id));
    const trigger = (f.nativeElement as HTMLElement).querySelector('[data-event-open]') as HTMLElement;
    trigger.click();
    expect(opened).toBe('e1');
  });
});
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd src/client && npm run test:units -- intelligence-feed.component`
Expected: FAIL (component still types `rows` as `IntelligenceFeedRow[]`; no event rendering; no `eventOpen`).

- [ ] **Step 3: Implement the kind switch**

Change the input type to `FeedItem[]`, add `eventOpen = output<string>()`, import `MarkerIconComponent`, and split the `@for` body with `@if (row.kind === 'event')`. Brief branch = the existing markup verbatim (cast to `BriefFeedItem`). Event branch: a sibling-styled row with the glyph + category chip + title (a `<button type="button" data-event-open (click)="eventOpen.emit(row.id)">` as the click target) + the fuzzy date label + entity-name byline. Add the protected helpers:

```ts
// imports
import { isEventItem, type FeedItem, type BriefFeedItem, type EventFeedItem } from '../../../core/models/intelligence-feed-item.model';
import { MarkerIconComponent } from '../svg-icons/marker-icon.component';
import { formatMarkerExtent } from '../../../core/models/marker-date-precision';
import { formatShortDate } from '../../utils/marker-fields';

// input change
readonly rows = input<FeedItem[]>([]);
readonly eventOpen = output<string>();
protected readonly isEventItem = isEventItem;

protected eventDateLabel(row: EventFeedItem): string {
  return formatMarkerExtent(
    row.event_date, row.date_precision, row.end_date, row.end_date_precision, row.is_ongoing, formatShortDate,
  );
}
protected asBrief(row: FeedItem): BriefFeedItem { return row as BriefFeedItem; }
protected asEvent(row: FeedItem): EventFeedItem { return row as EventFeedItem; }
```

Event-row template (sits inside the existing `<li>`, same spine + density; the spine uses slate for events; projected events get an italic, lower-contrast date):

```html
@if (row.kind === 'event') {
  @let ev = asEvent(row);
  <div class="min-w-0 flex-1 px-[22px] py-[17px] transition-colors group-hover:bg-slate-50">
    <div class="mb-2 flex items-center gap-2.5">
      <app-marker-icon
        [shape]="ev.marker_shape" [color]="ev.marker_color"
        [innerMark]="ev.marker_inner_mark" [fillStyle]="ev.marker_fill_style"
        [size]="14" [projected]="ev.is_projected"
      />
      <span class="inline-flex items-center border border-slate-200 bg-white px-2 py-1 font-mono text-[9px] font-bold uppercase leading-none tracking-[0.1em] text-slate-500">
        {{ ev.category_name }}
      </span>
      <span class="ml-auto font-mono text-[10px] font-semibold tabular-nums" [class.italic]="ev.is_projected" [class.text-slate-400]="!ev.is_projected" [class.text-slate-400/80]="ev.is_projected">
        {{ eventDateLabel(ev) }}
      </span>
    </div>
    <button
      type="button" data-event-open
      class="block w-full text-left text-[17px] font-bold leading-snug text-slate-900 group-hover:text-brand-700 before:absolute before:inset-0 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1"
      (click)="eventOpen.emit(ev.id)"
    >{{ ev.title }}</button>
    @if (ev.description) {
      <p class="mt-[7px] text-[13.5px] leading-relaxed text-slate-600 line-clamp-2">{{ ev.description }}</p>
    }
    <div class="mt-2.5 flex items-center gap-2">
      <span class="font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">
        {{ ev.entity_name ?? 'Engagement' }}
      </span>
      <span class="relative ml-auto font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-brand-700" aria-hidden="true">
        Open event &rarr;
      </span>
    </div>
  </div>
} @else {
  @let br = asBrief(row);
  <!-- existing brief markup verbatim, with row.* -> br.* -->
}
```

Confirm `MarkerIconComponent`'s input names (`shape`/`color`/`innerMark`/`fillStyle`/`size`/`projected`) against its source and adjust bindings to match exactly. Add `MarkerIconComponent` to `imports`. Keep the spine `<span>` outside the `@if`; for events use `bg-slate-300`.

- [ ] **Step 4: Run to confirm pass**

Run: `cd src/client && npm run test:units -- intelligence-feed.component`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

Run: `cd src/client && ng lint`
Expected: clean (fix any `template/*` findings, e.g. `@let` placement, before committing).

```bash
git add src/client/src/app/shared/components/intelligence-feed/
git commit -m "feat(intelligence): feed component renders brief + event rows by kind"
```

---

### Task 6: `/intelligence` page wiring (Kind toggle, category chips, event drawer)

**Files:**
- Modify: `src/client/src/app/shared/components/intelligence-browse/intelligence-browse.component.ts`
- Test: `src/client/src/app/shared/components/intelligence-browse/intelligence-browse.component.spec.ts` (create; light behavior test)

**Interfaces:**
- Consumes: `IntelligenceFeedService` (Task 4), `FeedItem`/`FeedResult` (Task 3), `IntelligenceFeedComponent` (Task 5, now emitting `eventOpen`), `MarkerCategoryService` (`src/app/core/services/marker-category.service.ts`, `.list(spaceId)` returns the event_type_categories), `EventDetailService` (`.getCatalystDetail(eventId)`), `MarkerDetailPanelComponent` (`src/app/shared/components/marker-detail-panel.component.ts`, `mode="page-drawer"`).
- Produces: nothing downstream.

- [ ] **Step 1: Read the two reused pieces**

Run: `grep -nE "list\(|export class|name|id" src/client/src/app/core/services/marker-category.service.ts | head; grep -nE "input<|output<|mode|open|detail|surfaceKey" src/client/src/app/shared/components/marker-detail-panel.component.ts | head`
Confirm `MarkerCategoryService.list(spaceId)` returns objects with `.name`, and the panel inputs are `detail`/`spaceId`/`mode`/`open`/`surfaceKey` with output `panelClose`. Adjust the code below to the real names.

- [ ] **Step 2: Write a light behavior test (RED)**

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { IntelligenceBrowseComponent } from './intelligence-browse.component';
import { IntelligenceFeedService } from '../../../core/services/intelligence-feed.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { MarkerCategoryService } from '../../../core/services/marker-category.service';
import { EventDetailService } from '../../../core/services/event-detail.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { MessageService } from 'primeng/api';

function setup(feedList: ReturnType<typeof vi.fn>) {
  TestBed.configureTestingModule({
    imports: [IntelligenceBrowseComponent],
    providers: [
      provideRouter([]),
      { provide: IntelligenceFeedService, useValue: { list: feedList } },
      { provide: PrimaryIntelligenceService, useValue: { listDraftsForSpace: vi.fn().mockResolvedValue([]), changed: () => 0 } },
      { provide: MarkerCategoryService, useValue: { list: vi.fn().mockResolvedValue([{ id: 'd1', name: 'Clinical' }]) } },
      { provide: EventDetailService, useValue: { getCatalystDetail: vi.fn() } },
      { provide: SpaceRoleService, useValue: { canAuthorIntelligence: () => false, canEdit: () => false } },
      { provide: MessageService, useValue: { add: vi.fn() } },
    ],
  });
  return TestBed.createComponent(IntelligenceBrowseComponent);
}

describe('IntelligenceBrowseComponent (merged feed)', () => {
  it('loads the merged feed via IntelligenceFeedService on the published path', async () => {
    const list = vi.fn().mockResolvedValue({ rows: [], total: 0, limit: 25, offset: 0 });
    const f = setup(list);
    f.componentInstance.spaceId.set('s1');
    await f.componentInstance['load']();
    expect(list).toHaveBeenCalled();
    expect(list.mock.calls[0][0]).toMatchObject({ spaceId: 's1' });
  });

  it('maps the Events kind to kinds:[event] and selected chips to categories', async () => {
    const list = vi.fn().mockResolvedValue({ rows: [], total: 0, limit: 25, offset: 0 });
    const f = setup(list);
    f.componentInstance.spaceId.set('s1');
    f.componentInstance.kind.set('event');
    f.componentInstance.categories.set(['Clinical']);
    await f.componentInstance['load']();
    expect(list.mock.calls.at(-1)![0]).toMatchObject({ kinds: ['event'], categories: ['Clinical'] });
  });
});
```

Run: `cd src/client && npm run test:units -- intelligence-browse.component`
Expected: FAIL (no `kind`/`categories` signals; still calls `PrimaryIntelligenceService.list`).

- [ ] **Step 3: Implement the wiring**

In the component class:
- Inject `IntelligenceFeedService` and `MarkerCategoryService` and `EventDetailService`; keep `PrimaryIntelligenceService` for the drafts path only.
- Add signals: `kind = signal<'all' | 'intel' | 'event'>('all')`, `categories = signal<string[]>([])`, `categoryOptions = signal<{ id: string; name: string }[]>([])`, `eventDetail = signal<CatalystDetail | null>(null)`, `eventPanelOpen = signal(false)`.
- Replace `rows`/feed types with `FeedItem[]`. The published branch of `load()`:

```ts
const result = await this.feed.list({
  spaceId: sid,
  kinds: this.kind() === 'all' ? null : this.kind() === 'intel' ? ['brief'] : ['event'],
  categories: this.categories().length ? this.categories() : null,
  since: this.since() ? this.since()!.toISOString() : null,
  query: this.query()?.trim() || null,
  limit: PAGE_SIZE,
  offset: this.offset(),
});
this.rows.set(result.rows);
this.total.set(result.total);
```

- Load `categoryOptions` once when `spaceId` is set: `this.categoryOptions.set(await this.markerCategory.list(sid))`.
- Drafts branch unchanged (`listDraftsForSpace`), but coerce drafts (`IntelligenceFeedRow[]`) into `BriefFeedItem[]` via a small adapter `draftToFeedItem(d)` that sets `kind: 'brief'`, `feed_ts: d.updated_at`, `title: d.headline`, and copies the brief fields, so the shared component renders them. The drafts client-side filter keeps working on those fields.
- Event open handler:

```ts
protected async onEventOpen(eventId: string): Promise<void> {
  this.eventDetail.set(await this.eventDetail$get(eventId));
  this.eventPanelOpen.set(true);
}
private async eventDetail$get(id: string) { return this.eventDetailService.getCatalystDetail(id); }
protected closeEventPanel(): void { this.eventPanelOpen.set(false); }
```

In the template:
- Add a `p-selectbutton` Kind control (`All` / `Intelligence` / `Events`) bound to `kind` with `(ngModelChange)="kind.set($event); resetAndLoad()"`, shown only when `status() === 'published'`.
- Add category chip-buttons (the small-fixed-enum idiom, not a multiselect) shown only when `status() === 'published'` and `kind() !== 'intel'`: a `@for (c of categoryOptions(); track c.id)` of `p-button` toggles that add/remove `c.name` in `categories()` then `resetAndLoad()`. Match the toolbar's existing slate-50 stripe + mono labels.
- Remove the entity-type `p-multi-select` block.
- Bind the feed: `<app-intelligence-feed [rows]="rows()" ... (eventOpen)="onEventOpen($event)" />`.
- Mount the drawer at page end: `<app-marker-detail-panel mode="page-drawer" [open]="eventPanelOpen()" [detail]="eventDetail()" [spaceId]="spaceId()" surfaceKey="timeline_detail" (panelClose)="closeEventPanel()" />`.
- Update `totalLabel`/`headingSubtitle`/`emptyMessage` computeds to be kind-aware: published subtitle "Briefs and events in this space, most recent first."; empty messages: all = "No intelligence or events yet."; intel = today's; event = "No events logged in this space yet." Total stays "N entries".

Drop the now-unused `entityTypes` signal, `ENTITY_TYPES`, and the entity-type imports. Keep `since`/`query`. Ensure every signal feeding a `computed()` stays a signal.

- [ ] **Step 4: Run the test green**

Run: `cd src/client && npm run test:units -- intelligence-browse.component`
Expected: PASS.

- [ ] **Step 5: Lint + build + commit**

Run: `cd src/client && ng lint && ng build`
Expected: clean lint; build succeeds.

```bash
git add src/client/src/app/shared/components/intelligence-browse/
git commit -m "feat(intelligence): merged feed page (kind toggle, category chips, event drawer)"
```

---

### Task 7: Drift gates + docs

**Files:**
- Modify: the Intelligence feature manifest under `src/client/` features config (find with the command below) to map `list_intelligence_feed`.
- Modify: `docs/runbook/features/` intelligence feature doc + surfaces table + glossary feed line.
- Regenerate: runbook auto-gen blocks via `npm run docs:arch`.

**Interfaces:** none (docs/config only).

- [ ] **Step 1: Map the new RPC in the feature manifest**

Run: `grep -rln "list_primary_intelligence" src/client --include="*.md" --include="*.json" --include="*.ts" | grep -iE "feature|capabilit|manifest"`
Add `list_intelligence_feed` to the same Intelligence capability that lists `list_primary_intelligence` (rpcs array). Then:

Run: `cd src/client && npm run features:check`
Expected: PASS (no `rpc-unmapped` error for `list_intelligence_feed`).

- [ ] **Step 2: Regenerate runbook auto-gen + update prose**

Run: `cd src/client && npm run docs:arch`
Then hand-edit the surrounding prose (not inside `AUTO-GEN` markers): in the intelligence feature doc and the surfaces table, change `/intelligence` to "briefs + events, recency-descending, not significance-gated"; update the glossary's Intelligence-feed line to note it carries both kinds.

- [ ] **Step 3: Verify grants + commit**

Run: `cd src/client && npm run grants:check`
Expected: PASS (RPC-only; `authenticated` execute present, `anon` absent).

```bash
git add -A
git commit -m "docs(intelligence): map list_intelligence_feed + runbook feed surfaces"
```

---

### Task 8: E2E + dev visual confirmation (staged; after merge to dev)

Deferred to after the coordinator merges the branch and dev redeploys (per the parent design's staged-to-dev rule and the Cloudflare-auth constraint). Capture for the verification report, do not block the code tasks.

**Files:**
- Create (if not extending an existing dev e2e): a Playwright spec under `src/client/e2e-dev/tests/` driving `dev.clintapp.com/.../intelligence`.

- [ ] **Step 1: After dev redeploy, drive `/intelligence` headed** (chrome channel + automation-flag fingerprint + pre-authed dev profile, per the Cloudflare/Playwright notes) and assert: both kinds render interleaved; the Kind toggle filters; a category chip filters; an event-row click opens the detail drawer; the landing "Latest from Stout" is unchanged.

- [ ] **Step 2: Capture screenshots** (All / Intelligence / Events states + an open event drawer) into the verification report for review.

---

## Self-Review

**Spec coverage:**
- Merged recency RPC, UNION, kind discriminator, feed_ts (briefs updated_at / events created_at), event_date not the sort key -> Task 2. Covered.
- No significance/visibility gating -> asserted in Task 1 (low-sig + hidden both appear). Covered.
- Kind toggle + category chips, drop entity-type, keep Since/search, drafts stays briefs-only -> Task 6. Covered.
- Filter composition (Kind=All + category leaves briefs) -> Task 1 (category test) + Task 2 SQL (`p_categories` only constrains the event leg). Covered.
- Event click opens detail panel in place -> Task 6 drawer (`MarkerDetailPanelComponent` page-drawer). Covered.
- Landing untouched -> Task 5 keeps brief markup verbatim; landing passes brief items. Covered.
- Three test layers -> Task 1 (integration), Tasks 3/4/5/6 (unit), Task 8 (e2e/visual). Covered.
- Drift (features:check, grants:check, docs:arch), runbook, glossary -> Task 7. Covered.
- DB serialization + lane + READY-not-push -> Global Constraints + Task 2 DB steps. Covered.

**Placeholder scan:** No TBD/TODO; every code step shows full code. Verification commands have expected output.

**Type consistency:** `FeedItem`/`BriefFeedItem`/`EventFeedItem`/`FeedResult`/`isEventItem` used identically across Tasks 3-6. RPC param names (`p_kinds`/`p_categories`/`p_since`/`p_query`/`p_limit`/`p_offset`) match between Task 2 (SQL), Task 4 (service), Task 1 (test). Service `opts` keys (`kinds`/`categories`/`since`/`query`) match Task 6 callers. `eventOpen` output name matches between Task 5 (producer) and Task 6 (consumer).

**Known verification points flagged for the implementer (not placeholders, real "confirm against source" checks):** `MarkerIconComponent` input names (Task 5 Step 3); `MarkerCategoryService.list` return shape and `MarkerDetailPanelComponent` input/output names (Task 6 Step 1); personas field names (Task 1 Step 2); the features-manifest file location (Task 7 Step 1). Each step says to read the source and adjust to real names rather than assume.
