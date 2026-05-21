# Cascade Safety Design

**Status:** Draft. Reached through audit + brainstorm on 2026-05-20.
**Task tracker:** `docs/specs/cascade-safety/spec.md` (T1..T19) + `docs/specs/cascade-safety/status.json`.
**Companion specs:**
- `2026-05-10-audit-log-design.md` (the `redact_user_pii` and `audit_events` patterns this design extends to the rest of the schema).
- `2026-05-01-r2-materials-storage-design.md` (the R2 cutover that left material files leaking on delete).

---

## Goal

Make every destructive action in the schema either reversible, gated by friction proportional to its blast radius, or both. Stop the bleeding from six distinct cascade hazards identified in the 2026-05-20 audit:

1. `spaces` cascade has enormous blast radius and is exposed at owner-level with no reversibility.
2. `products.company_id`, `trials.product_id`, `trial_notes.trial_id` carry `NO ACTION` defaults that block parent deletes; `events.{company,product,trial}_id` then silently cascade.
3. `event_links` double-cascades silently sever the event knowledge graph.
4. Polymorphic `entity_id` columns on `primary_intelligence*` and `material_links` survive parent deletes as dangling references.
5. `marker_assignments` cascade strands markers in the space with zero assignments.
6. `auth.users` deletion is half-cascade, half-block; the user row is effectively immortal by accident, not by design.

Six concerns, one unified design: deletes get a preview, archives are the default cheap action, attribution is preserved by redaction rather than removal, and storage cleanup is enforced by Postgres rather than by client cooperation.

## Scope

### In scope

- FK action changes on `products`, `trials`, `trial_notes`, `trials.therapeutic_area_id`.
- New `archived_at` column on `spaces` plus archive / restore / permanent-delete RPCs.
- Pre-flight count preview RPCs for company, product, trial.
- Orphan-marker cleanup trigger on `marker_assignments`.
- Polymorphic entity cleanup triggers on `companies`, `products`, `trials`, `markers`.
- `r2_pending_deletes` queue table plus `AFTER DELETE` trigger on `materials` plus a drain worker.
- `redact_user(uuid)` RPC and `auth.users.redacted_at` flag.
- Updated confirm dialog component with count breakdown and type-the-name confirmation.

### Out of scope

- Hard-purge of `auth.users` for regulator demand. Revisit only if a real demand surfaces; today the redact pattern covers GDPR right-to-erasure semantically (PII gone, identifier opaque).
- Per-type FK rewrite of `primary_intelligence*` and `material_links`. The polymorphic pattern stays; triggers cover the cleanup gap. Migrate to per-type FKs only if the polymorphic pattern expands further.
- Soft-delete on individual entities (companies, products, trials, markers). The cascade-with-preview pattern replaces the unlink semantics that today's `company-list` dialog falsely promises.
- Restoration of permanently deleted spaces. Permanent delete is permanent; the archive tier is where recoverability lives.

## Design

### #1 Space lifecycle: archive + permanent delete

Add `spaces.archived_at timestamptz null`. Default views filter `archived_at is null`. Two RPCs replace today's single `delete_space`:

```sql
public.archive_space(p_space_id uuid) returns void
  -- gate: has_space_access(p_space_id, array['owner'])
  -- action: update spaces set archived_at = now() where id = p_space_id
  -- audit: space.archived

public.restore_space(p_space_id uuid) returns void
  -- gate: has_space_access(p_space_id, array['owner'])
  -- action: update spaces set archived_at = null where id = p_space_id
  -- audit: space.restored
```

```sql
public.permanently_delete_space(p_space_id uuid) returns jsonb
  -- gate: is_tenant_member(spaces.tenant_id, array['owner']) OR is_platform_admin()
  -- preflight: must be archived (raise 42501 if archived_at is null)
  -- action:
  --   1. enqueue every materials.file_path under this space into r2_pending_deletes
  --      (the AFTER DELETE trigger on materials does this automatically, but call
  --       it out for clarity; nothing extra in the RPC)
  --   2. delete from public.markers where space_id = p_space_id
  --      (preserves the existing BEFORE DELETE marker_changes audit row pattern)
  --   3. delete from public.spaces where id = p_space_id
  -- audit: space.deleted (with count breakdown in metadata)
```

The existing `delete_space()` RPC is replaced; callers (the space-settings UI, smoke tests, the `audit_instrument_spaces` migration) are updated to call `permanently_delete_space()` and to require the space be archived first. No 30-day waiting period; the role gate is the friction.

### #2 Company, product, trial: cascade with count preview

FK changes:

| Column | Today | Change |
|---|---|---|
| `products.company_id` | NOT NULL, NO ACTION | NOT NULL, CASCADE |
| `trials.product_id` | NOT NULL, NO ACTION | NOT NULL, CASCADE |
| `trial_notes.trial_id` | NOT NULL, NO ACTION | NOT NULL, CASCADE |
| `trials.therapeutic_area_id` | NOT NULL, NO ACTION | NULL allowed, SET NULL |

Therapeutic areas remain categorical: deleting a TA leaves the trials standing with `therapeutic_area_id is null`, rendered as "Uncategorized" in the UI.

Three preview RPCs feed the confirm dialog:

```sql
public.preview_company_delete(p_company_id uuid) returns jsonb
public.preview_product_delete(p_product_id uuid) returns jsonb
public.preview_trial_delete  (p_trial_id   uuid) returns jsonb
```

Each returns a count breakdown shaped:

```json
{
  "products": 14,
  "trials": 47,
  "events": 312,
  "materials": 8,
  "primary_intelligence": 23,
  "primary_intelligence_links": 7,
  "marker_assignments": 1847,
  "markers_removed_entirely": 123,
  "markers_unlinked_only": 1724,
  "marker_notifications": 156
}
```

Markers split into two counts because the cascade behavior is asymmetric: a trial delete removes the `marker_assignments` row, the orphan-cleanup trigger then deletes any marker that ends up with zero remaining assignments, but markers with assignments to other trials in the space survive. The dialog reads "1,847 markers (123 removed entirely; rest unlinked from these trials)".

### #4 Polymorphic entity cleanup triggers

Four `AFTER DELETE` triggers, one each on `companies`, `products`, `trials`, `markers`:

```sql
create trigger _cleanup_polymorphic_refs_company
  after delete on public.companies
  for each row execute function public._cleanup_polymorphic_refs('company');
-- analogous for products, trials, markers
```

```sql
create or replace function public._cleanup_polymorphic_refs(p_type text)
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.primary_intelligence_links
    where entity_type = p_type and entity_id = old.id;
  delete from public.primary_intelligence
    where entity_type = p_type and entity_id = old.id;
  delete from public.material_links
    where entity_type = p_type and entity_id = old.id;
  return old;
end;
$$;
```

The trigger fires under cascade too: when a company delete cascades to its products, the products trigger fires per-product, cleaning up the polymorphic refs to each product. No coverage gaps.

The preview RPCs include `primary_intelligence` and `material_links` counts by querying these polymorphic columns directly (already indexed via `idx_primary_intelligence_entity`, `idx_primary_intelligence_links_entity`, `idx_material_links_entity`).

### #5 Orphan marker cleanup

```sql
create or replace function public._cleanup_orphan_marker()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- only the last assignment removal can orphan a marker
  if not exists (
    select 1 from public.marker_assignments
    where marker_id = old.marker_id
  ) then
    delete from public.markers where id = old.marker_id;
  end if;
  return old;
end;
$$;

create trigger _cleanup_orphan_marker_trigger
  after delete on public.marker_assignments
  for each row execute function public._cleanup_orphan_marker();
```

Reentrancy with the space-delete flow: the existing `delete from public.markers where space_id = p_space_id` step in `permanently_delete_space` deletes markers directly, which cascades to `marker_assignments`. The orphan trigger then fires on each assignment with the parent marker already gone, so the `not exists` check is true but the subsequent `delete from markers` is a no-op. Safe.

### R2 file cleanup queue

New table:

```sql
create table public.r2_pending_deletes (
  id            uuid primary key default gen_random_uuid(),
  file_path     text not null,
  queued_at     timestamptz not null default now(),
  attempted_at  timestamptz,
  succeeded_at  timestamptz,
  attempt_count int not null default 0,
  last_error    text
);

create index r2_pending_deletes_pending
  on public.r2_pending_deletes (queued_at)
  where succeeded_at is null;
```

```sql
create trigger _enqueue_r2_delete
  after delete on public.materials
  for each row execute function public._enqueue_r2_delete();

-- body inserts (old.file_path) into r2_pending_deletes.
```

A Cloudflare Worker (or an extension of the existing ct.gov polling worker) drains the queue every minute, calls R2 DELETE per row, and updates `succeeded_at` or `last_error` + `attempt_count`. Rows past N attempts are surfaced for ops review rather than retried infinitely.

`delete_material()` is updated: stop returning `file_path` for client-side cleanup. The trigger does it. Same for the space cascade path which today does nothing about files at all.

### #6 User redaction

Add `auth.users.redacted_at timestamptz null` via a `public.user_redactions(user_id uuid primary key, redacted_at timestamptz)` mirror table (since direct schema modification of `auth.users` is fragile across Supabase upgrades).

```sql
public.redact_user(p_user_id uuid) returns jsonb
  -- gate: is_platform_admin()
  -- actions:
  --   1. delete from public.tenant_members  where user_id = p_user_id
  --   2. delete from public.space_members   where user_id = p_user_id
  --   3. delete from public.agency_members  where user_id = p_user_id
  --   4. delete from public.platform_admins where user_id = p_user_id
  --   5. update auth.users set
  --        email = 'redacted-' || p_user_id || '@invalid',
  --        raw_user_meta_data = '{}',
  --        raw_app_meta_data = '{}'
  --      where id = p_user_id
  --   6. insert into public.user_redactions (user_id, redacted_at) values (p_user_id, now())
  --   7. for each audit_events row with actor_user_id = p_user_id:
  --        update metadata = jsonb_strip_pii_keys(metadata)
  --   8. emit audit_events row: compliance.user_pii_redacted
  -- returns: counts of rows scrubbed per table
```

Authorship FKs (`spaces.created_by`, `markers.created_by`, `materials.uploaded_by`, `primary_intelligence.last_edited_by`, etc.) stay NOT NULL NO ACTION. The user row persists; the human is gone. UI resolves `created_by` against `auth.users` first; if `user_redactions.user_id` is non-null, render "(redacted user)" instead of the email.

Login is blocked downstream because the email is mangled to an unroutable value and `raw_app_meta_data` is empty (no provider claims). If the redacted user attempts re-login via OAuth, the provider sub will not match (the row exists, but the email check upstream will fail). For belt-and-suspenders, add a `disabled_at` claim check in the auth callback that rejects redacted users explicitly.

## UI

### Confirm dialog component

Replace today's `confirmDelete` helper (`src/client/src/app/shared/utils/confirm-delete.ts`) with a count-aware variant. The new contract:

```ts
confirmDelete(confirmation, {
  header: 'Delete company',
  entityLabel: 'Eli Lilly',           // shown in title and required as typed input
  message: 'This will permanently delete:',
  counts: previewResult,              // jsonb from preview_company_delete()
  requireTypedConfirmation: true,     // default true for named entities
  typedConfirmationValue: 'Eli Lilly' // or 'delete' for unnamed items
})
```

For unnamed-item deletes (single marker, single note, single event), `typedConfirmationValue: 'delete'`. Friction is uniform across all destructive operations.

### Surfaces touched

- `space-general.component.ts`: add Archive / Restore actions; existing Delete becomes Permanently delete and is hidden unless the caller is tenant owner or platform admin.
- `space-settings`: an Archived tab listing archived spaces with Restore and Permanently delete actions.
- `company-list.component.ts:213`: replace `details:` line with the count breakdown render. Same for `product-list`, `trial-list`, `asset-list`, `therapeutic-area-list`, `mechanism-of-action-list`, `route-of-administration-list`, `marker-type-list`, `taxonomies-page`, `materials-browse-page`, `events-page`, `marker-detail`, `trial-detail`, `engagement-detail`, `super-admin-agencies`, `tenant-settings`.
- Render fallbacks: `(redacted user)`, `(uncategorized)`, `(archived)` for the three new null-or-flag states. Add to `core/utils/display-fallbacks.ts` (new file) and reference from `created-by` chips, `therapeutic-area` chips, and space list rows.

## Tests

Project rule: every behavior change ships its test inline (no deferred "Phase N: tests" pile). The cascade-safety surface touches five test layers; each one is enumerated below.

### Layer 1: SQL inline smoke tests (per migration)

Mirroring the pattern from `20260503090000_delete_space_rpc.sql`: each new migration ends with a `do $$ ... raise notice '... PASS' end $$;` block that builds a fixture, exercises the migration's surface, asserts, and tears down with the `clint.member_guard_cascade` bypass pattern.

| Migration | Inline smoke test |
|---|---|
| `r2_pending_deletes` table + AFTER DELETE trigger + `delete_material` revision | Delete a material directly: assert one `r2_pending_deletes` row with the expected `file_path`. Delete a space containing N materials: assert N rows enqueued. Verify `delete_material` no longer returns `file_path` in the result shape. |
| `user_redactions` + `redact_user` RPC | Build a user with rows across `tenant_members`, `space_members`, `agency_members`, `platform_admins`, plus authorship columns on `spaces`, `markers`, `materials`, `primary_intelligence`. Call `redact_user`. Assert: all membership rows gone, all authorship rows survive with the original `user_id`, `auth.users.email` mangled, `user_redactions` row exists, `audit_events` has a `compliance.user_pii_redacted` row. Verify non-platform-admin call raises `42501`. |
| Polymorphic cleanup triggers (4 triggers) | For each of `companies`, `products`, `trials`, `markers`: create the parent, plus a `primary_intelligence` (entity_type / entity_id), `primary_intelligence_links`, and `material_links` pointing at it. Delete the parent. Assert all three child tables are clean for that parent. Run all four parents in one smoke block. |
| Orphan-marker cleanup trigger | Case A: marker assigned to two trials. Delete one trial. Assert marker survives, has one remaining assignment. Case B: marker assigned to one trial. Delete the trial. Assert marker is gone. Case C: space cascade path. Delete a space directly via `delete from public.spaces`. Assert no spurious re-deletes (trigger fires but marker already gone). |
| `spaces.archived_at` + `archive_space` / `restore_space` / `permanently_delete_space` | Space owner: archive (succeeds), restore (succeeds), permanently_delete (42501). Tenant owner: permanently_delete on non-archived space (42501), permanently_delete on archived space (succeeds). Platform admin: permanently_delete on non-archived space (succeeds, the platform-admin override). Verify audit row emitted on each path. |
| FK flips (`products.company_id`, `trials.product_id`, `trial_notes.trial_id`, `trials.therapeutic_area_id`) | Pre-flip: assert delete blocks today. Post-flip: insert company → product → trial → trial_notes; delete company; assert cascade reaches all four tables. Separately: insert therapeutic_area → trial; delete TA; assert trial survives with `therapeutic_area_id = null`. |
| Preview RPCs (`preview_company_delete`, `preview_product_delete`, `preview_trial_delete`) | Build deterministic fixture with known counts (e.g., 2 products, 3 trials, 5 events, 1 material, 2 PI reads, 4 marker assignments, 1 marker-orphan, 3 marker-unlinked-only). Call each preview RPC. Assert the jsonb output matches the fixture exactly. Verify caller without space access gets `42501`. Verify preview is read-only (no mutation). |

### Layer 2: Vitest unit specs (new)

- `src/client/src/app/shared/utils/confirm-delete.spec.ts` (NEW): count breakdown rendering, type-the-name enforcement (named vs unnamed), cancel path, submit path, validation error when typed string mismatches.
- `src/client/src/app/core/utils/display-fallbacks.spec.ts` (NEW): `(redacted user)` resolution from `user_redactions`, `(uncategorized)` for `therapeutic_area_id is null`, `(archived)` for `spaces.archived_at is not null`.
- `src/client/worker/test/r2-drain/queue.spec.ts` (NEW): mocked R2 delete client. Drain happy path. Retry on transient failure. `attempt_count` increments. Rows past max attempts surface for ops review. Idempotency on re-drain.

### Layer 3: Vitest unit specs (update)

- `src/client/src/app/shared/components/intelligence-history-panel/history-timeline.spec.ts`: assert "(redacted user)" fallback when `last_edited_by` resolves to a redacted user.
- Service specs implied by new methods: `company.service`, `product.service`, `trial.service`, `material.service`, `space.service` get coverage for the new preview / archive / restore / permanently_delete flows. (No existing specs for these services today; this design adds them.)

### Layer 4: Integration specs (new + update)

**New**:

- `src/client/integration/tests/rpc-cascade-safety.spec.ts` (NEW): exercises `preview_company_delete`, `preview_product_delete`, `preview_trial_delete`, `archive_space`, `restore_space`, `permanently_delete_space` against real PostgREST as space owner, tenant owner, contributor, reader, platform admin, anon. One describe block per RPC; per-role expectations table-driven.
- `src/client/integration/tests/rpc-redaction.spec.ts` (NEW): exercises `redact_user` end-to-end via the platform-admin client. Asserts `auth.users` email mangled, all four membership tables cleared, `user_redactions` populated, audit event emitted, login attempts with the old email fail.

**Update**:

- `src/client/integration/tests/rpc-destructive.spec.ts`: replace the `delete_space` describe block with the `archive_space` / `restore_space` / `permanently_delete_space` matrix. Update the `delete_material` describe block: drop the `file_path` return-shape assertion, add an assertion that `r2_pending_deletes` gets a row after the call.
- `src/client/integration/tests/audit-emission.spec.ts`: add coverage for the four new audit actions (`space.archived`, `space.restored`, `space.deleted` for the new RPC, `compliance.user_pii_redacted` extension).
- `src/client/integration/tests/audit-redaction.spec.ts`: extend the existing `redact_user_pii` coverage to assert the full `redact_user` flow also triggers PII strip across audit metadata.

### Layer 5: Playwright e2e specs (new + update)

**New**:

- `src/client/e2e/tests/space-archive.spec.ts` (NEW): space owner archives. Space disappears from default list, appears under Archived tab. Owner restores. Tenant owner permanently deletes from the Archived tab; type-the-name dialog enforced; final delete succeeds. Verify space is gone from all surfaces.
- `src/client/e2e/tests/cascade-confirm-dialog.spec.ts` (NEW): for each of company / product / trial / asset / TA / RoA / MoA / marker-type delete, assert the dialog renders count breakdown from the preview RPC, type-the-name field is required, mismatched name keeps submit disabled, matching name enables it, cancel closes. Separately: single-marker delete uses literal `delete` typed-confirm.

**Update**:

- `src/client/e2e/tests/company-management.spec.ts:82` (`delete company succeeds`): rewrite. Old flow expected the "It may have associated assets" error path; new flow expects the count preview dialog and type-the-name field. Verify products / trials / events / materials are all gone after delete.
- `src/client/e2e/tests/trial-management.spec.ts`: same shape. Trial delete now cascades to marker_assignments (and orphan markers) and trial_notes. Verify counts in dialog match what cleanup actually removes.
- `src/client/e2e/tests/asset-management.spec.ts`: product delete cascade now reaches trials and below. Update fixture and assertions.
- `src/client/e2e/tests/space-settings.spec.ts`, `space-management.spec.ts`: delete affordance becomes Archive. Add coverage that the Delete permanently affordance is hidden for space owners and visible for tenant owners.
- `src/client/e2e/tests/therapeutic-areas.spec.ts`: TA delete sets `trials.therapeutic_area_id` to null instead of blocking. Add assertion that affected trials render with `(uncategorized)`.
- `src/client/e2e/tests/taxonomies.spec.ts`, `marker-types.spec.ts`: type-the-name confirm on every named delete.
- `src/client/e2e/tests/intelligence-crud.spec.ts`, `intelligence-history.spec.ts`: when the underlying entity is deleted, the associated primary_intelligence rows must also be gone (polymorphic cleanup trigger). Add fixture coverage.
- `src/client/e2e/tests/tenant-settings.spec.ts`: tenant delete cascade now also drains `r2_pending_deletes` for every material under the tenant. Update fixture / assertions.

### Coverage gate

Before merging the implementation:

1. `npm run test:units` green (Vitest, units + new specs).
2. `npm run test:integration` green (integration, new specs + updates).
3. `npx playwright test` green (e2e, new specs + updates).
4. `npm run test:worker` green (worker, new r2-drain specs).
5. `supabase db reset` green (every migration's inline smoke test passes).
6. `npm run lint && ng build` clean.

`src/client/scripts/run-all-tests.sh` runs all six phases in order; that script is what gates the pre-push hook.

## Migration order

The schema changes have FK interdependencies; sequencing matters.

1. `r2_pending_deletes` table + trigger + `delete_material` revision. (Independent.)
2. `user_redactions` table + `redact_user` RPC. (Independent.)
3. Polymorphic cleanup triggers. (Independent.)
4. Orphan-marker cleanup trigger. (Independent.)
5. `spaces.archived_at` + `archive_space` / `restore_space` / `permanently_delete_space` RPCs. (Independent. Deprecates `delete_space`; callers updated in same migration.)
6. FK flips on `products.company_id`, `trials.product_id`, `trial_notes.trial_id`, `trials.therapeutic_area_id`. (Independent.)
7. Preview RPCs. (Depends on #3 and #4 to give honest counts; depends on #6 because the count of `materials` and `primary_intelligence` reflects what the cascade plus triggers will actually remove.)

Each step ships as its own migration with its own smoke test. Frontend changes can land alongside or after step 7.

## Risks

- **Replacing `delete_space` mid-flight.** Smoke tests in existing migrations reference `delete_space()` directly (`20260503090000_delete_space_rpc.sql:128`, `20260510001400_audit_instrument_spaces.sql:117`). Those are migration-internal smoke tests, not runtime callers; they can stay or be rewritten to call `permanently_delete_space()` after archiving the test fixture. No production callers exist beyond the space-settings UI.
- **R2 worker correctness.** Until the worker is shipped, every materials delete enqueues but no file actually clears. Ship the worker in the same release as the trigger, or accept temporary R2 bloat with a known drain path.
- **Trigger reentrancy.** The orphan-marker trigger fires under cascade. Verified in the smoke test that the second-order `delete from markers` is a no-op when the parent marker is already gone.
- **Pre-existing `auth.users` rows with redacted emails.** The redact function reuses `redacted-<uuid>@invalid` as the sentinel. Verify no migration test creates that email format.
- **Type-the-name UX on tablet / mobile.** Type-to-confirm is friction by design, but on touch keyboards it is high friction. Pharma CI is a desktop product (the Bloomberg/Citeline reference set), so this is acceptable.

## Decision log

- Archive does not auto-expire to permanent delete. Indefinite archive; admin explicit action only. (2026-05-20)
- `events.{company,product,trial}_id` stay CASCADE. The "cascade and warn" pattern beats the "unlink and orphan" pattern for pharma CI cleanup workflows. (2026-05-20)
- `event_links` keeps double-cascade. Severing links to a deleted event has no other valid semantic. (2026-05-20)
- Polymorphic columns stay; cleanup is trigger-based. Per-type FK rewrite deferred. (2026-05-20)
- `auth.users` is never hard-deleted in this design. Redaction matches the audit-log philosophy already in place. (2026-05-20)
- Therapeutic areas are categorical. Deleting a TA sets `trials.therapeutic_area_id` to null, not cascade. (2026-05-20)
- Type-the-name confirmation applies to every destructive action. Unnamed items type the literal word "delete". (2026-05-20)
