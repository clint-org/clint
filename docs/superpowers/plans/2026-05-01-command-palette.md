# Command Palette (Cmd+K) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a space-level Cmd+K palette that finds entities (companies, products, trials, catalysts, events), navigates to pages, and runs commands, backed by `pg_trgm` server search and an Angular CDK overlay.

**Architecture:** A single `CommandPaletteComponent` mounted in `AppShellComponent` and driven by a `PaletteService` signal store. Search runs server-side via a `search_palette` RPC over GIN-trigram indexes, scoped to the current space by RLS. Pinned items and recents persist per user/space in dedicated tables; commands are a static client-side registry.

**Tech Stack:** Angular 19 standalone components with signals, `@angular/cdk/overlay` for the modal shell, Supabase Postgres with `pg_trgm`, Tailwind v4 utilities.

**Spec:** `docs/superpowers/specs/2026-05-01-command-palette-design.md`

---

## File Structure

**New (database):**
- `supabase/migrations/20260501120000_palette_tables_and_indexes.sql` - extension, GIN trigram indexes, `palette_pinned`, `palette_recents`, RLS policies.
- `supabase/migrations/20260501120100_palette_rpc_functions.sql` - `search_palette`, `palette_empty_state`, `palette_touch_recent`, `palette_set_pinned`, `palette_unpin`.
- `supabase/tests/palette/run.sh` - convenience wrapper that runs all `.sql` test files via psql.
- `supabase/tests/palette/01_search_palette_ranking.sql`
- `supabase/tests/palette/02_search_palette_rls.sql`
- `supabase/tests/palette/03_palette_pinned_rls.sql`
- `supabase/tests/palette/04_palette_recents_rls_and_trim.sql`
- `supabase/tests/palette/05_search_palette_explain.sql`

**New (client - models & util):**
- `src/client/src/app/core/models/palette.model.ts` - `PaletteItem`, `PaletteKind`, `PaletteCommand`, `EmptyState`, `PrefixToken`.
- `src/client/src/app/core/util/parse-prefix-token.ts` - pure function.

**New (client - services):**
- `src/client/src/app/core/services/palette-hotkey.service.ts`
- `src/client/src/app/core/services/palette.service.ts`
- `src/client/src/app/core/services/palette-recents.service.ts`
- `src/client/src/app/core/services/palette-pin.service.ts`
- `src/client/src/app/core/services/palette-command.registry.ts`

**New (client - components):**
- `src/client/src/app/core/layout/command-palette/palette-result-row.component.ts`
- `src/client/src/app/core/layout/command-palette/palette-empty-state.component.ts`
- `src/client/src/app/core/layout/command-palette/palette-search-input.component.ts`
- `src/client/src/app/core/layout/command-palette/palette-result-list.component.ts`
- `src/client/src/app/core/layout/command-palette/command-palette.component.ts`

**New (client - tests):**
- `src/client/e2e/tests/palette-prefix-token.spec.ts`
- `src/client/e2e/tests/palette-hotkey.spec.ts`
- `src/client/e2e/tests/palette-service-debounce.spec.ts`
- `src/client/e2e/tests/palette-command-registry.spec.ts`

**Modified:**
- `src/client/src/app/core/layout/app-shell.component.ts` - mount `<app-command-palette>` once, after the topbar.
- `src/client/playwright.unit.config.ts` - extend `testMatch` to include the four new pure-function specs.

---

## Conventions

- Each task ends with a commit. Use `git add <specific files>` (never `git add -A`).
- Run `cd src/client && npm run lint && npm run build` before any client-side commit.
- Migrations are local-only until pushed; if you need to change one before push, edit and run `supabase db reset`.
- All Angular components are standalone with `inject()` DI and signal-based state.
- No emojis anywhere (in code, comments, commit messages).
- Do not attribute Claude in commits.

---

## Task 1: Tables, indexes, RLS migration

**Files:**
- Create: `supabase/migrations/20260501120000_palette_tables_and_indexes.sql`

- [ ] **Step 1: Create the migration file**

Write `supabase/migrations/20260501120000_palette_tables_and_indexes.sql`:

```sql
-- migration: 20260501120000_palette_tables_and_indexes
-- purpose: pg_trgm extension, GIN trigram indexes for command palette search,
--          palette_pinned and palette_recents tables with RLS

create extension if not exists pg_trgm;

-- Trigram indexes for fuzzy/prefix search across searchable text columns.
create index if not exists companies_name_trgm
  on public.companies using gin (name gin_trgm_ops);

create index if not exists products_name_trgm
  on public.products using gin (name gin_trgm_ops);

create index if not exists products_generic_name_trgm
  on public.products using gin (generic_name gin_trgm_ops);

create index if not exists trials_title_trgm
  on public.trials using gin (title gin_trgm_ops);

create index if not exists trials_nct_id_trgm
  on public.trials using gin (nct_id gin_trgm_ops);

create index if not exists catalysts_title_trgm
  on public.catalysts using gin (title gin_trgm_ops);

create index if not exists events_title_trgm
  on public.events using gin (title gin_trgm_ops);

-- Pinned items per user per space.
create table public.palette_pinned (
  user_id    uuid not null references auth.users on delete cascade,
  space_id   uuid not null references public.spaces on delete cascade,
  kind       text not null check (kind in ('company','product','trial','catalyst','event')),
  entity_id  uuid not null,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, space_id, kind, entity_id)
);

create index palette_pinned_user_space
  on public.palette_pinned (user_id, space_id, position);

-- Recently opened entities per user per space.
create table public.palette_recents (
  user_id        uuid not null references auth.users on delete cascade,
  space_id       uuid not null references public.spaces on delete cascade,
  kind           text not null check (kind in ('company','product','trial','catalyst','event')),
  entity_id      uuid not null,
  last_opened_at timestamptz not null default now(),
  primary key (user_id, space_id, kind, entity_id)
);

create index palette_recents_user_space_time
  on public.palette_recents (user_id, space_id, last_opened_at desc);

-- RLS: each row is owned by user_id; only that user may read or write.
alter table public.palette_pinned  enable row level security;
alter table public.palette_recents enable row level security;

create policy palette_pinned_owner
  on public.palette_pinned
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy palette_recents_owner
  on public.palette_recents
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.palette_pinned  is 'User-pinned entities shown in the command palette empty state';
comment on table public.palette_recents is 'User-recently-opened entities shown in the command palette empty state';
```

- [ ] **Step 2: Apply the migration**

Run: `supabase db reset`
Expected: migration runs without error; final output includes `Finished supabase db reset`.

- [ ] **Step 3: Verify tables and indexes exist**

Run:
```bash
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "\d palette_pinned" -c "\d palette_recents" -c "\di companies_name_trgm trials_nct_id_trgm"
```
Expected: both tables and both named indexes are listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260501120000_palette_tables_and_indexes.sql
git commit -m "feat(palette): pg_trgm indexes, pinned and recents tables"
```

---

## Task 2: search_palette RPC + ranking test

**Files:**
- Create: `supabase/migrations/20260501120100_palette_rpc_functions.sql`
- Create: `supabase/tests/palette/01_search_palette_ranking.sql`
- Create: `supabase/tests/palette/run.sh`

- [ ] **Step 1: Create the RPC migration with search_palette**

Write `supabase/migrations/20260501120100_palette_rpc_functions.sql`:

```sql
-- migration: 20260501120100_palette_rpc_functions
-- purpose: command palette search and pinned/recents management RPCs

-- ============================================================
-- search_palette - ranked union across entity types, RLS-aware
-- ============================================================
create or replace function public.search_palette (
  p_space_id uuid,
  p_query    text,
  p_kind     text default null,
  p_limit    int  default 25
) returns table (
  kind        text,
  id          uuid,
  name        text,
  secondary   text,
  score       real,
  pinned      boolean,
  recent_at   timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_q   text := lower(coalesce(trim(p_query), ''));
begin
  -- short-circuit on no access or empty query
  if v_uid is null then return; end if;
  if not public.has_space_access(p_space_id) then return; end if;
  if length(v_q) < 2 then return; end if;

  return query
  with matches as (
    -- companies
    select 'company'::text as kind,
           c.id,
           c.name,
           coalesce(nullif(c.company_type, '') || ' &middot; ' || nullif(c.ticker, ''),
                    nullif(c.ticker, ''),
                    nullif(c.company_type, '')) as secondary,
           similarity(c.name, v_q)
             + case when c.name ilike v_q || '%' then 0.3 else 0 end as score
    from public.companies c
    where c.space_id = p_space_id
      and (p_kind is null or p_kind = 'company')
      and c.name % v_q

    union all
    -- products
    select 'product'::text,
           p.id,
           p.name,
           concat_ws(' &middot; ',
             (select s.name from public.companies s where s.id = p.sponsor_id),
             (select m.name from public.mechanisms_of_action m
                join public.product_mechanisms_of_action pm on pm.moa_id = m.id
                where pm.product_id = p.id limit 1),
             (select r.name from public.routes_of_administration r
                join public.product_routes_of_administration pr on pr.roa_id = r.id
                where pr.product_id = p.id limit 1)
           ) as secondary,
           greatest(similarity(p.name, v_q), similarity(coalesce(p.generic_name,''), v_q))
             + case when p.name ilike v_q || '%' or coalesce(p.generic_name,'') ilike v_q || '%' then 0.3 else 0 end as score
    from public.products p
    where p.space_id = p_space_id
      and (p_kind is null or p_kind = 'product')
      and (p.name % v_q or coalesce(p.generic_name,'') % v_q)

    union all
    -- trials (search title + nct_id, with NCT exact match boost)
    select 'trial'::text,
           t.id,
           t.title as name,
           concat_ws(' &middot; ',
             nullif('Ph' || t.phase, 'Ph'),
             t.indication,
             (select s.name from public.companies s where s.id = t.sponsor_id),
             t.nct_id
           ) as secondary,
           greatest(similarity(t.title, v_q), similarity(coalesce(t.nct_id,''), v_q))
             + case when t.title ilike v_q || '%' then 0.3 else 0 end
             + case when upper(coalesce(t.nct_id,'')) = upper(v_q) then 0.5 else 0 end as score
    from public.trials t
    where t.space_id = p_space_id
      and (p_kind is null or p_kind = 'trial')
      and (t.title % v_q or coalesce(t.nct_id,'') % v_q)

    union all
    -- catalysts
    select 'catalyst'::text,
           k.id,
           k.title,
           concat_ws(' &middot; ',
             k.expected_quarter,
             k.indication,
             (select t2.title from public.trials t2 where t2.id = k.trial_id)
           ) as secondary,
           similarity(k.title, v_q)
             + case when k.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.catalysts k
    where k.space_id = p_space_id
      and (p_kind is null or p_kind = 'catalyst')
      and k.title % v_q

    union all
    -- events
    select 'event'::text,
           e.id,
           e.title,
           concat_ws(' &middot; ',
             to_char(e.event_date, 'YYYY-MM-DD'),
             (select ec.name from public.event_categories ec where ec.id = e.category_id),
             (select cc.name from public.companies cc where cc.id = e.company_id)
           ) as secondary,
           similarity(e.title, v_q)
             + case when e.title ilike v_q || '%' then 0.3 else 0 end as score
    from public.events e
    where e.space_id = p_space_id
      and (p_kind is null or p_kind = 'event')
      and e.title % v_q
  )
  select m.kind,
         m.id,
         m.name,
         m.secondary,
         m.score::real,
         (pp.user_id is not null) as pinned,
         pr.last_opened_at as recent_at
  from matches m
  left join public.palette_pinned pp
    on pp.user_id = v_uid and pp.space_id = p_space_id and pp.kind = m.kind and pp.entity_id = m.id
  left join public.palette_recents pr
    on pr.user_id = v_uid and pr.space_id = p_space_id and pr.kind = m.kind and pr.entity_id = m.id
  order by pinned desc,
           score desc,
           recent_at desc nulls last,
           m.name asc
  limit p_limit;
end;
$$;

grant execute on function public.search_palette(uuid, text, text, int) to authenticated;
```

Note: replace `&middot;` with the actual middle-dot character (`·`) when writing the file. The HTML entity here exists only because this plan document is markdown.

- [ ] **Step 2: Apply the migration**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Create the SQL test runner**

Write `supabase/tests/palette/run.sh`:

```bash
#!/usr/bin/env bash
# Run every .sql file in this directory against local Supabase Postgres.
# Each test file uses `raise exception` to fail; psql exits non-zero on first failure.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PSQL="${PSQL:-psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1}"
for f in "$HERE"/*.sql; do
  echo "--- $f"
  $PSQL -f "$f"
done
echo "All palette tests passed."
```

Run: `chmod +x supabase/tests/palette/run.sh`

- [ ] **Step 4: Write the ranking test**

Write `supabase/tests/palette/01_search_palette_ranking.sql`. The test uses an existing seeded space; pick one deterministically. The pharma demo seed creates predictable companies, products, and trials.

```sql
-- 01_search_palette_ranking
-- Asserts search_palette ranks results sensibly against the seeded pharma demo space.

do $$
declare
  v_user uuid;
  v_space uuid;
  v_top_kind text;
  v_top_name text;
  v_count int;
begin
  -- pick the first user that has any space membership
  select user_id, space_id into v_user, v_space
  from public.space_members
  order by created_at asc
  limit 1;
  if v_user is null then
    raise exception 'seed has no space_members; cannot run ranking test';
  end if;

  -- impersonate that user
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- query 'KEYNOTE' should return at least one trial
  select count(*) into v_count
  from public.search_palette(v_space, 'KEYNOTE', null, 25)
  where kind = 'trial';
  if v_count = 0 then
    raise exception 'expected at least one trial matching KEYNOTE in space %', v_space;
  end if;

  -- query an NCT id that exists in seed: pick the first trial's nct_id
  declare
    v_nct text;
    v_trial_id uuid;
  begin
    select nct_id, id into v_nct, v_trial_id
    from public.trials
    where space_id = v_space and nct_id is not null
    order by id limit 1;
    if v_nct is not null then
      select kind, id::text into v_top_kind, v_top_name
      from public.search_palette(v_space, v_nct, null, 1);
      if v_top_kind is null or v_top_kind <> 'trial' then
        raise exception 'expected NCT exact-match to return a trial, got % %', v_top_kind, v_top_name;
      end if;
    end if;
  end;

  -- query under 2 chars returns nothing
  select count(*) into v_count from public.search_palette(v_space, 'a', null, 25);
  if v_count <> 0 then
    raise exception 'expected zero results for 1-char query, got %', v_count;
  end if;
end $$;
```

- [ ] **Step 5: Run the test**

Run: `bash supabase/tests/palette/run.sh`
Expected: prints `All palette tests passed.`

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260501120100_palette_rpc_functions.sql \
        supabase/tests/palette/run.sh \
        supabase/tests/palette/01_search_palette_ranking.sql
git commit -m "feat(palette): search_palette RPC with ranking test"
```

---

## Task 3: search_palette RLS test

**Files:**
- Create: `supabase/tests/palette/02_search_palette_rls.sql`

- [ ] **Step 1: Write the RLS test**

Write `supabase/tests/palette/02_search_palette_rls.sql`:

```sql
-- 02_search_palette_rls
-- Asserts that a caller without space_members access gets empty results.

do $$
declare
  v_outsider uuid;
  v_space uuid;
  v_count int;
begin
  -- pick a space and an authenticated user not in it
  select s.id into v_space
  from public.spaces s
  order by s.created_at asc
  limit 1;

  select u.id into v_outsider
  from auth.users u
  where not exists (
    select 1 from public.space_members m where m.user_id = u.id and m.space_id = v_space
  )
  order by u.created_at asc
  limit 1;

  if v_space is null or v_outsider is null then
    raise notice 'seed has no outsider/space pair to test; skipping';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider)::text, true);
  select count(*) into v_count from public.search_palette(v_space, 'a really long generic query', null, 25);
  if v_count <> 0 then
    raise exception 'outsider got % rows for space %; expected 0', v_count, v_space;
  end if;
end $$;
```

- [ ] **Step 2: Run the tests**

Run: `bash supabase/tests/palette/run.sh`
Expected: `All palette tests passed.`

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/palette/02_search_palette_rls.sql
git commit -m "test(palette): search_palette RLS isolates outsiders"
```

---

## Task 4: palette_empty_state RPC + RLS coverage for pinned

**Files:**
- Modify: `supabase/migrations/20260501120100_palette_rpc_functions.sql`
- Create: `supabase/tests/palette/03_palette_pinned_rls.sql`

- [ ] **Step 1: Append palette_empty_state to the RPC migration**

Append to `supabase/migrations/20260501120100_palette_rpc_functions.sql`:

```sql
-- ============================================================
-- palette_empty_state - returns pinned and recents for the empty state
-- ============================================================
create or replace function public.palette_empty_state (
  p_space_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pinned jsonb;
  v_recents jsonb;
begin
  if v_uid is null then return jsonb_build_object('pinned','[]','recents','[]'); end if;
  if not public.has_space_access(p_space_id) then
    return jsonb_build_object('pinned','[]','recents','[]');
  end if;

  -- top 10 pinned ordered by position
  with pinned_ids as (
    select kind, entity_id, position
    from public.palette_pinned
    where user_id = v_uid and space_id = p_space_id
    order by position asc
    limit 10
  )
  select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb) into v_pinned from pinned_ids p;

  -- top 8 recents
  with recent_ids as (
    select kind, entity_id, last_opened_at
    from public.palette_recents
    where user_id = v_uid and space_id = p_space_id
    order by last_opened_at desc
    limit 8
  )
  select coalesce(jsonb_agg(row_to_json(r)), '[]'::jsonb) into v_recents from recent_ids r;

  return jsonb_build_object('pinned', v_pinned, 'recents', v_recents);
end;
$$;

grant execute on function public.palette_empty_state(uuid) to authenticated;
```

- [ ] **Step 2: Apply migration**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Write pinned RLS test**

Write `supabase/tests/palette/03_palette_pinned_rls.sql`:

```sql
-- 03_palette_pinned_rls
-- Asserts that user A cannot read or write user B's pinned rows.

do $$
declare
  v_a uuid;
  v_b uuid;
  v_space uuid;
  v_count int;
begin
  -- two distinct users that share a space (so both have access)
  select m1.user_id, m2.user_id, m1.space_id
  into v_a, v_b, v_space
  from public.space_members m1
  join public.space_members m2 on m1.space_id = m2.space_id and m1.user_id <> m2.user_id
  limit 1;

  if v_a is null then
    raise notice 'seed has no pair of users sharing a space; skipping';
    return;
  end if;

  -- user A inserts a pin
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  insert into public.palette_pinned(user_id, space_id, kind, entity_id, position)
  values (v_a, v_space, 'company', gen_random_uuid(), 0);

  -- user B should not see A's pin
  perform set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
  select count(*) into v_count from public.palette_pinned where space_id = v_space;
  if v_count <> 0 then
    raise exception 'user B saw % pinned rows; expected 0', v_count;
  end if;

  -- user B cannot insert a row for user A
  begin
    insert into public.palette_pinned(user_id, space_id, kind, entity_id, position)
    values (v_a, v_space, 'company', gen_random_uuid(), 0);
    raise exception 'user B was allowed to insert a pin for user A';
  exception when others then
    -- expected: RLS rejects the insert
    null;
  end;

  -- cleanup
  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  delete from public.palette_pinned where user_id = v_a and space_id = v_space;
end $$;
```

- [ ] **Step 4: Run the tests**

Run: `bash supabase/tests/palette/run.sh`
Expected: `All palette tests passed.`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260501120100_palette_rpc_functions.sql \
        supabase/tests/palette/03_palette_pinned_rls.sql
git commit -m "feat(palette): palette_empty_state RPC and pinned RLS test"
```

---

## Task 5: palette_touch_recent RPC + trim test

**Files:**
- Modify: `supabase/migrations/20260501120100_palette_rpc_functions.sql`
- Create: `supabase/tests/palette/04_palette_recents_rls_and_trim.sql`

- [ ] **Step 1: Append palette_touch_recent**

Append to `supabase/migrations/20260501120100_palette_rpc_functions.sql`:

```sql
-- ============================================================
-- palette_touch_recent - upserts a recent open and trims to last 25
-- ============================================================
create or replace function public.palette_touch_recent (
  p_space_id  uuid,
  p_kind      text,
  p_entity_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not public.has_space_access(p_space_id) then return; end if;
  if p_kind not in ('company','product','trial','catalyst','event') then
    raise exception 'invalid kind %', p_kind;
  end if;

  insert into public.palette_recents(user_id, space_id, kind, entity_id, last_opened_at)
  values (v_uid, p_space_id, p_kind, p_entity_id, now())
  on conflict (user_id, space_id, kind, entity_id)
  do update set last_opened_at = excluded.last_opened_at;

  -- trim to most recent 25 per (user, space)
  delete from public.palette_recents r
  where r.user_id = v_uid
    and r.space_id = p_space_id
    and (r.kind, r.entity_id) not in (
      select kind, entity_id
      from public.palette_recents
      where user_id = v_uid and space_id = p_space_id
      order by last_opened_at desc
      limit 25
    );
end;
$$;

grant execute on function public.palette_touch_recent(uuid, text, uuid) to authenticated;
```

- [ ] **Step 2: Apply migration**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Write recents RLS + trim test**

Write `supabase/tests/palette/04_palette_recents_rls_and_trim.sql`:

```sql
-- 04_palette_recents_rls_and_trim
-- Asserts: user-isolation on palette_recents + trim-to-25 by palette_touch_recent.

do $$
declare
  v_a uuid;
  v_space uuid;
  v_count int;
begin
  select m.user_id, m.space_id into v_a, v_space
  from public.space_members m
  order by m.created_at asc
  limit 1;
  if v_a is null then raise notice 'no seed members; skip'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);

  -- insert 30 fake recent rows via the RPC
  for i in 1..30 loop
    perform public.palette_touch_recent(v_space, 'company', gen_random_uuid());
  end loop;

  select count(*) into v_count
  from public.palette_recents
  where user_id = v_a and space_id = v_space;
  if v_count > 25 then
    raise exception 'expected at most 25 recent rows after trim, got %', v_count;
  end if;

  -- cleanup
  delete from public.palette_recents where user_id = v_a and space_id = v_space;
end $$;
```

- [ ] **Step 4: Run the tests**

Run: `bash supabase/tests/palette/run.sh`
Expected: `All palette tests passed.`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260501120100_palette_rpc_functions.sql \
        supabase/tests/palette/04_palette_recents_rls_and_trim.sql
git commit -m "feat(palette): palette_touch_recent with trim-to-25"
```

---

## Task 6: palette_set_pinned, palette_unpin, EXPLAIN regression

**Files:**
- Modify: `supabase/migrations/20260501120100_palette_rpc_functions.sql`
- Create: `supabase/tests/palette/05_search_palette_explain.sql`

- [ ] **Step 1: Append pin management RPCs**

Append to `supabase/migrations/20260501120100_palette_rpc_functions.sql`:

```sql
-- ============================================================
-- palette_set_pinned - upserts a pin at a given position
-- ============================================================
create or replace function public.palette_set_pinned (
  p_space_id  uuid,
  p_kind      text,
  p_entity_id uuid,
  p_position  int default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  if not public.has_space_access(p_space_id) then return; end if;
  if p_kind not in ('company','product','trial','catalyst','event') then
    raise exception 'invalid kind %', p_kind;
  end if;

  insert into public.palette_pinned(user_id, space_id, kind, entity_id, position)
  values (v_uid, p_space_id, p_kind, p_entity_id, p_position)
  on conflict (user_id, space_id, kind, entity_id)
  do update set position = excluded.position;
end;
$$;

grant execute on function public.palette_set_pinned(uuid, text, uuid, int) to authenticated;

-- ============================================================
-- palette_unpin - deletes a pin
-- ============================================================
create or replace function public.palette_unpin (
  p_space_id  uuid,
  p_kind      text,
  p_entity_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;
  delete from public.palette_pinned
  where user_id = v_uid and space_id = p_space_id and kind = p_kind and entity_id = p_entity_id;
end;
$$;

grant execute on function public.palette_unpin(uuid, text, uuid) to authenticated;
```

- [ ] **Step 2: Apply migration**

Run: `supabase db reset`
Expected: completes without error.

- [ ] **Step 3: Write EXPLAIN regression test**

Write `supabase/tests/palette/05_search_palette_explain.sql`:

```sql
-- 05_search_palette_explain
-- Asserts that the trial title trigram index is actually used by a representative query.

do $$
declare
  v_user uuid;
  v_space uuid;
  v_plan jsonb;
  v_uses_trgm boolean := false;
begin
  select user_id, space_id into v_user, v_space
  from public.space_members order by created_at asc limit 1;
  if v_user is null then raise notice 'no seed; skip'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  execute 'explain (format json) select * from public.trials where space_id = $1 and title % $2'
  into v_plan
  using v_space, 'KEY';

  -- recursively walk the plan looking for any node that references trials_title_trgm
  v_uses_trgm := position('trials_title_trgm' in v_plan::text) > 0;
  if not v_uses_trgm then
    raise exception 'trials title trigram query did not use trials_title_trgm; plan: %', v_plan;
  end if;
end $$;
```

- [ ] **Step 4: Run the tests**

Run: `bash supabase/tests/palette/run.sh`
Expected: `All palette tests passed.`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260501120100_palette_rpc_functions.sql \
        supabase/tests/palette/05_search_palette_explain.sql
git commit -m "feat(palette): pin RPCs and trigram-index regression test"
```

---

## Task 7: Palette models and prefix-token parser

**Files:**
- Create: `src/client/src/app/core/models/palette.model.ts`
- Create: `src/client/src/app/core/util/parse-prefix-token.ts`
- Create: `src/client/e2e/tests/palette-prefix-token.spec.ts`
- Modify: `src/client/playwright.unit.config.ts`

- [ ] **Step 1: Write the palette model**

Write `src/client/src/app/core/models/palette.model.ts`:

```ts
export type PaletteKind = 'company' | 'product' | 'trial' | 'catalyst' | 'event';

export type PaletteCommandKind = 'command';

export type PaletteScope = 'space' | 'all-spaces';

export type PrefixTokenChar = '>' | '@' | '#' | '!';

export interface ParsedQuery {
  token: PrefixTokenChar | null;
  term: string;
}

export interface PaletteEntityItem {
  kind: PaletteKind;
  id: string;
  name: string;
  secondary: string | null;
  score: number;
  pinned: boolean;
  recentAt: string | null;
}

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  when?: () => boolean;
  run: () => void | Promise<void>;
}

export interface PaletteCommandRow {
  kind: PaletteCommandKind;
  command: PaletteCommand;
}

export type PaletteItem = PaletteEntityItem | PaletteCommandRow;

export interface EmptyState {
  pinned: PaletteEntityItem[];
  recents: PaletteEntityItem[];
  commands: PaletteCommand[];
}
```

- [ ] **Step 2: Write a failing prefix-token test**

Write `src/client/e2e/tests/palette-prefix-token.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { parsePrefixToken } from '../../src/app/core/util/parse-prefix-token';

test.describe('parsePrefixToken', () => {
  test('returns null token for plain text', () => {
    expect(parsePrefixToken('foo')).toEqual({ token: null, term: 'foo' });
  });

  test('returns empty parse for empty string', () => {
    expect(parsePrefixToken('')).toEqual({ token: null, term: '' });
  });

  test('parses > as command token', () => {
    expect(parsePrefixToken('>switch')).toEqual({ token: '>', term: 'switch' });
  });

  test('parses @ as company token', () => {
    expect(parsePrefixToken('@bms')).toEqual({ token: '@', term: 'bms' });
  });

  test('parses # as trial token', () => {
    expect(parsePrefixToken('#KEYNOTE')).toEqual({ token: '#', term: 'KEYNOTE' });
  });

  test('parses ! as catalyst token', () => {
    expect(parsePrefixToken('!q3')).toEqual({ token: '!', term: 'q3' });
  });

  test('returns empty term when only the token is typed', () => {
    expect(parsePrefixToken('>')).toEqual({ token: '>', term: '' });
  });

  test('preserves case in term', () => {
    expect(parsePrefixToken('#NCT02578680')).toEqual({ token: '#', term: 'NCT02578680' });
  });

  test('only treats the prefix when it is the first character', () => {
    expect(parsePrefixToken('a>b')).toEqual({ token: null, term: 'a>b' });
  });
});
```

- [ ] **Step 3: Add the new spec to the unit testMatch**

Edit `src/client/playwright.unit.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/tests',
  testMatch: [
    'grid-url-codec.spec.ts',
    'grid-filter-algebra.spec.ts',
    'palette-prefix-token.spec.ts',
    'palette-hotkey.spec.ts',
    'palette-service-debounce.spec.ts',
    'palette-command-registry.spec.ts',
  ],
  reporter: [['list']],
  fullyParallel: true,
});
```

- [ ] **Step 4: Run the failing test**

Run: `cd src/client && npx playwright test --config=playwright.unit.config.ts -g parsePrefixToken`
Expected: FAIL because `parse-prefix-token.ts` does not exist yet.

- [ ] **Step 5: Implement parsePrefixToken**

Write `src/client/src/app/core/util/parse-prefix-token.ts`:

```ts
import type { ParsedQuery, PrefixTokenChar } from '../models/palette.model';

const TOKENS = new Set<PrefixTokenChar>(['>', '@', '#', '!']);

export function parsePrefixToken(input: string): ParsedQuery {
  if (!input) {
    return { token: null, term: '' };
  }
  const first = input.charAt(0) as PrefixTokenChar;
  if (TOKENS.has(first)) {
    return { token: first, term: input.slice(1) };
  }
  return { token: null, term: input };
}
```

- [ ] **Step 6: Run the test, expect it to pass**

Run: `cd src/client && npx playwright test --config=playwright.unit.config.ts -g parsePrefixToken`
Expected: 9 passed.

- [ ] **Step 7: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 8: Commit**

```bash
git add src/client/src/app/core/models/palette.model.ts \
        src/client/src/app/core/util/parse-prefix-token.ts \
        src/client/e2e/tests/palette-prefix-token.spec.ts \
        src/client/playwright.unit.config.ts
git commit -m "feat(palette): models and parsePrefixToken util"
```

---

## Task 8: PaletteHotkeyService

**Files:**
- Create: `src/client/src/app/core/services/palette-hotkey.service.ts`
- Create: `src/client/e2e/tests/palette-hotkey.spec.ts`

- [ ] **Step 1: Write the failing test**

Write `src/client/e2e/tests/palette-hotkey.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { shouldOpenPalette } from '../../src/app/core/services/palette-hotkey.service';

// Helper: build a fake KeyboardEvent target
function targetWith(tag: string, contentEditable = false): EventTarget {
  return {
    tagName: tag.toUpperCase(),
    isContentEditable: contentEditable,
    nodeType: 1,
  } as unknown as EventTarget;
}

test.describe('shouldOpenPalette', () => {
  test('Cmd+K opens', () => {
    const ev = { key: 'k', metaKey: true, ctrlKey: false, target: targetWith('body') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(true);
  });

  test('Ctrl+K opens', () => {
    const ev = { key: 'k', metaKey: false, ctrlKey: true, target: targetWith('body') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(true);
  });

  test('/ opens when target is body', () => {
    const ev = { key: '/', metaKey: false, ctrlKey: false, target: targetWith('body') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(true);
  });

  test('/ does NOT open when target is INPUT', () => {
    const ev = { key: '/', metaKey: false, ctrlKey: false, target: targetWith('input') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(false);
  });

  test('/ does NOT open when target is TEXTAREA', () => {
    const ev = { key: '/', metaKey: false, ctrlKey: false, target: targetWith('textarea') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(false);
  });

  test('/ does NOT open when target is contentEditable', () => {
    const ev = { key: '/', metaKey: false, ctrlKey: false, target: targetWith('div', true) } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(false);
  });

  test('Cmd+K opens even from inside an input (lets users escape from text fields)', () => {
    const ev = { key: 'k', metaKey: true, ctrlKey: false, target: targetWith('input') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(true);
  });

  test('plain k does nothing', () => {
    const ev = { key: 'k', metaKey: false, ctrlKey: false, target: targetWith('body') } as unknown as KeyboardEvent;
    expect(shouldOpenPalette(ev)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd src/client && npx playwright test --config=playwright.unit.config.ts -g shouldOpenPalette`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the service and helper**

Write `src/client/src/app/core/services/palette-hotkey.service.ts`:

```ts
import { Injectable, NgZone, inject, signal } from '@angular/core';

/**
 * Pure decision function for whether a keyboard event should open the palette.
 * Exported separately so it can be unit-tested without DI.
 */
export function shouldOpenPalette(ev: KeyboardEvent): boolean {
  const key = (ev.key ?? '').toLowerCase();
  const isCmdK = key === 'k' && (ev.metaKey || ev.ctrlKey);
  if (isCmdK) return true;

  if (key === '/') {
    const target = ev.target as { tagName?: string; isContentEditable?: boolean } | null;
    const tag = (target?.tagName ?? '').toUpperCase();
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return false;
    return true;
  }
  return false;
}

@Injectable({ providedIn: 'root' })
export class PaletteHotkeyService {
  private readonly zone = inject(NgZone);
  readonly isOpen = signal(false);

  constructor() {
    this.zone.runOutsideAngular(() => {
      document.addEventListener('keydown', this.onKeydown, { capture: false });
    });
  }

  private readonly onKeydown = (ev: KeyboardEvent) => {
    if (this.isOpen() && ev.key === 'Escape') {
      this.zone.run(() => this.isOpen.set(false));
      ev.preventDefault();
      return;
    }
    if (shouldOpenPalette(ev)) {
      this.zone.run(() => this.isOpen.set(true));
      ev.preventDefault();
    }
  };

  open() { this.isOpen.set(true); }
  close() { this.isOpen.set(false); }
  toggle() { this.isOpen.update((v) => !v); }
}
```

- [ ] **Step 4: Run the test, expect pass**

Run: `cd src/client && npx playwright test --config=playwright.unit.config.ts -g shouldOpenPalette`
Expected: 8 passed.

- [ ] **Step 5: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/palette-hotkey.service.ts \
        src/client/e2e/tests/palette-hotkey.spec.ts
git commit -m "feat(palette): hotkey service with Cmd+K and / detection"
```

---

## Task 9: PaletteCommandRegistry with `when()` filtering

**Files:**
- Create: `src/client/src/app/core/services/palette-command.registry.ts`
- Create: `src/client/e2e/tests/palette-command-registry.spec.ts`

- [ ] **Step 1: Write the failing test**

Write `src/client/e2e/tests/palette-command-registry.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { filterCommands } from '../../src/app/core/services/palette-command.registry';
import type { PaletteCommand } from '../../src/app/core/models/palette.model';

const noop = () => undefined;

test.describe('filterCommands', () => {
  test('keeps commands without a when() predicate', () => {
    const cmds: PaletteCommand[] = [{ id: 'a', label: 'A', run: noop }];
    expect(filterCommands(cmds)).toHaveLength(1);
  });

  test('filters out commands whose when() returns false', () => {
    const cmds: PaletteCommand[] = [
      { id: 'a', label: 'A', run: noop },
      { id: 'b', label: 'B', when: () => false, run: noop },
    ];
    const out = filterCommands(cmds);
    expect(out.map((c) => c.id)).toEqual(['a']);
  });

  test('keeps commands whose when() returns true', () => {
    const cmds: PaletteCommand[] = [
      { id: 'a', label: 'A', when: () => true, run: noop },
    ];
    expect(filterCommands(cmds)).toHaveLength(1);
  });

  test('caps results to 8 entries', () => {
    const cmds: PaletteCommand[] = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, label: `C${i}`, run: noop,
    }));
    expect(filterCommands(cmds)).toHaveLength(8);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd src/client && npx playwright test --config=playwright.unit.config.ts -g filterCommands`
Expected: FAIL.

- [ ] **Step 3: Implement the registry**

Write `src/client/src/app/core/services/palette-command.registry.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PaletteCommand } from '../models/palette.model';
import { SupabaseService } from './supabase.service';
import { SpaceService } from './space.service';

const MAX_COMMANDS = 8;

export function filterCommands(cmds: PaletteCommand[]): PaletteCommand[] {
  return cmds.filter((c) => (c.when ? !!c.when() : true)).slice(0, MAX_COMMANDS);
}

@Injectable({ providedIn: 'root' })
export class PaletteCommandRegistry {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  private readonly spaces = inject(SpaceService);

  list(currentTenantId: string, currentSpaceId: string): PaletteCommand[] {
    const cmds: PaletteCommand[] = [
      {
        id: 'go-timeline',
        label: 'Go to Timeline',
        hint: 'Navigation',
        run: () => this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}`),
      },
      {
        id: 'go-bullseye',
        label: 'Go to Bullseye',
        hint: 'Navigation',
        run: () => this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/bullseye/by-therapy-area`),
      },
      {
        id: 'go-positioning',
        label: 'Go to Positioning',
        hint: 'Navigation',
        run: () => this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/positioning/by-moa`),
      },
      {
        id: 'go-catalysts',
        label: 'Go to Catalysts',
        hint: 'Navigation',
        run: () => this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/catalysts`),
      },
      {
        id: 'go-events',
        label: 'Go to Events',
        hint: 'Navigation',
        run: () => this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/events`),
      },
      {
        id: 'go-spaces',
        label: 'Switch space...',
        hint: 'Navigation',
        when: () => (this.spaces.spaces?.()?.length ?? 0) > 1,
        run: () => this.router.navigateByUrl(`/t/${currentTenantId}/spaces`),
      },
      {
        id: 'go-tenant-settings',
        label: 'Tenant settings',
        hint: 'Navigation',
        run: () => this.router.navigateByUrl(`/t/${currentTenantId}/settings`),
      },
      {
        id: 'sign-out',
        label: 'Sign out',
        hint: 'Account',
        run: async () => {
          await this.supabase.client.auth.signOut();
          this.router.navigateByUrl('/login');
        },
      },
    ];
    return filterCommands(cmds);
  }
}
```

Note on `SpaceService`: this plan assumes a `spaces()` signal. If the API differs, swap the `when()` predicate for the equivalent: it returns `true` only when the user has more than one space. Inspect `src/client/src/app/core/services/space.service.ts` to confirm the exact accessor before pasting this in.

- [ ] **Step 4: Run the test, expect pass**

Run: `cd src/client && npx playwright test --config=playwright.unit.config.ts -g filterCommands`
Expected: 4 passed.

- [ ] **Step 5: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed. If `npm run lint` complains about `SpaceService.spaces` shape, adjust the `when()` predicate to match the actual accessor (e.g., a method `getSpaces()` or a different signal name).

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/palette-command.registry.ts \
        src/client/e2e/tests/palette-command-registry.spec.ts
git commit -m "feat(palette): command registry with when() filtering"
```

---

## Task 10: PaletteService (state, debounce, RPC integration)

**Files:**
- Create: `src/client/src/app/core/services/palette.service.ts`
- Create: `src/client/e2e/tests/palette-service-debounce.spec.ts`

- [ ] **Step 1: Write the failing test for debounce coalescing**

Write `src/client/e2e/tests/palette-service-debounce.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { coalesceQuery } from '../../src/app/core/services/palette.service';

test.describe('coalesceQuery', () => {
  test('emits the last query after the debounce window', async () => {
    const calls: string[] = [];
    const debounced = coalesceQuery(80, (q) => { calls.push(q); });
    debounced('a');
    debounced('ab');
    debounced('abc');
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toEqual(['abc']);
  });

  test('emits multiple times when calls are spaced beyond the window', async () => {
    const calls: string[] = [];
    const debounced = coalesceQuery(40, (q) => { calls.push(q); });
    debounced('first');
    await new Promise((r) => setTimeout(r, 100));
    debounced('second');
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toEqual(['first', 'second']);
  });
});
```

- [ ] **Step 2: Run, expect fail**

Run: `cd src/client && npx playwright test --config=playwright.unit.config.ts -g coalesceQuery`
Expected: FAIL.

- [ ] **Step 3: Implement PaletteService**

Write `src/client/src/app/core/services/palette.service.ts`:

```ts
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import {
  EmptyState,
  PaletteCommand,
  PaletteEntityItem,
  PaletteItem,
  PaletteKind,
  PaletteScope,
  ParsedQuery,
} from '../models/palette.model';
import { parsePrefixToken } from '../util/parse-prefix-token';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 80;

export function coalesceQuery(ms: number, fn: (q: string) => void): (q: string) => void {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  return (q: string) => {
    last = q;
    if (handle) clearTimeout(handle);
    handle = setTimeout(() => { handle = null; fn(last); }, ms);
  };
}

function tokenToKind(t: ParsedQuery['token']): PaletteKind | null {
  switch (t) {
    case '@': return 'company';
    case '#': return 'trial';
    case '!': return 'catalyst';
    case '>': return null; // commands handled client-side
    default:  return null;
  }
}

@Injectable({ providedIn: 'root' })
export class PaletteService {
  private readonly supabase = inject(SupabaseService);

  readonly isOpen = signal(false);
  readonly query = signal('');
  readonly scope = signal<PaletteScope>('space');
  readonly selectedIndex = signal(0);
  readonly isLoading = signal(false);
  readonly results = signal<PaletteItem[]>([]);
  readonly emptyState = signal<EmptyState>({ pinned: [], recents: [], commands: [] });

  readonly parsedQuery = computed<ParsedQuery>(() => parsePrefixToken(this.query()));

  private currentSpaceId: string | null = null;
  private commandsProvider: (() => PaletteCommand[]) | null = null;
  private readonly fire = coalesceQuery(DEBOUNCE_MS, (q) => this.search(q));

  setCommandsProvider(p: () => PaletteCommand[]) { this.commandsProvider = p; }

  open(spaceId: string) {
    this.currentSpaceId = spaceId;
    this.query.set('');
    this.selectedIndex.set(0);
    this.results.set([]);
    this.isOpen.set(true);
    void this.loadEmptyState();
  }

  close() {
    this.isOpen.set(false);
  }

  setQuery(q: string) {
    this.query.set(q);
    this.selectedIndex.set(0);
    const parsed = parsePrefixToken(q);
    if (parsed.token === '>') {
      this.results.set(this.commandsAsRows(parsed.term));
      this.isLoading.set(false);
      return;
    }
    if (parsed.term.length < MIN_QUERY) {
      this.results.set([]);
      this.isLoading.set(false);
      return;
    }
    this.isLoading.set(true);
    this.fire(q);
  }

  moveSelection(delta: number) {
    const len = this.results().length;
    if (len === 0) return;
    const next = (this.selectedIndex() + delta + len) % len;
    this.selectedIndex.set(next);
  }

  selectIndex(i: number) {
    this.selectedIndex.set(Math.max(0, Math.min(i, this.results().length - 1)));
  }

  selectedItem(): PaletteItem | null {
    return this.results()[this.selectedIndex()] ?? null;
  }

  private async loadEmptyState() {
    if (!this.currentSpaceId) return;
    const { data, error } = await this.supabase.client.rpc('palette_empty_state', {
      p_space_id: this.currentSpaceId,
    });
    if (error) { console.error('palette_empty_state', error); return; }
    const payload = (data ?? { pinned: [], recents: [] }) as { pinned: PaletteEntityItem[]; recents: PaletteEntityItem[] };
    this.emptyState.set({
      pinned: payload.pinned ?? [],
      recents: payload.recents ?? [],
      commands: this.commandsProvider?.() ?? [],
    });
  }

  private async search(rawQuery: string) {
    if (!this.currentSpaceId) return;
    const parsed = parsePrefixToken(rawQuery);
    const kind = tokenToKind(parsed.token);
    const term = parsed.term;
    if (term.length < MIN_QUERY) {
      this.results.set([]);
      this.isLoading.set(false);
      return;
    }
    const { data, error } = await this.supabase.client.rpc('search_palette', {
      p_space_id: this.currentSpaceId,
      p_query: term,
      p_kind: kind,
      p_limit: 25,
    });
    this.isLoading.set(false);
    if (error) { console.error('search_palette', error); this.results.set([]); return; }
    const items: PaletteEntityItem[] = (data ?? []).map((r: any) => ({
      kind: r.kind,
      id: r.id,
      name: r.name,
      secondary: r.secondary,
      score: r.score,
      pinned: !!r.pinned,
      recentAt: r.recent_at,
    }));
    this.results.set(items);
    this.selectedIndex.set(0);
  }

  private commandsAsRows(term: string): PaletteItem[] {
    const all = this.commandsProvider?.() ?? [];
    const t = term.toLowerCase();
    const filtered = t ? all.filter((c) => c.label.toLowerCase().includes(t)) : all;
    return filtered.map((c) => ({ kind: 'command' as const, command: c }));
  }
}
```

- [ ] **Step 4: Run the debounce test, expect pass**

Run: `cd src/client && npx playwright test --config=playwright.unit.config.ts -g coalesceQuery`
Expected: 2 passed.

- [ ] **Step 5: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/palette.service.ts \
        src/client/e2e/tests/palette-service-debounce.spec.ts
git commit -m "feat(palette): PaletteService with debounce and RPC wiring"
```

---

## Task 11: PaletteRecentsService and PalettePinService

**Files:**
- Create: `src/client/src/app/core/services/palette-recents.service.ts`
- Create: `src/client/src/app/core/services/palette-pin.service.ts`

- [ ] **Step 1: Implement PaletteRecentsService**

Write `src/client/src/app/core/services/palette-recents.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SupabaseService } from './supabase.service';
import { PaletteKind } from '../models/palette.model';

interface ParsedRoute { kind: PaletteKind; spaceId: string; entityId: string; }

const PATTERNS: Array<{ re: RegExp; kind: PaletteKind }> = [
  { re: /\/t\/[^/]+\/s\/([^/]+)\/manage\/trials\/([0-9a-f-]{36})/, kind: 'trial' },
  { re: /\/t\/[^/]+\/s\/([^/]+)\/manage\/products\/([0-9a-f-]{36})/, kind: 'product' },
  { re: /\/t\/[^/]+\/s\/([^/]+)\/manage\/companies\/([0-9a-f-]{36})/, kind: 'company' },
];

function parseEntityRoute(url: string): ParsedRoute | null {
  for (const p of PATTERNS) {
    const m = url.match(p.re);
    if (m) return { kind: p.kind, spaceId: m[1], entityId: m[2] };
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class PaletteRecentsService {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);

  init() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const parsed = parseEntityRoute(e.urlAfterRedirects);
        if (!parsed) return;
        void this.touch(parsed);
      });
  }

  async touch(p: ParsedRoute) {
    const { error } = await this.supabase.client.rpc('palette_touch_recent', {
      p_space_id: p.spaceId,
      p_kind: p.kind,
      p_entity_id: p.entityId,
    });
    if (error) console.error('palette_touch_recent', error);
  }
}
```

Note: catalysts and events are surfaced via panels rather than dedicated routes. They are bumped from inside the palette when activated (see Task 16, where `CommandPaletteComponent` calls `recents.touch()` directly after navigation). The router-level path covers the cases where users navigate to those entities directly (manage trials/products/companies).

- [ ] **Step 2: Implement PalettePinService**

Write `src/client/src/app/core/services/palette-pin.service.ts`:

```ts
import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { PaletteEntityItem, PaletteKind } from '../models/palette.model';

@Injectable({ providedIn: 'root' })
export class PalettePinService {
  private readonly supabase = inject(SupabaseService);
  readonly pinnedVersion = signal(0);

  async pin(spaceId: string, kind: PaletteKind, entityId: string, position = 0) {
    const { error } = await this.supabase.client.rpc('palette_set_pinned', {
      p_space_id: spaceId, p_kind: kind, p_entity_id: entityId, p_position: position,
    });
    if (error) { console.error('palette_set_pinned', error); return; }
    this.pinnedVersion.update((v) => v + 1);
  }

  async unpin(spaceId: string, kind: PaletteKind, entityId: string) {
    const { error } = await this.supabase.client.rpc('palette_unpin', {
      p_space_id: spaceId, p_kind: kind, p_entity_id: entityId,
    });
    if (error) { console.error('palette_unpin', error); return; }
    this.pinnedVersion.update((v) => v + 1);
  }

  async toggle(spaceId: string, item: PaletteEntityItem) {
    if (item.pinned) await this.unpin(spaceId, item.kind, item.id);
    else await this.pin(spaceId, item.kind, item.id);
  }
}
```

- [ ] **Step 3: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/services/palette-recents.service.ts \
        src/client/src/app/core/services/palette-pin.service.ts
git commit -m "feat(palette): recents and pin services"
```

---

## Task 12: PaletteResultRowComponent (presenter)

**Files:**
- Create: `src/client/src/app/core/layout/command-palette/palette-result-row.component.ts`

- [ ] **Step 1: Write the component**

Write `src/client/src/app/core/layout/command-palette/palette-result-row.component.ts`:

```ts
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { PaletteItem } from '../../models/palette.model';

@Component({
  selector: 'app-palette-result-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      role="option"
      [attr.id]="rowId()"
      [attr.aria-selected]="selected()"
      class="flex w-full items-center gap-3 px-4 py-2 text-left text-sm"
      [class.bg-slate-100]="selected()"
      (mouseenter)="hover.emit()"
      (click)="activate.emit()"
    >
      <span class="h-3.5 w-3.5 shrink-0 rounded-sm" [style.background-color]="kindColor()"></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-slate-900">{{ primary() }}</span>
        @if (secondary()) {
          <span class="block truncate font-mono text-[11px] text-slate-500">{{ secondary() }}</span>
        }
      </span>
      <span class="ml-auto shrink-0 font-mono text-[11px] uppercase tracking-wide text-slate-500">
        {{ kindLabel() }}
      </span>
    </button>
  `,
})
export class PaletteResultRowComponent {
  readonly item = input.required<PaletteItem>();
  readonly selected = input<boolean>(false);
  readonly index = input<number>(0);
  readonly hover = output<void>();
  readonly activate = output<void>();

  rowId() { return `palette-row-${this.index()}`; }

  primary() {
    const it = this.item();
    return it.kind === 'command' ? it.command.label : it.name;
  }
  secondary() {
    const it = this.item();
    if (it.kind === 'command') return it.command.hint ?? null;
    return it.secondary;
  }
  kindLabel() {
    const it = this.item();
    if (it.kind === 'command') return 'Command';
    return it.kind.charAt(0).toUpperCase() + it.kind.slice(1);
  }
  kindColor() {
    const it = this.item();
    switch (it.kind) {
      case 'trial':    return '#0f766e';
      case 'product':  return '#0891b2';
      case 'company':  return '#475569';
      case 'event':    return '#ea580c';
      case 'catalyst': return '#16a34a';
      case 'command':  return '#7c3aed';
    }
  }
}
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/layout/command-palette/palette-result-row.component.ts
git commit -m "feat(palette): result row presenter component"
```

---

## Task 13: PaletteEmptyStateComponent

**Files:**
- Create: `src/client/src/app/core/layout/command-palette/palette-empty-state.component.ts`

- [ ] **Step 1: Write the component**

Write `src/client/src/app/core/layout/command-palette/palette-empty-state.component.ts`:

```ts
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { PaletteResultRowComponent } from './palette-result-row.component';
import { EmptyState, PaletteItem } from '../../models/palette.model';

@Component({
  selector: 'app-palette-empty-state',
  standalone: true,
  imports: [PaletteResultRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (state().pinned.length > 0) {
      <div class="border-b border-slate-100 py-2">
        <div class="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Pinned</div>
        @for (p of state().pinned; track p.id; let i = $index) {
          <app-palette-result-row
            [item]="p"
            [index]="i"
            [selected]="selectedFlatIndex() === i"
            (hover)="select.emit(i)"
            (activate)="activate.emit({ index: i, item: p })"
          />
        }
      </div>
    }
    @if (state().recents.length > 0) {
      <div class="border-b border-slate-100 py-2">
        <div class="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Recent</div>
        @for (r of state().recents; track r.id; let i = $index) {
          <app-palette-result-row
            [item]="r"
            [index]="state().pinned.length + i"
            [selected]="selectedFlatIndex() === state().pinned.length + i"
            (hover)="select.emit(state().pinned.length + i)"
            (activate)="activate.emit({ index: state().pinned.length + i, item: r })"
          />
        }
      </div>
    }
    @if (state().commands.length > 0) {
      <div class="py-2">
        <div class="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Commands</div>
        @for (c of state().commands; track c.id; let i = $index) {
          <app-palette-result-row
            [item]="{ kind: 'command', command: c }"
            [index]="state().pinned.length + state().recents.length + i"
            [selected]="selectedFlatIndex() === state().pinned.length + state().recents.length + i"
            (hover)="select.emit(state().pinned.length + state().recents.length + i)"
            (activate)="activate.emit({ index: state().pinned.length + state().recents.length + i, item: { kind: 'command', command: c } })"
          />
        }
      </div>
    }
    @if (state().pinned.length === 0 && state().recents.length === 0 && state().commands.length === 0) {
      <div class="px-4 py-8 text-center text-sm text-slate-400">Start typing to search</div>
    }
  `,
})
export class PaletteEmptyStateComponent {
  readonly state = input.required<EmptyState>();
  readonly selectedFlatIndex = input<number>(0);
  readonly select = output<number>();
  readonly activate = output<{ index: number; item: PaletteItem }>();
}
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/layout/command-palette/palette-empty-state.component.ts
git commit -m "feat(palette): empty-state component (pinned + recents + commands)"
```

---

## Task 14: PaletteResultListComponent

**Files:**
- Create: `src/client/src/app/core/layout/command-palette/palette-result-list.component.ts`

- [ ] **Step 1: Write the component**

Write `src/client/src/app/core/layout/command-palette/palette-result-list.component.ts`:

```ts
import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';
import { PaletteResultRowComponent } from './palette-result-row.component';
import { PaletteItem } from '../../models/palette.model';

@Component({
  selector: 'app-palette-result-list',
  standalone: true,
  imports: [PaletteResultRowComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (loading()) {
      <div class="px-4 py-2 text-[11px] text-slate-400">Searching...</div>
    }
    @if (!loading() && items().length === 0) {
      <div class="px-4 py-8 text-center text-sm text-slate-400">
        No matches in {{ scopeLabel() }}.
      </div>
    }
    <ul role="listbox" id="palette-results" class="max-h-[60vh] overflow-y-auto">
      @for (it of items(); track trackKey(it, $index); let i = $index) {
        <li>
          <app-palette-result-row
            [item]="it"
            [index]="i"
            [selected]="selectedIndex() === i"
            (hover)="select.emit(i)"
            (activate)="activate.emit({ index: i, item: it })"
          />
        </li>
      }
    </ul>
  `,
})
export class PaletteResultListComponent {
  readonly items = input.required<PaletteItem[]>();
  readonly selectedIndex = input<number>(0);
  readonly loading = input<boolean>(false);
  readonly scopeLabel = input<string>('');
  readonly select = output<number>();
  readonly activate = output<{ index: number; item: PaletteItem }>();

  trackKey(item: PaletteItem, index: number) {
    return item.kind === 'command' ? `cmd:${item.command.id}` : `${item.kind}:${item.id}:${index}`;
  }
}
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/layout/command-palette/palette-result-list.component.ts
git commit -m "feat(palette): result list component with loading and empty states"
```

---

## Task 15: PaletteSearchInputComponent

**Files:**
- Create: `src/client/src/app/core/layout/command-palette/palette-search-input.component.ts`

- [ ] **Step 1: Write the component**

Write `src/client/src/app/core/layout/command-palette/palette-search-input.component.ts`:

```ts
import { Component, ChangeDetectionStrategy, input, output, ElementRef, viewChild, AfterViewInit } from '@angular/core';
import { ParsedQuery, PaletteScope } from '../../models/palette.model';

@Component({
  selector: 'app-palette-search-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
      <span class="rounded-sm bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-900">
        {{ scopeChipLabel() }}
      </span>
      <input
        #input
        type="text"
        autocomplete="off"
        spellcheck="false"
        aria-controls="palette-results"
        [attr.aria-activedescendant]="activeDescendantId()"
        [value]="query()"
        (input)="queryChange.emit(($any($event.target)).value)"
        (keydown)="onKeydown($event)"
        class="flex-1 bg-transparent font-mono text-sm text-slate-900 outline-none placeholder:text-slate-400"
        placeholder="Search..."
      />
    </div>
  `,
})
export class PaletteSearchInputComponent implements AfterViewInit {
  readonly query = input<string>('');
  readonly parsed = input<ParsedQuery>({ token: null, term: '' });
  readonly scope = input<PaletteScope>('space');
  readonly scopeName = input<string>('');
  readonly activeDescendantId = input<string | null>(null);

  readonly queryChange = output<string>();
  readonly arrow = output<'up' | 'down' | 'home' | 'end'>();
  readonly enter = output<{ withModifier: boolean }>();
  readonly escape = output<void>();
  readonly tab = output<void>();
  readonly togglePin = output<void>();

  private readonly inputRef = viewChild.required<ElementRef<HTMLInputElement>>('input');

  ngAfterViewInit(): void {
    queueMicrotask(() => this.inputRef().nativeElement.focus());
  }

  scopeChipLabel(): string {
    const tokenSuffix = (() => {
      switch (this.parsed().token) {
        case '>': return ' / Commands';
        case '@': return ' / Companies';
        case '#': return ' / Trials';
        case '!': return ' / Catalysts';
        default:  return '';
      }
    })();
    const base = this.scope() === 'all-spaces' ? 'All spaces' : (this.scopeName() || 'Space');
    return base + tokenSuffix;
  }

  onKeydown(ev: KeyboardEvent) {
    switch (ev.key) {
      case 'ArrowUp':   ev.preventDefault(); this.arrow.emit('up'); break;
      case 'ArrowDown': ev.preventDefault(); this.arrow.emit('down'); break;
      case 'Home':      ev.preventDefault(); this.arrow.emit('home'); break;
      case 'End':       ev.preventDefault(); this.arrow.emit('end'); break;
      case 'Enter':     ev.preventDefault(); this.enter.emit({ withModifier: ev.metaKey || ev.ctrlKey }); break;
      case 'Escape':    ev.preventDefault(); this.escape.emit(); break;
      case 'Tab':       ev.preventDefault(); this.tab.emit(); break;
      case 'p':
      case 'P':
        if ((ev.metaKey || ev.ctrlKey) && ev.shiftKey) {
          ev.preventDefault();
          this.togglePin.emit();
        }
        break;
    }
  }
}
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/layout/command-palette/palette-search-input.component.ts
git commit -m "feat(palette): search input with scope chip and keybindings"
```

---

## Task 16: CommandPaletteComponent (modal shell + glue)

**Files:**
- Create: `src/client/src/app/core/layout/command-palette/command-palette.component.ts`

- [ ] **Step 1: Write the component**

Write `src/client/src/app/core/layout/command-palette/command-palette.component.ts`:

```ts
import {
  Component, ChangeDetectionStrategy, OnInit, OnDestroy, effect, inject, signal, computed,
} from '@angular/core';
import { Router, ActivatedRoute, NavigationEnd } from '@angular/router';
import { filter } from 'rxjs/operators';
import { PaletteService } from '../../services/palette.service';
import { PaletteHotkeyService } from '../../services/palette-hotkey.service';
import { PaletteCommandRegistry } from '../../services/palette-command.registry';
import { PaletteRecentsService } from '../../services/palette-recents.service';
import { PalettePinService } from '../../services/palette-pin.service';
import { SpaceService } from '../../services/space.service';
import { PaletteSearchInputComponent } from './palette-search-input.component';
import { PaletteEmptyStateComponent } from './palette-empty-state.component';
import { PaletteResultListComponent } from './palette-result-list.component';
import { PaletteEntityItem, PaletteItem, PaletteKind } from '../../models/palette.model';

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [PaletteSearchInputComponent, PaletteEmptyStateComponent, PaletteResultListComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (hotkey.isOpen()) {
      <div class="fixed inset-0 z-[1000]" role="dialog" aria-modal="true" aria-labelledby="palette-title">
        <button
          type="button"
          aria-label="Close palette"
          class="absolute inset-0 cursor-default bg-slate-900/40"
          (click)="close()"
        ></button>
        <div class="absolute left-1/2 top-[15vh] w-[560px] max-w-[92vw] -translate-x-1/2 rounded-md border border-slate-200 bg-white shadow-2xl">
          <h2 id="palette-title" class="sr-only">Search</h2>
          <app-palette-search-input
            [query]="palette.query()"
            [parsed]="palette.parsedQuery()"
            [scope]="palette.scope()"
            [scopeName]="spaceShortName()"
            [activeDescendantId]="activeDescendantId()"
            (queryChange)="palette.setQuery($event)"
            (arrow)="onArrow($event)"
            (enter)="onEnter($event.withModifier)"
            (escape)="close()"
            (tab)="toggleScope()"
            (togglePin)="togglePinOnSelected()"
          />
          @if (palette.query().length === 0) {
            <app-palette-empty-state
              [state]="palette.emptyState()"
              [selectedFlatIndex]="palette.selectedIndex()"
              (select)="palette.selectIndex($event)"
              (activate)="onActivate($event)"
            />
          } @else {
            <app-palette-result-list
              [items]="palette.results()"
              [selectedIndex]="palette.selectedIndex()"
              [loading]="palette.isLoading()"
              [scopeLabel]="spaceShortName()"
              (select)="palette.selectIndex($event)"
              (activate)="onActivate($event)"
            />
          }
          <div class="sr-only" aria-live="polite">{{ liveMessage() }}</div>
        </div>
      </div>
    }
  `,
})
export class CommandPaletteComponent implements OnInit, OnDestroy {
  readonly palette = inject(PaletteService);
  readonly hotkey = inject(PaletteHotkeyService);
  private readonly registry = inject(PaletteCommandRegistry);
  private readonly recents = inject(PaletteRecentsService);
  private readonly pins = inject(PalettePinService);
  private readonly spaceSvc = inject(SpaceService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly spaceShortName = signal<string>('');
  private spaceId: string | null = null;
  private tenantId: string | null = null;

  readonly liveMessage = computed(() => {
    const n = this.palette.results().length;
    return this.palette.query().length === 0 ? '' : `${n} ${n === 1 ? 'result' : 'results'}`;
  });

  readonly activeDescendantId = computed(() => {
    const i = this.palette.selectedIndex();
    return this.palette.query().length === 0 || this.palette.results().length === 0
      ? null
      : `palette-row-${i}`;
  });

  // effect() must run in an injection context; field initializers are valid.
  private readonly _syncOpen = effect(() => {
    if (this.hotkey.isOpen() && this.spaceId) {
      this.palette.open(this.spaceId);
    } else if (!this.hotkey.isOpen()) {
      this.palette.close();
    }
  });

  ngOnInit(): void {
    this.recents.init();
    this.palette.setCommandsProvider(() => {
      if (!this.tenantId || !this.spaceId) return [];
      return this.registry.list(this.tenantId, this.spaceId);
    });

    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this.captureRouteContext();
        this.close();
      });
    this.captureRouteContext();
  }

  ngOnDestroy(): void {}

  private captureRouteContext() {
    let r: ActivatedRoute | null = this.route;
    let tenantId: string | null = null;
    let spaceId: string | null = null;
    while (r) {
      const ps = r.snapshot.paramMap;
      if (ps.has('tenantId')) tenantId = ps.get('tenantId');
      if (ps.has('spaceId')) spaceId = ps.get('spaceId');
      r = r.firstChild;
    }
    this.tenantId = tenantId;
    this.spaceId = spaceId;
    const space = this.spaceSvc.spaces?.()?.find((s: any) => s.id === spaceId);
    this.spaceShortName.set(space?.short_name ?? space?.name ?? '');
  }

  close() { this.hotkey.close(); }

  toggleScope() {
    this.palette.scope.update((s) => (s === 'space' ? 'all-spaces' : 'space'));
  }

  onArrow(dir: 'up' | 'down' | 'home' | 'end') {
    if (dir === 'up')   this.palette.moveSelection(-1);
    if (dir === 'down') this.palette.moveSelection(+1);
    if (dir === 'home') this.palette.selectIndex(0);
    if (dir === 'end')  this.palette.selectIndex(this.palette.results().length - 1);
  }

  onEnter(withModifier: boolean) {
    const sel = this.palette.selectedItem();
    if (!sel) return;
    void this.activate(sel, withModifier);
  }

  onActivate(payload: { index: number; item: PaletteItem }) {
    void this.activate(payload.item, false);
  }

  private async activate(item: PaletteItem, withModifier: boolean) {
    if (item.kind === 'command') {
      this.close();
      await item.command.run();
      return;
    }
    const url = this.urlForEntity(item);
    if (!url) return;
    if (withModifier) {
      window.open(url, '_blank', 'noopener');
      this.close();
    } else {
      this.close();
      await this.router.navigateByUrl(url);
    }
    if (this.spaceId) {
      void this.recents.touch({ kind: item.kind, spaceId: this.spaceId, entityId: item.id });
    }
  }

  togglePinOnSelected() {
    const sel = this.palette.selectedItem();
    if (!sel || sel.kind === 'command' || !this.spaceId) return;
    void this.pins.toggle(this.spaceId, sel as PaletteEntityItem);
  }

  private urlForEntity(item: { kind: PaletteKind; id: string }): string | null {
    if (!this.tenantId || !this.spaceId) return null;
    const base = `/t/${this.tenantId}/s/${this.spaceId}`;
    switch (item.kind) {
      case 'trial':    return `${base}/manage/trials/${item.id}`;
      case 'product':  return `${base}/manage/products?selected=${item.id}`;
      case 'company':  return `${base}/manage/companies?selected=${item.id}`;
      case 'event':    return `${base}/events?eventId=${item.id}`;
      case 'catalyst': return `${base}/catalysts?id=${item.id}`;
    }
  }
}
```

Note: the URL templates for product/company/event/catalyst depend on existing route patterns. Trials have a dedicated detail page (`manage/trials/:id`). Other entities open a list page that pre-selects the entity via a query param. Inspect `src/client/src/app/features/manage/products/product-list.component.ts` and the events/catalysts pages before wiring; if any pre-selection query param is unsupported, replace that branch's URL with a plain navigation to the list page.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/layout/command-palette/command-palette.component.ts
git commit -m "feat(palette): command palette modal shell"
```

---

## Task 17: Mount in AppShellComponent

**Files:**
- Modify: `src/client/src/app/core/layout/app-shell.component.ts`

- [ ] **Step 1: Add the component to imports and template**

In `src/client/src/app/core/layout/app-shell.component.ts`:

1. Add the import at the top:

```ts
import { CommandPaletteComponent } from './command-palette/command-palette.component';
```

2. Add `CommandPaletteComponent` to the `imports` array on the `@Component` decorator.

3. Add `<app-command-palette />` once near the end of the template (after the existing dialogs but inside the shell `<div>`):

```html
<app-command-palette />
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 3: Manual smoke**

Start dev: `cd src/client && npm start`. Open `http://localhost:4200`, sign into a tenant/space. Press `Cmd+K`. Verify:

- Palette opens centered near the top.
- Empty state renders Pinned (if any), Recents, Commands.
- Type `key` - results appear within ~250ms; rows show two-line context.
- `↑/↓` navigates; `Enter` opens the entity; `Esc` closes; `/` reopens.
- Type `>` - command list shows.
- Type `#KEY` - only trial results appear.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/layout/app-shell.component.ts
git commit -m "feat(palette): mount command palette in app shell"
```

---

## Task 18: Final verification and QA pass

**Files:**
- None (verification only).

- [ ] **Step 1: Run all SQL tests**

Run: `bash supabase/tests/palette/run.sh`
Expected: `All palette tests passed.`

- [ ] **Step 2: Run all unit tests**

Run: `cd src/client && npm run test:unit`
Expected: every spec passes; total suite includes the four new palette specs plus the two existing grid specs.

- [ ] **Step 3: Lint and build**

Run: `cd src/client && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 4: Manual QA against each design decision**

Walk through every decision (D1-D7 in the spec) once in the seeded demo space:

- D1: open the palette, verify entity, navigation, and command rows all work via Enter.
- D2: verify scope chip shows space short name; press `Tab`; chip switches to "All spaces"; current results remain space-scoped (v1 behavior).
- D3: search a company, product, trial (by name), trial (by NCT id), catalyst, event - each kind appears as a row.
- D4: open palette with no query; verify Pinned (if any), Recents, Commands sections render.
- D5: verify each result row shows two lines with the secondary context line.
- D6: confirm `Cmd+K`, `Ctrl+K`, `/`, `>`, `@`, `#`, `!`, arrow keys, `Enter`, `Esc`, `Cmd+Enter`, `Cmd+Shift+P` all behave per spec.
- D7: navigate to `/admin/...` (agency portal); confirm `Cmd+K` does nothing there. Repeat in `/super-admin/...` and on the marketing landing.

- [ ] **Step 5: Final commit if any cleanup made**

If steps 1-4 surfaced minor adjustments, commit them:

```bash
git add <files>
git commit -m "chore(palette): post-QA polish"
```

If nothing changed, skip this step.

---

## Self-Review Checklist (run after the final task)

- [ ] Spec coverage: each of D1-D7 has a verification step in Task 18 and a corresponding implementation in earlier tasks.
- [ ] All `_*_trgm` indexes in Task 1 align with the trigram-using columns in Task 2's RPC.
- [ ] `search_palette` RPC parameter order in Task 2 matches the client call in Task 10 (`p_space_id`, `p_query`, `p_kind`, `p_limit`).
- [ ] `palette_touch_recent` parameter names in Task 5 match `PaletteRecentsService.touch()` in Task 11 (`p_space_id`, `p_kind`, `p_entity_id`).
- [ ] `palette_set_pinned` and `palette_unpin` parameter names in Task 6 match `PalettePinService` in Task 11.
- [ ] Component selector `app-command-palette` in Task 16 matches the tag inserted in Task 17.
- [ ] `playwright.unit.config.ts` in Task 7 lists every new spec file added later (palette-prefix-token, palette-hotkey, palette-service-debounce, palette-command-registry).
- [ ] No emojis anywhere in code, comments, or commits.
- [ ] No Claude attribution in commits.
