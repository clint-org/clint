# RPC Coverage Tranche 1: Design

**Date:** 2026-05-05
**Status:** Ready for review
**Scope:** Close the highest-risk gap in integration test coverage by adding role-access matrix rows for destructive RPCs, auth-flow RPCs, tenant lifecycle, hostname management, settings writes, anon-callable surface, and content writes. Build the per-test scratch-space fixture that unblocks destructive testing.

## Motivation

The integration matrix (`integration/tests/role-access.spec.ts`) covers 7 of ~87 user-callable RPCs in `supabase/migrations/`, ≈8% coverage. The recent `delete_space` regression that shipped to prod is the canonical failure mode: the integration README explicitly marks destructive ops as out of scope ("destructive in fixture -- would mid-test wipe the fixture"), so the gap is documented but unfilled.

This design closes the documented gap by:
1. Adding a per-test scratch-entity fixture so destructive RPCs can be exercised without nuking the shared persona graph.
2. Adding ~32 matrix rows across 17 critical RPCs in 7 new spec files.

## Goals

1. **Unblock destructive RPC testing.** Tests can create throwaway tenants/spaces/agencies and delete them without touching the shared `buildPersonas()` graph.
2. **Cover the 17 critical RPCs.** Every destructive op, every auth-boundary RPC, every tenant-write, every anon-callable RPC gets at least one positive and one negative matrix row.
3. **Keep the suite under 90 seconds.** Adding ~32 rows should add ≈10-20 seconds (each row ≈300-600ms with scratch setup), keeping integration well within pre-push budget.

## Non-goals (this tranche)

- Read RPCs (33 RPCs, RLS-leak coverage). Tranche 2.
- Worker-secret CTgov sync RPCs (7). Tranche 3.
- Palette RPCs (5). Out of scope -- UX, not security.
- Vitest consolidation of the 7 Playwright unit specs. Separate task #1.
- Branch protection / Cloudflare CI deploy gating. Open question, not actioned.
- Any change to `personas.ts` itself. Additive only.

## Architecture

Two new files, seven new spec files, all additive:

```
src/client/integration/
  fixtures/
    personas.ts            (unchanged -- shared persona graph)
    scratch.ts             (NEW -- per-test throwaway entities)
  harness/
    as.ts                  (unchanged)
  tests/
    role-access.spec.ts    (unchanged -- existing 49 rows)
    rpc-destructive.spec.ts      (NEW -- 4 RPCs, ~8 rows)
    rpc-auth-flow.spec.ts        (NEW -- 4 RPCs, ~8 rows)
    rpc-tenant-lifecycle.spec.ts (NEW -- 2 RPCs, ~4 rows)
    rpc-hostname.spec.ts         (NEW -- 2 RPCs, ~4 rows)
    rpc-settings.spec.ts         (NEW -- 4 RPCs, ~8 rows)
    rpc-anon.spec.ts             (NEW -- 3 RPCs, ~6 rows)
    rpc-content-write.spec.ts    (NEW -- 2 RPCs, ~4 rows)
```

Each new spec file calls `buildPersonas()` in `beforeAll` (same shape as the existing `role-access.spec.ts`) and uses `scratch.ts` helpers per-test as needed.

## Component: scratch.ts (per-test fixture)

**Location:** `integration/fixtures/scratch.ts`

**API:**

```ts
export async function createScratchTenant(
  personas: Personas,
  opts?: { ownerPersona?: PersonaName },
): Promise<{ tenantId: string; cleanup: () => Promise<void> }>;

export async function createScratchSpace(
  personas: Personas,
  opts?: { tenantId?: string; ownerPersona?: PersonaName },
): Promise<{ spaceId: string; cleanup: () => Promise<void> }>;

export async function createScratchAgency(
  personas: Personas,
): Promise<{
  agencyId: string;
  tenantId: string;
  spaceId: string;
  cleanup: () => Promise<void>;
}>;
```

**Cleanup contract:**
- Uses the service-role client. RLS bypass keeps teardown reliable regardless of partial state.
- Idempotent. Each cleanup deletes by id with `IF EXISTS`-style semantics, so it's safe to call after the RPC under test already destroyed the entity.
- On cleanup failure, log and rethrow. A leaked scratch entity surfaces as a test-suite error rather than silent state pollution.

**Naming convention:** scratch entities use a recognizable suffix (`scratch-${randomUUID().slice(0, 8)}`) so the persona-graph wipe in `buildPersonas()` (which already wipes by suffix pattern) sweeps anything that did leak across runs as a defense-in-depth.

**Usage pattern:**

```ts
test('delete_space: ok (space owner)', async () => {
  const { spaceId, cleanup } = await createScratchSpace(personas, {
    ownerPersona: 'space_owner',
  });
  try {
    expectOk(await as(personas, 'space_owner').rpc('delete_space', { p_space_id: spaceId }));
  } finally {
    await cleanup();
  }
});
```

**Why explicit `try/finally`, not `test.extend` / `using`:**
- Plain `try/finally` is universally readable.
- `test.extend` couples to vitest's fixture lifecycle, which makes debugging cleanup failures harder.
- `using` (Symbol.asyncDispose) requires careful handling for async disposal in vitest 4 -- not worth the cognitive load for a 100-LOC helper.

## Component: 7 new spec files

Each file follows the same shape as `role-access.spec.ts`:

```ts
describe('<RPC group>', () => {
  let personas: Personas;
  beforeAll(async () => { personas = await buildPersonas(); });
  // ... tests
});
```

### `rpc-destructive.spec.ts` (~8 rows, scratch needed)

| RPC | Persona | Expectation |
|---|---|---|
| `delete_space` | `space_owner` | OK |
| `delete_space` | `contributor` | 401 |
| `delete_agency` | `platform_admin` | OK |
| `delete_agency` | `agency_only` | 401 |
| `delete_material` | `space_owner` | OK |
| `delete_material` | `reader` | 401 |
| `delete_primary_intelligence` | `tenant_owner` (agency-firewalled) | 401 |
| `delete_primary_intelligence` | `agency_only` | OK |

### `rpc-auth-flow.spec.ts` (~8 rows, scratch needed)

| RPC | Scenario | Expectation |
|---|---|---|
| `accept_invite` | valid code | OK |
| `accept_invite` | invalid code | error |
| `accept_space_invite` | valid code | OK |
| `accept_space_invite` | invalid code | error |
| `self_join_tenant` | matching email domain | OK |
| `self_join_tenant` | non-matching domain | denied |
| `add_agency_member` | `agency_owner` | OK |
| `add_agency_member` | `tenant_owner` (non-agency) | 401 |

### `rpc-tenant-lifecycle.spec.ts` (~4 rows, scratch needed)

| RPC | Persona | Expectation |
|---|---|---|
| `provision_tenant` | `agency_owner` | OK |
| `provision_tenant` | `no_memberships` | 401 |
| `create_tenant` | `agency_owner` | OK |
| `create_tenant` | `no_memberships` | 401 |

### `rpc-hostname.spec.ts` (~4 rows, scratch needed)

| RPC | Persona | Expectation |
|---|---|---|
| `register_custom_domain` | `tenant_owner` | OK |
| `register_custom_domain` | `no_memberships` | 401 |
| `release_retired_hostname` | `platform_admin` | OK |
| `release_retired_hostname` | `tenant_owner` | 401 |

### `rpc-settings.spec.ts` (~8 rows, partial scratch)

| RPC | Persona | Expectation |
|---|---|---|
| `update_tenant_access` | `tenant_owner` | OK |
| `update_tenant_access` | `contributor` | 401 |
| `update_tenant_branding` | `tenant_owner` | OK |
| `update_tenant_branding` | `reader` | 401 |
| `update_agency_branding` | `agency_owner` | OK |
| `update_agency_branding` | `tenant_owner` | 401 |
| `update_space_field_visibility` | `space_owner` | OK |
| `update_space_field_visibility` | `reader` | 401 |

### `rpc-anon.spec.ts` (~6 rows, no scratch)

| RPC | Caller | Expectation |
|---|---|---|
| `check_subdomain_available` | anon (free name) | OK true |
| `check_subdomain_available` | anon (taken name) | OK false |
| `get_brand_by_host` | anon (valid host) | OK |
| `get_brand_by_host` | anon (bogus host) | OK with default |
| `get_tenant_access_settings` | `tenant_owner` | OK |
| `get_tenant_access_settings` | anon | 401 |

### `rpc-content-write.spec.ts` (~4 rows, partial scratch)

| RPC | Persona | Expectation |
|---|---|---|
| `upsert_primary_intelligence` | `agency_only` | OK |
| `upsert_primary_intelligence` | `tenant_owner` (agency-firewalled) | 401 |
| `build_intelligence_payload` | `agency_only` | OK |
| `build_intelligence_payload` | `tenant_owner` | 401 |

## Data flow

Each test follows the canonical shape:

1. `beforeAll` -> `buildPersonas()` once per file (shared persona graph, ~1.5s).
2. Per-test:
   - If destructive: `createScratchX(personas, ...)` -> get `{ id, cleanup }`.
   - Run the RPC under test via `as(personas, '<persona>').rpc(...)`.
   - Assert with `expectOk` / `expectCode`.
   - `finally` -> `cleanup()`.
3. `afterAll`: nothing -- next run's `buildPersonas()` wipes by suffix pattern.

## Error handling

- **Cleanup failure:** logged, rethrown -- the test-suite errors out with a clear "leaked scratch entity X" message.
- **Persona graph fails to build:** `beforeAll` errors halt the file. Same as today.
- **Scratch RPC dependency drift:** if a future migration changes the shape of `provision_tenant` / `create_space` / `provision_agency` (which scratch helpers call internally), the scratch helper itself fails first with a clear error -- before tests run -- so the failure points at the migration, not the test.

## Testing strategy for the fixture itself

The scratch fixture has no dedicated tests. Its correctness is exercised transitively by every spec that uses it:
- If `createScratchSpace` is broken, `rpc-destructive.spec.ts` `delete_space` tests fail at setup.
- If cleanup is broken, leaked entities accumulate and the persona-graph wipe in subsequent runs catches them.

This is the standard "fixture is tested by fixture consumers" pattern -- adding dedicated tests for the fixture would be testing infrastructure for its own sake.

## Sized estimate

- `scratch.ts`: ~100 LOC.
- 7 spec files × ~30-50 LOC each: ~250-350 LOC.
- **Total new code:** ~350-450 LOC.
- **Wall time additions:**
  - Each spec file's `buildPersonas()` adds ~1.5s overhead. 7 files = +10s.
  - Each scratch entity setup ≈400-800ms. ~22 destructive tests × 600ms avg = +13s.
  - Total integration suite goes from ~1s (passing rows) to ~25-30s.

Still well within pre-push budget (lightweights + integration was ~43s before; will be ~70s after).

## Out of scope (deferred to follow-up tranches)

- **Tranche 2 (read RPCs, ~33).** RLS-leak coverage. Mostly mechanical -- consider a `forEachReadRpc(registry)` helper.
- **Tranche 3 (worker-secret RPCs, ~7).** Assert "no secret -> 401, bad secret -> 401" for `bulk_update_last_polled`, `ingest_ctgov_snapshot`, etc.
- **Vitest consolidation of Playwright unit specs.** Separate refactor.
- **Tracked install of pre-push hook.** `.git/hooks/` is local-only today; making it portable is its own change (Husky or `scripts/install-hooks.sh`).
- **Branch protection on main / Cloudflare deploy gating.** Discussed in conversation, not actioned -- requires GitHub settings changes the design can't make.

## Open questions

None blocking. The implementation plan (next step) will sequence the work: scratch.ts first, then the seven spec files in increasing dependency order (anon → settings → hostname → tenant-lifecycle → auth-flow → destructive → content-write).
