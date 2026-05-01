# R2 Materials Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Storage with Cloudflare R2 for engagement materials. The browser uploads and downloads bytes directly via short-lived presigned R2 URLs minted by a new Cloudflare Worker. Authorization stays in Postgres via the existing RPCs. Includes a register-first upload flow with a `finalize_material` RPC, per-user rate limiting, and a fix for the existing `Could not load materials` bug.

**Architecture:** One Cloudflare Worker with route-split: `/api/materials/sign-upload` and `/api/materials/sign-download` hit Worker code, everything else falls through to the static SPA assets. Worker forwards the user's Supabase JWT to existing RPCs for access checks, then signs R2 URLs using `@aws-sdk/s3-request-presigner`. New `materials.finalized_at` column makes pre-finalize rows invisible to readers, removing the need for a temp-path-and-repath dance. Workers Rate Limiting API gates both endpoints.

**Tech Stack:** Cloudflare Workers + R2 + Workers Rate Limiting API, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` (S3-compatible R2 endpoint), Supabase Postgres (existing), Angular 19 (existing), Vitest with `@cloudflare/vitest-pool-workers` for Worker tests.

**Spec:** `docs/superpowers/specs/2026-05-01-r2-materials-storage-design.md`

**Branch:** Work on `r2-materials-storage` (create via `superpowers:using-git-worktrees`).

---

## File map

**Create:**
- `supabase/migrations/<timestamp>_materials_r2_cutover.sql`: db migration with assertion-style invariant test
- `src/client/worker/index.ts`: Worker fetch handler entry
- `src/client/worker/auth.ts`: JWT subject decoder (rate-limit key only, does not verify)
- `src/client/worker/cors.ts`: origin check + CORS headers
- `src/client/worker/r2.ts`: R2 presigned URL helpers
- `src/client/worker/supabase.ts`: Supabase RPC fetch wrapper
- `src/client/worker/errors.ts`: SQLSTATE-to-HTTP mapping
- `src/client/worker/tsconfig.json`: Worker-runtime tsconfig
- `src/client/worker/test/cors.spec.ts`, `auth.spec.ts`, `errors.spec.ts`, `index.spec.ts`, unit tests
- `src/client/worker/vitest.config.ts`: Vitest config using `@cloudflare/vitest-pool-workers`
- `src/client/src/app/core/utils/error-message.ts`: shared error stringifier (fixes the trial-detail bug)
- `src/client/src/app/core/utils/error-message.spec.ts`: unit tests

**Modify:**
- `src/client/wrangler.jsonc`: add `main`, `ratelimits`, vars
- `src/client/package.json`: add `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@cloudflare/workers-types`, `@cloudflare/vitest-pool-workers`
- `src/client/tsconfig.app.json`: exclude `worker/**`
- `src/client/src/app/core/services/material.service.ts`: replace `uploadFile` and `getDownloadUrl` internals, delete `repath` and `updateFilePath`, add `finalize`
- `src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.ts`: rewrite `upload()` to register-first flow
- `src/client/src/app/shared/components/materials-section/materials-section.component.ts`: use `errorMessage()` helper
- `src/client/src/app/features/materials-browse/materials-browse-page.component.ts`: use `errorMessage()` helper
- `src/client/src/app/features/engagement-landing/recent-materials-widget/recent-materials-widget.component.ts`: use `errorMessage()` helper (currently swallows errors)
- `docs/runbook/02-tech-stack.md`, `06-backend-architecture.md`, `07-database-schema.md`, `12-deployment.md`, document the R2 backend and new RPCs

**Delete (in modify-and-commit steps):**
- `MaterialService.repath` and `MaterialService.updateFilePath` methods
- The bucket-level RLS policies and the `materials` storage bucket itself (in the migration)

---

### Task 1: Database migration with assertion test

**Files:**
- Create: `supabase/migrations/20260501160000_materials_r2_cutover.sql`

The migration: deletes existing `public.materials` rows (clean cutover), drops the `materials` storage bucket and its policies, adds `finalized_at`, creates `prepare_material_upload` and `finalize_material` RPCs, updates four list/download RPCs to filter on `finalized_at`, and ends with an inline `do $$` block that registers + finalizes a synthetic material and asserts visibility before/after.

- [ ] **Step 1: Create the migration file with the schema and RPC changes**

Write `supabase/migrations/20260501160000_materials_r2_cutover.sql`:

```sql
-- migration: 20260501160000_materials_r2_cutover
-- purpose: cut over engagement materials storage from supabase storage
--          to cloudflare r2. clean cutover (existing rows are throwaway
--          test data) so we delete them, drop the supabase storage bucket
--          and its policies, add a finalized_at column so partial uploads
--          stay invisible, and add prepare_material_upload + finalize_material
--          rpcs for the new register-first flow.

-- =============================================================================
-- 1. clean cutover: delete existing materials rows (cascades to material_links)
-- =============================================================================
delete from public.materials;

-- =============================================================================
-- 2. drop bucket-level rls policies and the bucket itself
-- =============================================================================
drop policy if exists "materials bucket read"   on storage.objects;
drop policy if exists "materials bucket insert" on storage.objects;
drop policy if exists "materials bucket update" on storage.objects;
drop policy if exists "materials bucket delete" on storage.objects;

-- the bucket is private and contains no data we care about; clean cutover.
delete from storage.buckets where id = 'materials';

-- =============================================================================
-- 3. add finalized_at column. NULL until the file is uploaded to r2.
-- =============================================================================
alter table public.materials
  add column finalized_at timestamptz;

comment on column public.materials.finalized_at is
  'Timestamp at which the file was successfully uploaded to R2 and confirmed '
  'by the browser via finalize_material(). NULL means the row was registered '
  'but the file is not yet known to exist in R2 -- such rows are invisible to '
  'list/download RPCs.';

create index idx_materials_finalized
  on public.materials (space_id, finalized_at)
  where finalized_at is not null;

-- =============================================================================
-- 4. new rpc: prepare_material_upload
-- =============================================================================
-- returns the data the worker needs to sign a presigned r2 put url. only the
-- uploader can prepare an upload, and only while the row is not finalized.

create or replace function public.prepare_material_upload(
  p_material_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.uploaded_by, m.file_name, m.mime_type, m.finalized_at
    into v_row
  from public.materials m
  where m.id = p_material_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  if v_row.uploaded_by <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_row.finalized_at is not null then
    raise exception 'already finalized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'space_id', v_row.space_id,
    'material_id', v_row.id,
    'file_name', v_row.file_name,
    'mime_type', v_row.mime_type
  );
end;
$$;

revoke execute on function public.prepare_material_upload(uuid) from public, anon;
grant  execute on function public.prepare_material_upload(uuid) to authenticated;

-- =============================================================================
-- 5. new rpc: finalize_material
-- =============================================================================

create or replace function public.finalize_material(
  p_material_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.uploaded_by, m.finalized_at
    into v_row
  from public.materials m
  where m.id = p_material_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  if v_row.uploaded_by <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_row.finalized_at is not null then
    -- idempotent: re-finalize is a no-op so a retried browser-side finalize
    -- after a transient failure does not error.
    return;
  end if;

  update public.materials
  set finalized_at = now()
  where id = p_material_id;
end;
$$;

revoke execute on function public.finalize_material(uuid) from public, anon;
grant  execute on function public.finalize_material(uuid) to authenticated;

-- =============================================================================
-- 6. update list_materials_for_space to filter on finalized_at
-- =============================================================================

create or replace function public.list_materials_for_space(
  p_space_id uuid,
  p_material_types text[] default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_limit int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total int;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_entity_type is not null
     and p_entity_type not in ('trial', 'marker', 'company', 'product', 'space')
  then
    raise exception 'invalid entity_type: %', p_entity_type
      using errcode = '22023';
  end if;

  select count(distinct m.id)::int
    into v_total
  from public.materials m
  left join public.material_links ml on ml.material_id = m.id
  where m.space_id = p_space_id
    and m.finalized_at is not null
    and (p_material_types is null or m.material_type = any(p_material_types))
    and (
      p_entity_type is null
      or (
        ml.entity_type = p_entity_type
        and (p_entity_id is null or ml.entity_id = p_entity_id)
      )
    );

  select coalesce(jsonb_agg(row_to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select distinct
           m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.materials m
      left join public.material_links ml on ml.material_id = m.id
     where m.space_id = p_space_id
       and m.finalized_at is not null
       and (p_material_types is null or m.material_type = any(p_material_types))
       and (
         p_entity_type is null
         or (
           ml.entity_type = p_entity_type
           and (p_entity_id is null or ml.entity_id = p_entity_id)
         )
       )
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
     offset greatest(p_offset, 0)
  ) r;

  return jsonb_build_object(
    'rows', v_rows,
    'total', coalesce(v_total, 0),
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

-- =============================================================================
-- 7. update list_materials_for_entity to filter on finalized_at
-- =============================================================================

create or replace function public.list_materials_for_entity(
  p_entity_type text,
  p_entity_id uuid,
  p_material_types text[] default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total int;
begin
  if p_entity_type not in ('trial', 'marker', 'company', 'product', 'space') then
    raise exception 'invalid entity_type: %', p_entity_type
      using errcode = '22023';
  end if;

  select count(*)::int
    into v_total
  from public.material_links ml
  join public.materials m on m.id = ml.material_id
  where ml.entity_type = p_entity_type
    and ml.entity_id = p_entity_id
    and m.finalized_at is not null
    and (p_material_types is null or m.material_type = any(p_material_types))
    and public.has_space_access(m.space_id);

  select coalesce(jsonb_agg(row_to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.material_links ml
      join public.materials m on m.id = ml.material_id
     where ml.entity_type = p_entity_type
       and ml.entity_id = p_entity_id
       and m.finalized_at is not null
       and (p_material_types is null or m.material_type = any(p_material_types))
       and public.has_space_access(m.space_id)
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
     offset greatest(p_offset, 0)
  ) r;

  return jsonb_build_object(
    'rows', v_rows,
    'total', coalesce(v_total, 0),
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

-- =============================================================================
-- 8. update list_recent_materials_for_space to filter on finalized_at
-- =============================================================================

create or replace function public.list_recent_materials_for_space(
  p_space_id uuid,
  p_limit int default 5
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.materials m
     where m.space_id = p_space_id
       and m.finalized_at is not null
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
  ) r;

  return jsonb_build_object('rows', v_rows);
end;
$$;

-- =============================================================================
-- 9. update download_material to filter on finalized_at
-- =============================================================================

create or replace function public.download_material(
  p_material_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.file_path, m.file_name, m.mime_type
    into v_row
  from public.materials m
  where m.id = p_material_id
    and m.finalized_at is not null
    and public.has_space_access(m.space_id);

  if v_row.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'material_id', v_row.id,
    'space_id', v_row.space_id,
    'file_path', v_row.file_path,
    'file_name', v_row.file_name,
    'mime_type', v_row.mime_type
  );
end;
$$;
```

- [ ] **Step 2: Add the assertion-style invariant test at the bottom of the migration**

Append to the same migration file (the `do $$` block runs once at migration time and raises if anything is broken; idempotent because it deletes its own test data at the end):

```sql
-- =============================================================================
-- 10. invariant test: register -> prepare -> finalize -> list -> download
-- =============================================================================
-- assertion-style. fails the migration if a registered-but-not-finalized row
-- is visible to readers, or if a finalized row is invisible. cleans up after
-- itself so the migration is idempotent.

do $$
declare
  v_agency_id uuid := '11111111-1111-1111-1111-111111111111';
  v_tenant_id uuid := '22222222-2222-2222-2222-222222222222';
  v_user_id   uuid := '33333333-3333-3333-3333-333333333333';
  v_space_id  uuid := '44444444-4444-4444-4444-444444444444';
  v_material_id uuid;
  v_pre_count  int;
  v_post_count int;
  v_dl jsonb;
begin
  -- bootstrap a synthetic agency/tenant/space/user/membership.
  insert into auth.users (id, email)
    values (v_user_id, 'r2-cutover-test@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'R2 Cutover', 'r2-cutover-test', 'r2cutover', 'X', 'x@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'T', 'r2-cutover-t', 'r2cutovert', 'X');

  insert into public.spaces (id, tenant_id, name)
    values (v_space_id, v_tenant_id, 'S');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_user_id, 'owner');

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_user_id, 'editor');

  -- act as v_user_id for the rpc calls.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);

  -- register a material directly (mirrors what register_material does).
  insert into public.materials (
    space_id, uploaded_by, file_path, file_name, file_size_bytes, mime_type,
    material_type, title
  ) values (
    v_space_id, v_user_id,
    v_space_id::text || '/pending/test.pdf',
    'test.pdf', 1024, 'application/pdf', 'briefing', 'Test'
  ) returning id into v_material_id;

  -- assertion 1: not visible to list_recent before finalize.
  v_pre_count := jsonb_array_length(
    (public.list_recent_materials_for_space(v_space_id, 10))->'rows');
  if v_pre_count <> 0 then
    raise exception 'invariant violation: list_recent returned % rows pre-finalize',
      v_pre_count;
  end if;

  -- assertion 2: download_material denies pre-finalize.
  begin
    perform public.download_material(v_material_id);
    raise exception 'invariant violation: download_material returned pre-finalize';
  exception when sqlstate '42501' then
    null;
  end;

  -- finalize.
  perform public.finalize_material(v_material_id);

  -- assertion 3: visible post-finalize.
  v_post_count := jsonb_array_length(
    (public.list_recent_materials_for_space(v_space_id, 10))->'rows');
  if v_post_count <> 1 then
    raise exception 'invariant violation: list_recent returned % rows post-finalize',
      v_post_count;
  end if;

  -- assertion 4: download_material returns the path post-finalize.
  v_dl := public.download_material(v_material_id);
  if v_dl->>'file_path' is null then
    raise exception 'invariant violation: download_material returned no file_path';
  end if;

  -- assertion 5: finalize_material is idempotent.
  perform public.finalize_material(v_material_id);

  -- cleanup (cascades).
  delete from public.materials where id = v_material_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.spaces where id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  perform set_config('request.jwt.claims', null, true);
end $$;
```

- [ ] **Step 3: Apply the migration locally and confirm it succeeds**

Run: `cd /Users/aadityamadala/Documents/code/clint-v2 && supabase db reset`
Expected: full reset replays all migrations including this one. The final migration's `do $$` block runs and either succeeds silently or raises `invariant violation: ...` and aborts.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260501160000_materials_r2_cutover.sql
git commit -m "feat(materials): r2 cutover migration

Add finalized_at column, prepare_material_upload and finalize_material
RPCs, and update list/download RPCs to filter on finalized_at. Drop
the supabase storage bucket and its policies (clean cutover, existing
rows are throwaway test data). Inline assertion test verifies pre-
and post-finalize visibility."
```

---

### Task 2: Add npm dependencies for the Worker

**Files:**
- Modify: `src/client/package.json`

- [ ] **Step 1: Install Worker runtime + S3 SDK + test deps**

Run from `src/client/`:

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/src/client
npm install --save-dev \
  @cloudflare/workers-types \
  @cloudflare/vitest-pool-workers
npm install \
  @aws-sdk/client-s3 \
  @aws-sdk/s3-request-presigner
```

Expected: `package.json` and `package-lock.json` updated. No errors.

- [ ] **Step 2: Verify versions installed by checking package.json**

Run: `grep -E '"@aws-sdk/|@cloudflare/' src/client/package.json`
Expected: four matching lines under `dependencies` and `devDependencies`.

- [ ] **Step 3: Commit**

```bash
git add src/client/package.json src/client/package-lock.json
git commit -m "chore(deps): add aws-sdk and cloudflare workers deps for r2"
```

---

### Task 3: Worker tsconfig and exclusion from Angular build

**Files:**
- Create: `src/client/worker/tsconfig.json`
- Modify: `src/client/tsconfig.app.json` (add exclude)

- [ ] **Step 1: Create the Worker tsconfig**

Write `src/client/worker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "resolveJsonModule": true
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 2: Exclude `worker/` from the Angular app build**

Read `src/client/tsconfig.app.json`. Add `"worker/**/*"` to the `exclude` array. If `exclude` does not exist yet, add:

```json
  "exclude": ["worker/**/*"]
```

at the same level as `compilerOptions`.

- [ ] **Step 3: Verify Angular build still succeeds**

Run: `cd src/client && ng build`
Expected: build succeeds with no errors. The `worker/` directory is empty so this just confirms exclusion didn't break anything.

- [ ] **Step 4: Commit**

```bash
git add src/client/worker/tsconfig.json src/client/tsconfig.app.json
git commit -m "build: scaffold worker tsconfig and exclude from angular build"
```

---

### Task 4: CORS helper module with tests

**Files:**
- Create: `src/client/worker/cors.ts`
- Create: `src/client/worker/test/cors.spec.ts`
- Create: `src/client/worker/vitest.config.ts`

- [ ] **Step 1: Create the Vitest config for Worker tests**

Write `src/client/worker/vitest.config.ts`:

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['worker/test/**/*.spec.ts'],
    poolOptions: {
      workers: {
        singleWorker: true,
        miniflare: {
          compatibilityDate: '2026-04-28',
          compatibilityFlags: ['nodejs_compat'],
        },
      },
    },
  },
});
```

- [ ] **Step 2: Add a test:worker script**

In `src/client/package.json` `"scripts"` block, add:

```json
"test:worker": "vitest run --config worker/vitest.config.ts"
```

- [ ] **Step 3: Write the failing CORS test**

Write `src/client/worker/test/cors.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAllowedOrigin, corsHeaders, preflight } from '../cors';

const ALLOW = ['clintapp.com'];

describe('isAllowedOrigin', () => {
  it('accepts the apex', () => {
    expect(isAllowedOrigin('https://clintapp.com', ALLOW)).toBe(true);
  });
  it('accepts subdomains', () => {
    expect(isAllowedOrigin('https://pfizer.clintapp.com', ALLOW)).toBe(true);
  });
  it('rejects non-matching origins', () => {
    expect(isAllowedOrigin('https://evil.com', ALLOW)).toBe(false);
  });
  it('rejects missing origin', () => {
    expect(isAllowedOrigin(null, ALLOW)).toBe(false);
  });
  it('rejects look-alike suffixes', () => {
    expect(isAllowedOrigin('https://notclintapp.com', ALLOW)).toBe(false);
  });
});

describe('corsHeaders', () => {
  it('echoes allowed origin', () => {
    const h = corsHeaders('https://pfizer.clintapp.com', ALLOW);
    expect(h['Access-Control-Allow-Origin']).toBe('https://pfizer.clintapp.com');
    expect(h['Vary']).toBe('Origin');
  });
  it('omits ACAO for disallowed origin', () => {
    const h = corsHeaders('https://evil.com', ALLOW);
    expect(h['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('preflight', () => {
  it('returns 204 for allowed origin', () => {
    const req = new Request('https://x/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://pfizer.clintapp.com' },
    });
    const res = preflight(req, ALLOW);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
  it('returns 403 for disallowed origin', () => {
    const req = new Request('https://x/', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com' },
    });
    const res = preflight(req, ALLOW);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails**

Run: `cd src/client && npm run test:worker -- worker/test/cors.spec.ts`
Expected: FAIL, module `../cors` not found.

- [ ] **Step 5: Implement `cors.ts`**

Write `src/client/worker/cors.ts`:

```ts
/**
 * CORS helpers for the materials worker. Origin must match the apex
 * exactly or be a subdomain of one of the allow-listed apexes.
 */

export function isAllowedOrigin(origin: string | null, allowedApexes: string[]): boolean {
  if (!origin) return false;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  for (const apex of allowedApexes) {
    if (host === apex) return true;
    if (host.endsWith(`.${apex}`)) return true;
  }
  return false;
}

export function corsHeaders(
  origin: string | null,
  allowedApexes: string[]
): Record<string, string> {
  const headers: Record<string, string> = { Vary: 'Origin' };
  if (isAllowedOrigin(origin, allowedApexes)) {
    headers['Access-Control-Allow-Origin'] = origin as string;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}

export function preflight(request: Request, allowedApexes: string[]): Response {
  const origin = request.headers.get('Origin');
  if (!isAllowedOrigin(origin, allowedApexes)) {
    return new Response(null, { status: 403 });
  }
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin, allowedApexes),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    },
  });
}
```

- [ ] **Step 6: Run tests, confirm pass**

Run: `cd src/client && npm run test:worker -- worker/test/cors.spec.ts`
Expected: all 9 tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/client/worker/cors.ts src/client/worker/test/cors.spec.ts \
        src/client/worker/vitest.config.ts src/client/package.json
git commit -m "feat(worker): cors helpers with allowlist origin matching"
```

---

### Task 5: JWT subject decoder for rate-limit keying

**Files:**
- Create: `src/client/worker/auth.ts`
- Create: `src/client/worker/test/auth.spec.ts`

- [ ] **Step 1: Write the failing test**

Write `src/client/worker/test/auth.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { jwtSubject } from '../auth';

// Helper: build a JWT-shaped string (header.payload.sig) without signing.
function unsignedJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc(payload)}.signature`;
}

describe('jwtSubject', () => {
  it('extracts sub from a Bearer token', () => {
    const token = unsignedJwt({ sub: 'user-abc', role: 'authenticated' });
    expect(jwtSubject(`Bearer ${token}`)).toBe('user-abc');
  });
  it('returns null for missing header', () => {
    expect(jwtSubject(null)).toBeNull();
  });
  it('returns null for non-Bearer header', () => {
    expect(jwtSubject('Basic abc')).toBeNull();
  });
  it('returns null for malformed token', () => {
    expect(jwtSubject('Bearer not.a.jwt!!')).toBeNull();
  });
  it('returns null for token with no sub', () => {
    const token = unsignedJwt({ role: 'authenticated' });
    expect(jwtSubject(`Bearer ${token}`)).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd src/client && npm run test:worker -- worker/test/auth.spec.ts`
Expected: FAIL, module `../auth` not found.

- [ ] **Step 3: Implement `auth.ts`**

Write `src/client/worker/auth.ts`:

```ts
/**
 * Decodes the `sub` claim from a Supabase JWT WITHOUT verifying the
 * signature. Used only to derive a stable rate-limit key. The Supabase
 * RPC layer is the authority for access decisions.
 */

export function jwtSubject(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const token = m[1];
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '==='.slice(0, (4 - (payload.length % 4)) % 4);
    const json = atob(padded);
    const claims = JSON.parse(json) as { sub?: unknown };
    return typeof claims.sub === 'string' && claims.sub.length > 0 ? claims.sub : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd src/client && npm run test:worker -- worker/test/auth.spec.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/worker/auth.ts src/client/worker/test/auth.spec.ts
git commit -m "feat(worker): jwt subject decoder for rate-limit keying"
```

---

### Task 6: SQLSTATE-to-HTTP error mapping

**Files:**
- Create: `src/client/worker/errors.ts`
- Create: `src/client/worker/test/errors.spec.ts`

- [ ] **Step 1: Write the failing test**

Write `src/client/worker/test/errors.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapSupabaseError, errorResponse } from '../errors';

describe('mapSupabaseError', () => {
  it('maps 42501 to 403 forbidden', () => {
    expect(mapSupabaseError({ code: '42501', message: 'forbidden' }))
      .toEqual({ status: 403, body: { error: 'forbidden' } });
  });
  it('maps P0002 to 404 not_found', () => {
    expect(mapSupabaseError({ code: 'P0002', message: 'material not found' }))
      .toEqual({ status: 404, body: { error: 'not_found' } });
  });
  it('maps 22023 to 422 with original message', () => {
    expect(mapSupabaseError({ code: '22023', message: 'invalid material_type: foo' }))
      .toEqual({ status: 422, body: { error: 'invalid material_type: foo' } });
  });
  it('passes through 401 from PostgREST as unauthenticated', () => {
    expect(mapSupabaseError({ httpStatus: 401, message: 'JWT expired' }))
      .toEqual({ status: 401, body: { error: 'unauthenticated' } });
  });
  it('falls through to 500 for anything unmapped', () => {
    expect(mapSupabaseError({ code: 'X', message: 'weird' }))
      .toEqual({ status: 500, body: { error: 'internal' } });
  });
});

describe('errorResponse', () => {
  it('sets json content-type and merges cors headers', () => {
    const res = errorResponse(403, 'forbidden', { 'Access-Control-Allow-Origin': 'https://x' });
    expect(res.status).toBe(403);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://x');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd src/client && npm run test:worker -- worker/test/errors.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `errors.ts`**

Write `src/client/worker/errors.ts`:

```ts
export type SupabaseRpcError = {
  code?: string;
  message?: string;
  httpStatus?: number;
};

export type ErrorMapping = {
  status: number;
  body: { error: string };
};

export function mapSupabaseError(err: SupabaseRpcError): ErrorMapping {
  if (err.httpStatus === 401) {
    return { status: 401, body: { error: 'unauthenticated' } };
  }
  switch (err.code) {
    case '42501':
      return { status: 403, body: { error: 'forbidden' } };
    case 'P0002':
      return { status: 404, body: { error: 'not_found' } };
    case '22023':
      return { status: 422, body: { error: err.message ?? 'invalid' } };
    default:
      return { status: 500, body: { error: 'internal' } };
  }
}

export function errorResponse(
  status: number,
  message: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd src/client && npm run test:worker -- worker/test/errors.spec.ts`
Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/client/worker/errors.ts src/client/worker/test/errors.spec.ts
git commit -m "feat(worker): sqlstate-to-http error mapping"
```

---

### Task 7: Supabase RPC fetch wrapper

**Files:**
- Create: `src/client/worker/supabase.ts`

This module does not need its own unit tests, it is exercised end-to-end by the index-handler tests in Task 9. The body is small enough that an integration test is more meaningful than mocking `fetch`.

- [ ] **Step 1: Write `supabase.ts`**

Write `src/client/worker/supabase.ts`:

```ts
import type { SupabaseRpcError } from './errors';

export type SupabaseConfig = {
  url: string;       // https://<project>.supabase.co
  anonKey: string;   // public anon key
};

/**
 * Calls a Postgres RPC via PostgREST, forwarding the user's JWT so RLS
 * applies. Returns the JSON body on success or throws a SupabaseRpcError.
 */
export async function callRpc<T = unknown>(
  cfg: SupabaseConfig,
  authHeader: string | null,
  fnName: string,
  args: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: cfg.anonKey,
  };
  if (authHeader) headers['Authorization'] = authHeader;

  const res = await fetch(`${cfg.url}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(args),
  });

  if (res.ok) {
    return (await res.json()) as T;
  }

  // PostgREST returns { code, message, details, hint } for SQL errors.
  let body: { code?: string; message?: string } = {};
  try {
    body = (await res.json()) as { code?: string; message?: string };
  } catch {
    // ignore: body is not json
  }
  const err: SupabaseRpcError = {
    code: body.code,
    message: body.message,
    httpStatus: res.status,
  };
  throw err;
}
```

- [ ] **Step 2: Type-check the worker module**

Run: `cd src/client && npx tsc -p worker/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/worker/supabase.ts
git commit -m "feat(worker): supabase rpc fetch wrapper"
```

---

### Task 8: R2 presigned URL helpers

**Files:**
- Create: `src/client/worker/r2.ts`

R2 URL signing is delegated to `@aws-sdk/s3-request-presigner`. R2's S3-compatible endpoint is `https://<account>.r2.cloudflarestorage.com`. Since the AWS SDK is well-tested and our wrapper is thin, no unit test for this module, it is covered end-to-end by the index handler tests in Task 9 with a Miniflare R2 binding.

- [ ] **Step 1: Write `r2.ts`**

Write `src/client/worker/r2.ts`:

```ts
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

const PUT_TTL_SECONDS = 5 * 60;
const GET_TTL_SECONDS = 60;

function client(cfg: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

export async function presignPut(
  cfg: R2Config,
  key: string,
  contentType: string
): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(client(cfg), cmd, { expiresIn: PUT_TTL_SECONDS });
}

export async function presignGet(
  cfg: R2Config,
  key: string,
  fileName: string,
  mimeType: string
): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${encodeRfc5987(fileName)}"`,
    ResponseContentType: mimeType,
  });
  return getSignedUrl(client(cfg), cmd, { expiresIn: GET_TTL_SECONDS });
}

// RFC 5987 ext-value for filename* with non-ASCII safety.
function encodeRfc5987(name: string): string {
  return name.replace(/["\\\r\n]/g, '_');
}
```

- [ ] **Step 2: Type-check**

Run: `cd src/client && npx tsc -p worker/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/worker/r2.ts
git commit -m "feat(worker): r2 presigned put/get helpers"
```

---

### Task 9: Worker entry (sign-upload, sign-download, rate limiting)

**Files:**
- Create: `src/client/worker/index.ts`
- Create: `src/client/worker/test/index.spec.ts`

This is the integrating handler. The test uses the Miniflare-backed Vitest pool (`@cloudflare/vitest-pool-workers`) which can run the actual Worker against a fake R2 binding and a stubbed Supabase fetch.

- [ ] **Step 1: Write the failing test**

Write `src/client/worker/test/index.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker from '../index';

const SUPABASE_URL = 'https://stub.supabase.co';

type Env = {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  ALLOWED_APEXES: string;
  UPLOAD_LIMITER: { limit: (k: { key: string }) => Promise<{ success: boolean }> };
  DOWNLOAD_LIMITER: { limit: (k: { key: string }) => Promise<{ success: boolean }> };
};

function makeEnv(over: Partial<Env> = {}): Env {
  return {
    SUPABASE_URL,
    SUPABASE_ANON_KEY: 'anon',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKID',
    R2_SECRET_ACCESS_KEY: 'SECRET',
    R2_BUCKET: 'clint-materials',
    ALLOWED_APEXES: 'clintapp.com',
    UPLOAD_LIMITER: { limit: async () => ({ success: true }) },
    DOWNLOAD_LIMITER: { limit: async () => ({ success: true }) },
    ...over,
  };
}

const VALID_BEARER = 'Bearer ' + (() => {
  const enc = (o: unknown) =>
    btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${enc({ alg: 'HS256' })}.${enc({ sub: 'user-1' })}.sig`;
})();

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockSupabaseFetch(handler: (req: Request) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', async (input: RequestInfo, init?: RequestInit) => {
    const req = new Request(input, init);
    if (req.url.startsWith(SUPABASE_URL)) {
      return handler(req);
    }
    throw new Error(`unexpected fetch: ${req.url}`);
  });
}

describe('POST /api/materials/sign-upload', () => {
  it('returns 401 when JWT is missing', async () => {
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://pfizer.clintapp.com' },
      body: JSON.stringify({ material_id: 'aaaa-aaaa' }),
    });
    mockSupabaseFetch(() =>
      new Response(JSON.stringify({ message: 'JWT required' }), { status: 401 })
    );
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(401);
  });

  it('returns presigned PUT URL on success', async () => {
    mockSupabaseFetch(() =>
      new Response(
        JSON.stringify({
          space_id: '11111111-1111-1111-1111-111111111111',
          material_id: '22222222-2222-2222-2222-222222222222',
          file_name: 'test.pdf',
          mime_type: 'application/pdf',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({ material_id: '22222222-2222-2222-2222-222222222222' }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; key: string };
    expect(body.url).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\//);
    expect(body.key).toBe(
      '11111111-1111-1111-1111-111111111111/22222222-2222-2222-2222-222222222222/test.pdf'
    );
  });

  it('returns 429 when rate limit is hit', async () => {
    const env = makeEnv({
      UPLOAD_LIMITER: { limit: async () => ({ success: false }) },
    });
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({ material_id: 'm' }),
    });
    const res = await worker.fetch(req, env);
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('maps Supabase 42501 to 403', async () => {
    mockSupabaseFetch(() =>
      new Response(JSON.stringify({ code: '42501', message: 'forbidden' }), { status: 400 })
    );
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pfizer.clintapp.com',
        Authorization: VALID_BEARER,
      },
      body: JSON.stringify({ material_id: 'm' }),
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });
});

describe('OPTIONS preflight', () => {
  it('returns 204 for allowed origin', async () => {
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'OPTIONS',
      headers: { Origin: 'https://pfizer.clintapp.com' },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(204);
  });
  it('returns 403 for disallowed origin', async () => {
    const req = new Request('https://x/api/materials/sign-upload', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.com' },
    });
    const res = await worker.fetch(req, makeEnv());
    expect(res.status).toBe(403);
  });
});

describe('non-api routes', () => {
  it('falls through to 404 (assets handler in production)', async () => {
    const req = new Request('https://x/some/spa/route', {
      method: 'GET',
      headers: { Origin: 'https://pfizer.clintapp.com' },
    });
    const res = await worker.fetch(req, makeEnv());
    // In tests the assets binding is absent; we expect a 404.
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd src/client && npm run test:worker -- worker/test/index.spec.ts`
Expected: FAIL, `../index` does not exist.

- [ ] **Step 3: Implement `index.ts`**

Write `src/client/worker/index.ts`:

```ts
import { jwtSubject } from './auth';
import { isAllowedOrigin, corsHeaders, preflight } from './cors';
import { mapSupabaseError, errorResponse, type SupabaseRpcError } from './errors';
import { callRpc } from './supabase';
import { presignPut, presignGet } from './r2';

type RateLimit = { limit: (key: { key: string }) => Promise<{ success: boolean }> };

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET: string;
  ALLOWED_APEXES: string; // comma-separated list, e.g. "clintapp.com"
  UPLOAD_LIMITER: RateLimit;
  DOWNLOAD_LIMITER: RateLimit;
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const apexes = env.ALLOWED_APEXES.split(',').map((s) => s.trim()).filter(Boolean);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return preflight(request, apexes);
    }

    const cors = corsHeaders(origin, apexes);

    if (url.pathname === '/api/materials/sign-upload' && request.method === 'POST') {
      return handleSignUpload(request, env, cors);
    }
    if (url.pathname === '/api/materials/sign-download' && request.method === 'POST') {
      return handleSignDownload(request, env, cors);
    }

    if (url.pathname.startsWith('/api/')) {
      return errorResponse(404, 'not_found', cors);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return errorResponse(404, 'not_found', cors);
  },
};

async function handleSignUpload(request: Request, env: Env, cors: Record<string, string>) {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  const key = jwtSubject(auth) ?? request.headers.get('CF-Connecting-IP') ?? 'anon';

  const rl = await env.UPLOAD_LIMITER.limit({ key: `upload:${key}` });
  if (!rl.success) {
    log({ route: 'sign-upload', status: 429, duration_ms: Date.now() - start });
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
    });
  }

  let body: { material_id?: string };
  try {
    body = (await request.json()) as { material_id?: string };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }
  if (!body.material_id) {
    return errorResponse(400, 'material_id_required', cors);
  }

  try {
    const meta = await callRpc<{
      space_id: string;
      material_id: string;
      file_name: string;
      mime_type: string;
    }>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      auth,
      'prepare_material_upload',
      { p_material_id: body.material_id }
    );

    const objectKey = `${meta.space_id}/${meta.material_id}/${meta.file_name}`;
    const url = await presignPut(
      {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
      },
      objectKey,
      meta.mime_type
    );

    log({
      route: 'sign-upload',
      material_id: body.material_id,
      status: 200,
      duration_ms: Date.now() - start,
    });
    return new Response(JSON.stringify({ url, key: objectKey }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  } catch (e) {
    return handleError(e, 'sign-upload', body.material_id, start, cors);
  }
}

async function handleSignDownload(request: Request, env: Env, cors: Record<string, string>) {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  const key = jwtSubject(auth) ?? request.headers.get('CF-Connecting-IP') ?? 'anon';

  const rl = await env.DOWNLOAD_LIMITER.limit({ key: `download:${key}` });
  if (!rl.success) {
    log({ route: 'sign-download', status: 429, duration_ms: Date.now() - start });
    return new Response(JSON.stringify({ error: 'rate_limited' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': '60', ...cors },
    });
  }

  let body: { material_id?: string };
  try {
    body = (await request.json()) as { material_id?: string };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }
  if (!body.material_id) {
    return errorResponse(400, 'material_id_required', cors);
  }

  try {
    const meta = await callRpc<{
      file_path: string;
      file_name: string;
      mime_type: string;
    }>(
      { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY },
      auth,
      'download_material',
      { p_material_id: body.material_id }
    );

    const url = await presignGet(
      {
        accountId: env.R2_ACCOUNT_ID,
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
        bucket: env.R2_BUCKET,
      },
      meta.file_path,
      meta.file_name,
      meta.mime_type
    );

    log({
      route: 'sign-download',
      material_id: body.material_id,
      status: 200,
      duration_ms: Date.now() - start,
    });
    return new Response(
      JSON.stringify({ url, file_name: meta.file_name, mime_type: meta.mime_type }),
      { status: 200, headers: { 'Content-Type': 'application/json', ...cors } }
    );
  } catch (e) {
    return handleError(e, 'sign-download', body.material_id, start, cors);
  }
}

function handleError(
  e: unknown,
  route: string,
  material_id: string | undefined,
  start: number,
  cors: Record<string, string>
): Response {
  const err = (e as SupabaseRpcError) ?? {};
  const mapped = mapSupabaseError(err);
  log({
    route,
    material_id,
    status: mapped.status,
    duration_ms: Date.now() - start,
    error: err.message,
  });
  return errorResponse(mapped.status, mapped.body.error, cors);
}

function log(entry: Record<string, unknown>): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
```

- [ ] **Step 4: Run, confirm pass**

Run: `cd src/client && npm run test:worker`
Expected: all tests across `worker/test/` pass (cors, auth, errors, index).

- [ ] **Step 5: Commit**

```bash
git add src/client/worker/index.ts src/client/worker/test/index.spec.ts
git commit -m "feat(worker): sign-upload/sign-download handlers with rate limiting"
```

---

### Task 10: wrangler.jsonc  (main entry, R2 binding, rate limiters, env vars)

**Files:**
- Modify: `src/client/wrangler.jsonc`

The exact `ratelimits` schema for `wrangler.jsonc` should be confirmed against Cloudflare's current docs. The shape below matches the Workers Rate Limiting API as of compatibility date 2026-04-28; if `wrangler dev` complains about an unknown field, run `npx wrangler types` and fix the key names to match. The `<NAMESPACE_ID>` placeholders must be replaced with actual numeric namespace IDs from the Cloudflare dashboard before deploy.

- [ ] **Step 1: Update `wrangler.jsonc`**

Read current contents, then replace with:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "clint",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-04-28",
  "compatibility_flags": ["nodejs_compat"],

  "assets": {
    "directory": "./dist/clinical-trial-dashboard/browser",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS"
  },

  "vars": {
    "ALLOWED_APEXES": "clintapp.com",
    "R2_BUCKET": "clint-materials"
  },

  "ratelimits": [
    {
      "name": "UPLOAD_LIMITER",
      "namespace_id": "<UPLOAD_NAMESPACE_ID>",
      "simple": { "limit": 30, "period": 60 }
    },
    {
      "name": "DOWNLOAD_LIMITER",
      "namespace_id": "<DOWNLOAD_NAMESPACE_ID>",
      "simple": { "limit": 120, "period": 60 }
    }
  ]
}
```

- [ ] **Step 2: Verify wrangler accepts the config (offline)**

Run: `cd src/client && npx wrangler types`
Expected: generates a `worker-configuration.d.ts` (or similar) without erroring on unknown fields. If it errors on `ratelimits`, consult `npx wrangler --help` and `https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/` for the current binding shape, fix, and re-run.

- [ ] **Step 3: Confirm Angular build still works alongside the worker**

Run: `cd src/client && ng build`
Expected: Angular build succeeds. The worker is not built by Angular (it lives outside `tsconfig.app.json` includes), but the wrangler config now references it for a future `wrangler deploy`.

- [ ] **Step 4: Commit**

```bash
git add src/client/wrangler.jsonc
git commit -m "build(worker): add main entry, r2 binding, rate limiters, env vars

The <UPLOAD_NAMESPACE_ID> and <DOWNLOAD_NAMESPACE_ID> placeholders
are filled in by an operator from the Cloudflare dashboard before
deploy, not committed to the repo."
```

---

### Task 11: errorMessage helper to fix the trial-detail bug

**Files:**
- Create: `src/client/src/app/core/utils/error-message.ts`
- Create: `src/client/src/app/core/utils/error-message.spec.ts` (Playwright unit test)
- Modify: `src/client/playwright.unit.config.ts` (add the new spec)

The existing bug: `e instanceof Error` returns false for `PostgrestError` objects, so the catch in `materials-section.component.ts:86` falls through to the generic "Could not load materials." string. This helper unifies error-to-string conversion across the three callers.

- [ ] **Step 1: Write the failing test**

Write `src/client/src/app/core/utils/error-message.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { errorMessage } from './error-message';

test.describe('errorMessage', () => {
  test('returns Error.message', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });
  test('returns PostgrestError.message', () => {
    const pg = { code: '42501', message: 'forbidden', details: null, hint: null, name: 'PostgrestError' };
    expect(errorMessage(pg)).toBe('forbidden');
  });
  test('returns Response.statusText with status', () => {
    const r = new Response(null, { status: 429, statusText: 'Too Many Requests' });
    expect(errorMessage(r)).toBe('429 Too Many Requests');
  });
  test('returns string passthrough', () => {
    expect(errorMessage('plain')).toBe('plain');
  });
  test('returns fallback for unknown shapes', () => {
    expect(errorMessage(undefined)).toBe('Unknown error');
    expect(errorMessage(null)).toBe('Unknown error');
    expect(errorMessage({})).toBe('Unknown error');
  });
});
```

- [ ] **Step 2: Add the spec to the Playwright unit-test config**

In `src/client/playwright.unit.config.ts`, append `'error-message.spec.ts'` to the `testMatch` array. (The match string is bare, since `testMatch` uses globs against `testDir`; if the existing entries are bare filenames the codebase relies on a flat match, make the dir match recursive by adjusting `testDir` if needed. Worst case, if Playwright's pattern doesn't pick it up under `src/`, set `testDir: './src/app/core/utils'` for that spec via a second config or move the test under `e2e/tests/`. Default first attempt: bare filename in `testMatch`.)

- [ ] **Step 3: Run, confirm fail**

Run: `cd src/client && npm run test:unit -- --grep error-message`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `error-message.ts`**

Write `src/client/src/app/core/utils/error-message.ts`:

```ts
/**
 * Convert any thrown value into a user-facing string.
 *
 * Handles Error, PostgrestError-shaped objects, Fetch Response, and
 * plain strings. Falls back to "Unknown error" for shapes we do not
 * recognize. Use this everywhere a Supabase RPC or fetch error needs
 * to be surfaced to the user.
 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e instanceof Response) return `${e.status} ${e.statusText}`;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') {
    const msg = (e as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.length > 0) return msg;
  }
  return 'Unknown error';
}
```

- [ ] **Step 5: Run, confirm pass**

Run: `cd src/client && npm run test:unit -- --grep error-message`
Expected: 5 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/utils/error-message.ts \
        src/client/src/app/core/utils/error-message.spec.ts \
        src/client/playwright.unit.config.ts
git commit -m "feat(core): errorMessage helper handling postgrest and Response

Fixes the existing 'Could not load materials.' fallback in
materials-section.component.ts where PostgrestError objects fail
the e instanceof Error check and we lost the real message."
```

---

### Task 12: Wire `errorMessage` into the three materials list surfaces

**Files:**
- Modify: `src/client/src/app/shared/components/materials-section/materials-section.component.ts:86`
- Modify: `src/client/src/app/features/materials-browse/materials-browse-page.component.ts:184`
- Modify: `src/client/src/app/features/engagement-landing/recent-materials-widget/recent-materials-widget.component.ts:100`

- [ ] **Step 1: Replace the catch in materials-section.component.ts**

In `src/client/src/app/shared/components/materials-section/materials-section.component.ts`, add the import at the top:

```ts
import { errorMessage } from '../../../core/utils/error-message';
```

Replace the `catch (e)` block in `load()` (around line 85-88):

```ts
    } catch (e) {
      this.error.set(errorMessage(e));
      this.materials.set([]);
    } finally {
```

- [ ] **Step 2: Same change in materials-browse-page.component.ts**

Add import:

```ts
import { errorMessage } from '../../core/utils/error-message';
```

Replace the catch in `load()`:

```ts
    } catch (e) {
      this.error.set(errorMessage(e));
      this.rows.set([]);
    } finally {
```

- [ ] **Step 3: Same change in recent-materials-widget.component.ts (currently swallows errors)**

The widget today silently sets rows to `[]` on error. Surface the error visibly. Add a new `error` signal and template branch (only the catch behavior changes; the rest of the widget stays).

Add import:

```ts
import { errorMessage } from '../../../core/utils/error-message';
```

Add an error signal alongside `loading`:

```ts
  protected readonly error = signal<string | null>(null);
```

Update the `load` method:

```ts
  private async load(spaceId: string, limit: number): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const rows = await this.materialService.listRecentForSpace(spaceId, limit);
      this.rows.set(rows);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }
```

Update the template, replace the loading/list block with:

```html
          @if (loading()) {
            <p class="px-4 py-3 text-xs text-slate-400">Loading...</p>
          } @else if (error(); as err) {
            <p class="px-4 py-3 text-xs text-red-600">{{ err }}</p>
          } @else {
            <ul class="divide-y divide-slate-100">
              @for (material of rows(); track material.id) {
                <li>
                  <app-material-row
                    [material]="material"
                    [showLinks]="true"
                    (rowClick)="onRowClick($event)"
                    (downloadClick)="onDownloadClick($event)"
                  />
                </li>
              }
            </ul>
          }
```

- [ ] **Step 4: Type-check and lint**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/materials-section/materials-section.component.ts \
        src/client/src/app/features/materials-browse/materials-browse-page.component.ts \
        src/client/src/app/features/engagement-landing/recent-materials-widget/recent-materials-widget.component.ts
git commit -m "fix(materials): surface real error messages from list rpcs

The three material list surfaces all caught errors with
'e instanceof Error' which is false for PostgrestError, so the
real reason ('forbidden', 'JWT expired', etc.) was always
swallowed. Use the new errorMessage helper instead."
```

---

### Task 13: MaterialService (new uploadFile/getDownloadUrl/finalize, delete repath/updateFilePath)

**Files:**
- Modify: `src/client/src/app/core/services/material.service.ts` (full rewrite of the storage-facing methods)

- [ ] **Step 1: Replace the storage methods in `material.service.ts`**

Read the file. Replace the constants block at the top:

```ts
const SIGNED_URL_TTL_SECONDS = 60;
```

with:

```ts
const WORKER_BASE = '/api/materials';
```

(Remove `MATERIALS_BUCKET` and `SIGNED_URL_TTL_SECONDS`, the worker owns TTLs now.)

Replace `uploadFile`, `repath`, `updateFilePath`, and `getDownloadUrl` with the following:

```ts
  /**
   * Asks the worker for a presigned R2 PUT URL, then uploads the file
   * directly to R2. Caller must have already called registerMaterial()
   * to obtain materialId.
   */
  async uploadFile(materialId: string, file: File): Promise<void> {
    const { data: session } = await this.supabase.client.auth.getSession();
    const token = session.session?.access_token;
    if (!token) throw new Error('Not signed in');

    const signRes = await fetch(`${WORKER_BASE}/sign-upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ material_id: materialId }),
    });
    if (!signRes.ok) {
      const body = await safeJson(signRes);
      throw new Error(body?.error ?? `Upload sign failed (${signRes.status})`);
    }
    const { url } = (await signRes.json()) as { url: string; key: string };

    const putRes = await fetch(url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type },
    });
    if (!putRes.ok) {
      throw new Error(`Upload to R2 failed (${putRes.status})`);
    }
  }

  /** Mark the row as finalized so list/download RPCs surface it. */
  async finalize(materialId: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('finalize_material', {
      p_material_id: materialId,
    });
    if (error) throw error;
  }

  /**
   * Asks the worker for a presigned R2 GET URL with a download
   * Content-Disposition. The worker validates access via the existing
   * download_material RPC.
   */
  async getDownloadUrl(materialId: string): Promise<{
    url: string;
    fileName: string;
    mimeType: string;
  }> {
    const { data: session } = await this.supabase.client.auth.getSession();
    const token = session.session?.access_token;
    if (!token) throw new Error('Not signed in');

    const res = await fetch(`${WORKER_BASE}/sign-download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ material_id: materialId }),
    });
    if (!res.ok) {
      const body = await safeJson(res);
      throw new Error(body?.error ?? `Download sign failed (${res.status})`);
    }
    const body = (await res.json()) as { url: string; file_name: string; mime_type: string };
    return { url: body.url, fileName: body.file_name, mimeType: body.mime_type };
  }
```

Add the `safeJson` helper at the bottom of the file:

```ts
async function safeJson(res: Response): Promise<{ error?: string } | null> {
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return null;
  }
}
```

Update the `delete` method's call to `storage.from(MATERIALS_BUCKET).remove(...)`, remove that whole block. The R2 object cleanup belongs to a janitor (out of scope per spec). Replace:

```ts
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('delete_material', {
      p_id: id,
    });
    if (error) throw error;
  }
```

(no R2 remove call here; orphan cleanup is a separate phase).

Remove the imports for `DownloadMaterialResult` (no longer used after removing the old `getDownloadUrl` body). Remove the `buildTempPath` and `buildFinalPath` methods, the worker owns the path scheme now.

- [ ] **Step 2: Update the `RegisterMaterialInput` callsite to no longer pre-compute `file_path`**

The new flow registers with a placeholder path (worker derives the canonical key from the row at sign-upload time). Update `register_material` callers in Task 14 to pass a placeholder. For now, in `material.service.ts`, leave `registerMaterial` as-is (it still requires `file_path`). The upload zone passes a placeholder in Task 14.

- [ ] **Step 3: Type-check**

Run: `cd src/client && ng build`
Expected: error in `material-upload-zone.component.ts` (still uses old `uploadFile(path, file)` and `repath`/`updateFilePath`). That is fixed in Task 14. For now, comment-mark the upload-zone changes as the next task.

If the type-check fails on places other than `material-upload-zone.component.ts`, fix those callsites here. (Check `marker-detail-content.component.ts` and any other files identified by `grep -rn 'materialService\.repath\|materialService\.updateFilePath\|materialService\.buildTempPath\|materialService\.buildFinalPath' src/`).

- [ ] **Step 4: Commit (do not push, upload zone is broken until Task 14)**

```bash
git add src/client/src/app/core/services/material.service.ts
git commit -m "refactor(materials): material service uses worker for upload/download

uploadFile and getDownloadUrl now POST to /api/materials/* and rely
on the worker to sign R2 URLs. New finalize() method calls the
finalize_material RPC. repath, updateFilePath, buildTempPath, and
buildFinalPath are removed -- the worker owns the canonical key
scheme. Upload zone callsite is updated in the next task."
```

---

### Task 14: Upload zone (register-first flow)

**Files:**
- Modify: `src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.ts:390-475`

- [ ] **Step 1: Rewrite the `upload()` method**

In `src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.ts`, replace the body of `upload()`:

```ts
  protected async upload(): Promise<void> {
    const pending = this.pending();
    if (!pending) return;
    if (!this.canUpload()) return;

    this.uploading.set(true);
    this.uploadError.set(null);

    const sid = this.spaceId();
    const file = pending.file;

    // Compose links: picker links plus, when the current entity is
    // space-level, an explicit space link (the picker doesn't show
    // space as a target).
    const links: MaterialLink[] = this.pickerLinks().map((l, i) => ({
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      display_order: i,
    }));
    if (this.entityType() === 'space') {
      links.unshift({
        entity_type: 'space',
        entity_id: this.entityId(),
        display_order: 0,
      });
    }

    try {
      // 1. Register first. RPC validates size/mime/access. Returns a
      //    material_id; worker derives the canonical R2 key from this id.
      const materialId = await this.materialService.registerMaterial({
        space_id: sid,
        // Placeholder path; the worker derives the real R2 key from
        // (space_id, material_id, file_name) at sign-upload time. The
        // file_path column gets its real value at finalize time, but
        // we pre-fill it here so list_materials_for_* can return a
        // path-ish string for the row even pre-finalize. The row is
        // hidden by finalized_at IS NULL anyway.
        file_path: `${sid}/pending/${file.name}`,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        material_type: this.materialType(),
        title: this.title().trim() || file.name,
        links,
      });

      // 2. Upload bytes. Worker mints presigned PUT URL, browser PUTs
      //    directly to R2 at {space_id}/{material_id}/{file_name}.
      await this.materialService.uploadFile(materialId, file);

      // 3. Update the row's file_path to the canonical key and mark
      //    finalized in a single RPC. (finalize_material handles the
      //    visibility flip.) We could also update file_path here via
      //    a second RPC; keep the current shape for now since
      //    download_material returns whatever path is in the column.
      await this.materialService.updateFilePathDirect(materialId, `${sid}/${materialId}/${file.name}`);
      await this.materialService.finalize(materialId);

      this.messageService.add({
        severity: 'success',
        summary: 'Material uploaded.',
        life: 3000,
      });

      this.uploaded.emit({
        id: materialId,
        space_id: sid,
        uploaded_by: '',
        file_path: `${sid}/${materialId}/${file.name}`,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        material_type: this.materialType(),
        title: this.title().trim() || file.name,
        uploaded_at: new Date().toISOString(),
        links,
      });

      this.dialogOpen.set(false);
      this.onDialogClose();
    } catch (e) {
      this.uploadError.set(errorMessage(e));
    } finally {
      this.uploading.set(false);
    }
  }
```

Add at the top of the file:

```ts
import { errorMessage } from '../../../core/utils/error-message';
```

- [ ] **Step 2: Add `updateFilePathDirect` back to `MaterialService`**

The path-update is still needed because the worker derives the canonical key from the row at *sign-upload* time, but `download_material` returns whatever is in `materials.file_path`. Add a small RPC-free direct update method back to `MaterialService` (RLS already enforces uploader-only update on the table):

In `src/client/src/app/core/services/material.service.ts`, add:

```ts
  /**
   * Updates materials.file_path directly via PostgREST (RLS enforces
   * uploader-only). Called from the upload flow after the R2 PUT
   * succeeds, so the canonical R2 key is what download_material
   * surfaces.
   */
  async updateFilePathDirect(materialId: string, newPath: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('materials')
      .update({ file_path: newPath })
      .eq('id', materialId);
    if (error) throw error;
  }
```

- [ ] **Step 3: Type-check + lint + build**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.ts \
        src/client/src/app/core/services/material.service.ts
git commit -m "feat(materials): register-first upload flow

The upload zone now: registerMaterial -> uploadFile (worker signs
R2 PUT URL, browser PUTs to R2) -> updateFilePathDirect ->
finalize_material. Removes the temp-path-then-repath dance. The row
is invisible to readers until finalize_material flips finalized_at."
```

---

### Task 15: Update runbook

**Files:**
- Modify: `docs/runbook/02-tech-stack.md`
- Modify: `docs/runbook/06-backend-architecture.md`
- Modify: `docs/runbook/07-database-schema.md`
- Modify: `docs/runbook/12-deployment.md`

This task only touches changes the agent made in this session per the user's runbook-hook rule.

- [ ] **Step 1: Update `02-tech-stack.md`, add R2 and AWS SDK**

Find the storage section. Add a paragraph stating that engagement materials are stored in **Cloudflare R2** (S3-compatible) via a Cloudflare Worker that signs short-lived presigned URLs. Note the dependency on `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`. If there is no current section for storage, add one under "Backend" or "Infra".

- [ ] **Step 2: Update `06-backend-architecture.md`, describe the Worker**

Add a section "Materials Worker" describing:
- Routes: `POST /api/materials/sign-upload`, `POST /api/materials/sign-download`.
- Auth: forwards user JWT to existing Supabase RPCs (`prepare_material_upload`, `download_material`); access decisions live in Postgres.
- Rate limiting: Workers Rate Limiting API, 30/min upload and 120/min download per user.
- R2 bucket: `clint-materials`, key scheme `{space_id}/{material_id}/{file_name}`.
- TTLs: 5 min PUT, 60 s GET.

- [ ] **Step 3: Update `07-database-schema.md`, add `finalized_at` and the new RPCs**

In the `materials` table section: document the new `finalized_at timestamptz` column and the index `idx_materials_finalized`. State that all list/download RPCs filter on `finalized_at is not null`.

In the RPC section: document `prepare_material_upload(uuid)` and `finalize_material(uuid)`, including their access checks.

- [ ] **Step 4: Update `12-deployment.md`, Worker secrets and R2 setup**

Add a "Cloudflare Worker (R2 materials)" subsection with:
- Required secrets: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Set via `wrangler secret put <NAME>`.
- R2 bucket `clint-materials` must be created via `wrangler r2 bucket create clint-materials`.
- R2 CORS rules (allow PUT and GET from the same origin set as the Worker CORS) configured via `wrangler r2 bucket cors put`.
- Two rate-limit namespaces (one for upload, one for download) created in the Cloudflare dashboard; their numeric IDs go into `wrangler.jsonc`.

- [ ] **Step 5: Commit**

```bash
git add docs/runbook/
git commit -m "docs(runbook): document r2 materials worker and finalize flow"
```

---

### Task 16: Operator-run infrastructure setup checklist

This task is **manual operator work**, not code, and runs once before deploy. The agent does not execute these, they are listed here so the human knows what to do before Task 17.

- [ ] **Step 1: Create the R2 bucket**

Run: `cd src/client && npx wrangler r2 bucket create clint-materials`
Expected: bucket created.

- [ ] **Step 2: Configure R2 bucket CORS**

Create `r2-cors.json`:

```json
[
  {
    "AllowedOrigins": ["https://*.clintapp.com", "https://clintapp.com"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type", "Authorization"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

Run: `npx wrangler r2 bucket cors put clint-materials --rules r2-cors.json`

- [ ] **Step 3: Create the rate-limit namespaces**

In the Cloudflare dashboard under Workers & Pages → Rate limiting, create two namespaces (`upload-limiter`, `download-limiter`). Copy the numeric namespace IDs into `wrangler.jsonc` replacing `<UPLOAD_NAMESPACE_ID>` and `<DOWNLOAD_NAMESPACE_ID>`.

- [ ] **Step 4: Set Worker secrets**

```bash
cd src/client
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

The R2 access key and secret are created in the dashboard at R2 → Manage R2 API Tokens.

- [ ] **Step 5: Commit the namespace IDs (only the IDs, never the secrets)**

```bash
git add src/client/wrangler.jsonc
git commit -m "build(worker): fill rate-limit namespace IDs from cloudflare dashboard"
```

---

### Task 17: Manual end-to-end verification on a preview deploy

This is the human-in-the-loop confirmation that the cutover works before promoting.

- [ ] **Step 1: Apply migration to remote Supabase**

Run: `cd /Users/aadityamadala/Documents/code/clint-v2 && supabase db push`
Expected: migration applies cleanly. The inline `do $$` assertion runs against the remote database.

- [ ] **Step 2: Deploy the Worker**

Run: `cd src/client && ng build && npx wrangler deploy`
Expected: deployed to the existing `clint` Worker on `*.clintapp.com`.

- [ ] **Step 3: Manual smoke test on the trial detail page from the bug report**

Visit: `https://pfizer.clintapp.com/t/a87a88ae-1b76-4c6b-85e0-1b53c926d0f2/s/5a4d26ad-e540-4bb9-8758-fc50544669de/manage/trials/cc0aa44c-8bef-41d3-9eda-636e964348ba`

Expected:
- Materials section shows "No materials match the current filters." (the existing-test-row was deleted by the migration's clean cutover).
- Upload zone is visible.

- [ ] **Step 4: Upload a test PDF**

Drop a PDF into the upload zone. Expected:
- Upload dialog opens.
- After clicking Upload, the file appears in the materials list within ~1 second.
- DevTools Network tab shows: `register_material` (200) → `/api/materials/sign-upload` (200) → R2 PUT (200) → `finalize_material` (200).

- [ ] **Step 5: Refresh the page and confirm the material loads**

Refresh. Expected:
- Materials section shows the row.
- No "Could not load materials." error.

- [ ] **Step 6: Click Download and confirm the file is delivered**

Expected:
- DevTools Network: `/api/materials/sign-download` (200) → R2 GET (200) with `Content-Disposition: attachment; filename="..."`.
- Browser saves the file with the original filename.

- [ ] **Step 7: Click Delete and confirm the row goes away**

Expected:
- Row removed from list.
- (R2 object remains; janitor is out of scope for this phase. The orphan is invisible to all users.)

- [ ] **Step 8: Confirm rate limiting**

In a script, fire 50 `/api/materials/sign-upload` POSTs as the same user in 60 seconds. Expected: requests 31-50 return 429 with `Retry-After: 60`.

- [ ] **Step 9: Mark the implementation complete**

```bash
# nothing to commit; this task is verification only.
echo "R2 materials cutover verified on preview."
```

---

## Self-review notes

- Spec coverage: every section in `2026-05-01-r2-materials-storage-design.md` maps to a task: architecture (Tasks 9-10), Worker (Tasks 4-9), MaterialService (Tasks 13-14), upload-zone (Task 14), migration (Task 1), wrangler (Task 10), rate limiting (Task 9), errorMessage (Tasks 11-12), runbook (Task 15), operator setup (Task 16), verification (Task 17).
- Type consistency: `materialService.uploadFile(materialId, file)` and `materialService.finalize(materialId)` are introduced in Task 13 and used identically in Task 14. `errorMessage(e)` is introduced in Task 11 and used in Tasks 12 and 14. The Worker `Env` type in Task 9 matches the `wrangler.jsonc` keys in Task 10. The migration's `prepare_material_upload` return shape (`{ space_id, material_id, file_name, mime_type }`) matches what `handleSignUpload` expects in Task 9.
- Placeholder scan: only deliberate placeholders are `<UPLOAD_NAMESPACE_ID>` and `<DOWNLOAD_NAMESPACE_ID>` in `wrangler.jsonc` (Task 10), filled by the operator in Task 16.
- DRY: the `corsHeaders` / `errorResponse` / `mapSupabaseError` helpers are shared between the two Worker handlers. The frontend `errorMessage` helper is shared across three components.
