---
id: spec-2026-cascade-safety
title: Cascade Safety
slug: cascade-safety
status: pending
created: 2026-05-20
updated: 2026-05-20
design_doc: docs/superpowers/specs/2026-05-20-cascade-safety-design.md
---

# Cascade Safety

## Summary

Make every destructive action in the schema either reversible, gated by friction proportional to its blast radius, or both. Addresses six cascade hazards identified in the 2026-05-20 audit: space cascade blast radius, blocking parent-entity FKs, event-link double-cascade, polymorphic-column dangling refs, orphan-marker stranding, and inconsistent `auth.users` deletion behavior.

Full design rationale, schema diffs, RPC signatures, trigger bodies, and decision log live in the design doc at `docs/superpowers/specs/2026-05-20-cascade-safety-design.md`. This spec is the actionable task list and status tracker.

## Goals

- Zero accidental data loss from owner-level UI clicks on a populated space.
- Honest pre-flight visibility into what a destructive action will actually delete.
- Storage cleanup enforced by Postgres triggers, not client cooperation.
- Authorship preserved across user removal, via redaction rather than deletion.
- Type-the-name confirmation friction on every destructive action.

## Non-Goals

- Hard-purge `auth.users` for regulator demand (deferred).
- Per-type FK rewrite of polymorphic `entity_id` columns (triggers cover the gap).
- Restoration of permanently deleted spaces (archive tier owns recoverability).

## Migration Order

Tasks are sequenced by FK / trigger interdependencies. T1 through T7 are independent migrations (each can land in any order EXCEPT preview RPCs depend on the triggers being in place to give honest counts). T8 through T19 layer worker, UI, and test coverage on top.

## Tasks

```yaml
tasks:

  # ============================================================
  # Database migrations (each ships with its inline smoke test)
  # ============================================================

  - id: T1
    title: "r2_pending_deletes table + materials AFTER DELETE trigger"
    description: |
      Create public.r2_pending_deletes table (id, file_path, queued_at,
      attempted_at, succeeded_at, attempt_count, last_error).
      Add AFTER DELETE trigger on public.materials that inserts a row
      with old.file_path. Update public.delete_material() to drop the
      file_path return value (trigger handles cleanup now).

      Inline smoke test asserts:
      - Direct material delete enqueues one row with the correct file_path.
      - Space cascade through materials enqueues N rows.
      - delete_material return shape no longer contains file_path.
    files:
      - create: supabase/migrations/<ts>_r2_pending_deletes_queue.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T2
    title: "user_redactions + redact_user RPC"
    description: |
      Create public.user_redactions (user_id pk, redacted_at). Create
      public.redact_user(p_user_id uuid) RPC, platform-admin gated.
      Body: delete from tenant_members, space_members, agency_members,
      platform_admins; mangle auth.users.email and clear raw meta;
      insert user_redactions; sweep audit_events.metadata via
      jsonb_strip_pii_keys; emit compliance.user_pii_redacted audit row.

      Inline smoke test asserts:
      - Membership rows wiped across all four tables.
      - Authorship rows survive with original user_id.
      - auth.users.email mangled to redacted-<uuid>@invalid.
      - user_redactions row exists.
      - audit_events has compliance.user_pii_redacted row.
      - Non-platform-admin caller gets 42501.
    files:
      - create: supabase/migrations/<ts>_user_redaction_rpc.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T3
    title: "Polymorphic cleanup triggers (4 triggers, one function)"
    description: |
      Create public._cleanup_polymorphic_refs(p_type text) trigger
      function. Attach AFTER DELETE triggers on companies, products,
      trials, markers that call it with the appropriate p_type.
      Function deletes from primary_intelligence, primary_intelligence_links,
      and material_links where (entity_type, entity_id) matches.

      Inline smoke test asserts:
      - For each of the 4 parent tables: create parent + matching PI / PIL /
        material_link rows; delete parent; assert all three child tables
        are clean for that parent.
    files:
      - create: supabase/migrations/<ts>_polymorphic_cleanup_triggers.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T4
    title: "Orphan-marker cleanup trigger on marker_assignments"
    description: |
      Create public._cleanup_orphan_marker() trigger function. Attach
      AFTER DELETE trigger on marker_assignments. Function deletes the
      parent marker if it has zero remaining assignments after the
      assignment row is removed.

      Inline smoke test asserts:
      - Marker assigned to two trials: delete one trial; marker survives.
      - Marker assigned to one trial: delete the trial; marker is gone.
      - Space cascade path: trigger fires but parent marker already
        gone via the direct delete-from-markers step; no spurious error.
    files:
      - create: supabase/migrations/<ts>_orphan_marker_cleanup.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T5
    title: "Space archive lifecycle: archived_at + 3 RPCs"
    description: |
      Add spaces.archived_at timestamptz nullable. Default queries
      filter archived_at is null. Create archive_space(uuid),
      restore_space(uuid), permanently_delete_space(uuid) RPCs.
      archive / restore gated by has_space_access(owner).
      permanently_delete gated by is_tenant_member(spaces.tenant_id,
      array['owner']) OR is_platform_admin(); refuses if not archived
      unless caller is platform admin. Emit space.archived /
      space.restored / space.deleted audit events. Update existing
      migrations that referenced delete_space() to call the new RPC.

      Inline smoke test asserts:
      - Space owner: archive, restore succeed; permanently_delete 42501.
      - Tenant owner: permanently_delete on non-archived 42501;
        permanently_delete on archived succeeds.
      - Platform admin: permanently_delete on non-archived succeeds.
      - Audit row emitted for each path.
    files:
      - create: supabase/migrations/<ts>_space_archive_lifecycle.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T6
    title: "FK action flips on products/trials/trial_notes"
    description: |
      ALTER TABLE to flip:
      - products.company_id: NO ACTION -> CASCADE
      - trials.product_id: NO ACTION -> CASCADE
      - trial_notes.trial_id: NO ACTION -> CASCADE
      - trials.therapeutic_area_id: NOT NULL NO ACTION -> nullable SET NULL

      Inline smoke test asserts:
      - Delete company: cascades through products, trials, trial_notes,
        events, marker_assignments, orphan markers (via T4 trigger),
        primary_intelligence (via T3 trigger), materials (via T1 trigger).
      - Delete therapeutic area: trials survive with therapeutic_area_id
        null.
    files:
      - create: supabase/migrations/<ts>_cascade_fk_flips.sql
    dependencies: [T1, T3, T4]
    verification: "supabase db reset"

  - id: T7
    title: "Preview RPCs: company, product, trial"
    description: |
      Create three RPCs returning jsonb count breakdowns:
      preview_company_delete(uuid), preview_product_delete(uuid),
      preview_trial_delete(uuid). Each is read-only, RLS-gated on
      space access, returns counts that match exactly what cascade +
      triggers will remove (products, trials, events, materials, PI,
      PIL, marker_assignments, markers_removed_entirely,
      markers_unlinked_only, marker_notifications).

      Inline smoke test asserts:
      - Build deterministic fixture with known counts; assert preview
        output matches fixture exactly.
      - Caller without space access: 42501.
      - Preview is read-only (no mutation between two consecutive calls).
    files:
      - create: supabase/migrations/<ts>_preview_delete_rpcs.sql
    dependencies: [T1, T3, T4, T6]
    verification: "supabase db reset"

  # ============================================================
  # Cloudflare Worker
  # ============================================================

  - id: T8
    title: "R2 delete-queue drain worker"
    description: |
      Add r2-drain module to the existing Cloudflare Worker (or extend
      the ct.gov poller). Drain loop: select pending rows from
      r2_pending_deletes (succeeded_at is null), call R2 DELETE per
      row, update succeeded_at or last_error + attempt_count. Cap at
      max attempts (e.g. 5); rows beyond cap surface for ops review.
      Schedule: every 60 seconds (Workers cron or extend existing schedule).

      Vitest spec asserts:
      - Drain happy path (mocked R2 client) marks rows succeeded.
      - Transient failure increments attempt_count, retries on next drain.
      - Rows past max attempts not retried (logged for ops).
      - Idempotency on re-drain of already-succeeded rows.
    files:
      - create: src/client/worker/src/r2-drain/queue.ts
      - create: src/client/worker/test/r2-drain/queue.spec.ts
      - modify: src/client/worker/src/index.ts
    dependencies: [T1]
    verification: "cd src/client && npm run test:worker"

  # ============================================================
  # Frontend utilities
  # ============================================================

  - id: T9
    title: "display-fallbacks utility + Vitest spec"
    description: |
      Create core/utils/display-fallbacks.ts with three resolvers:
      resolveUserDisplay(user, redaction?) -> '(redacted user)' when
      redaction present; resolveTherapeuticAreaLabel(ta?) ->
      '(uncategorized)' when null; resolveSpaceBadge(space) ->
      '(archived)' when archived_at present. Reference from chips and
      list rows that render these fields.

      Vitest spec asserts each resolver's branches.
    files:
      - create: src/client/src/app/core/utils/display-fallbacks.ts
      - create: src/client/src/app/core/utils/display-fallbacks.spec.ts
    dependencies: [T2, T5, T6]
    verification: "cd src/client && npm run test:units"

  - id: T10
    title: "Count-aware confirm-delete dialog + Vitest spec"
    description: |
      Upgrade shared/utils/confirm-delete.ts: accept counts (jsonb from
      preview RPC) and typedConfirmationValue (entity name or 'delete').
      Render count breakdown table in the dialog. Submit disabled until
      typed input matches typedConfirmationValue exactly. Cancel returns
      false; submit returns true.

      Vitest spec asserts:
      - Count breakdown renders all keys with values.
      - Type-mismatch keeps submit disabled.
      - Exact match enables submit.
      - Cancel resolves false; submit resolves true.
      - Unnamed-item path requires literal 'delete'.
    files:
      - modify: src/client/src/app/shared/utils/confirm-delete.ts
      - create: src/client/src/app/shared/utils/confirm-delete.spec.ts
    dependencies: [T7]
    verification: "cd src/client && npm run test:units"

  # ============================================================
  # Frontend surfaces
  # ============================================================

  - id: T11
    title: "Space settings: archive / restore / permanently-delete UI"
    description: |
      Update space-settings/space-general.component: replace Delete
      action with Archive. Add Archived tab listing archived spaces
      with Restore and Permanently delete actions. Hide
      Permanently delete unless caller is tenant owner or platform
      admin. Wire to T5 RPCs. Include display-fallbacks for
      (archived) badge on the space list.

      Service-layer Vitest specs added for space.service: archive,
      restore, permanently_delete, list with archived filter.
    files:
      - modify: src/client/src/app/features/space-settings/space-general.component.ts
      - modify: src/client/src/app/features/space-settings/space-general.component.html
      - modify: src/client/src/app/core/services/space.service.ts
      - create: src/client/src/app/core/services/space.service.spec.ts
    dependencies: [T5, T9]
    verification: "cd src/client && npm run lint && npm run test:units"

  - id: T12
    title: "Wire preview + count dialog across all named-delete surfaces"
    description: |
      Replace today's plain confirm-delete calls with the count-aware
      variant on every named-delete surface. For each, fetch the
      preview RPC counts before opening the dialog, pass them in,
      pass typedConfirmationValue. Update copy: drop the misleading
      "Associated assets are unlinked" line on company delete.

      Surfaces touched:
      - manage/companies/company-list, company-detail
      - manage/assets/asset-list, asset-detail (products)
      - manage/trials/trial-list, trial-detail
      - manage/therapeutic-areas/therapeutic-area-list
      - manage/mechanisms-of-action/mechanism-of-action-list
      - manage/routes-of-administration/route-of-administration-list
      - manage/marker-types/marker-type-list
      - manage/taxonomies/taxonomies-page
      - manage/markers/marker-detail
      - manage/engagement/engagement-detail
      - materials-browse/materials-browse-page
      - events/events-page
      - super-admin/super-admin-agencies
      - tenant-settings/tenant-settings
      For unnamed-item deletes (single marker, single note, single
      event), typed value is the literal 'delete'.

      Service-layer Vitest specs added for company.service,
      product.service, trial.service, material.service.
    files:
      - modify: src/client/src/app/features/manage/companies/company-list.component.ts
      - modify: src/client/src/app/features/manage/assets/asset-list.component.ts
      - modify: src/client/src/app/features/manage/trials/trial-list.component.ts
      - modify: src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.ts
      - modify: src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-list.component.ts
      - modify: src/client/src/app/features/manage/routes-of-administration/route-of-administration-list.component.ts
      - modify: src/client/src/app/features/manage/marker-types/marker-type-list.component.ts
      - modify: src/client/src/app/features/manage/taxonomies/taxonomies-page.component.ts
      - modify: src/client/src/app/features/manage/markers/marker-detail.component.ts
      - modify: src/client/src/app/features/manage/engagement/engagement-detail.component.ts
      - modify: src/client/src/app/features/materials-browse/materials-browse-page.component.ts
      - modify: src/client/src/app/features/events/events-page.component.ts
      - modify: src/client/src/app/features/super-admin/super-admin-agencies.component.ts
      - modify: src/client/src/app/features/tenant-settings/tenant-settings.component.ts
      - create: src/client/src/app/core/services/company.service.spec.ts
      - create: src/client/src/app/core/services/product.service.spec.ts
      - create: src/client/src/app/core/services/trial.service.spec.ts
      - create: src/client/src/app/core/services/material.service.spec.ts
    dependencies: [T7, T9, T10]
    verification: "cd src/client && npm run lint && npm run test:units && npm run build"

  # ============================================================
  # Integration tests
  # ============================================================

  - id: T13
    title: "rpc-cascade-safety integration spec (NEW)"
    description: |
      Cover preview_company_delete, preview_product_delete,
      preview_trial_delete, archive_space, restore_space,
      permanently_delete_space across role contexts (space owner,
      tenant owner, contributor, reader, platform admin, anon).
      Table-driven per-role expectations.
    files:
      - create: src/client/integration/tests/rpc-cascade-safety.spec.ts
    dependencies: [T5, T7]
    verification: "cd src/client && npm run test:integration"

  - id: T14
    title: "rpc-redaction integration spec (NEW)"
    description: |
      Cover redact_user end-to-end via the platform-admin client.
      Assert auth.users email mangled, all four membership tables
      cleared, user_redactions row, compliance.user_pii_redacted
      audit row. Verify login attempts with old email fail.
    files:
      - create: src/client/integration/tests/rpc-redaction.spec.ts
    dependencies: [T2]
    verification: "cd src/client && npm run test:integration"

  - id: T15
    title: "Update rpc-destructive, audit-emission, audit-redaction"
    description: |
      - rpc-destructive.spec.ts: replace delete_space describe block
        with archive_space / restore_space / permanently_delete_space
        matrix. Update delete_material describe block: drop file_path
        return-shape assertion, add r2_pending_deletes row assertion.
      - audit-emission.spec.ts: add coverage for space.archived,
        space.restored, space.deleted (new RPC),
        compliance.user_pii_redacted.
      - audit-redaction.spec.ts: extend redact_user_pii coverage to
        full redact_user flow.
    files:
      - modify: src/client/integration/tests/rpc-destructive.spec.ts
      - modify: src/client/integration/tests/audit-emission.spec.ts
      - modify: src/client/integration/tests/audit-redaction.spec.ts
    dependencies: [T1, T2, T5]
    verification: "cd src/client && npm run test:integration"

  # ============================================================
  # Playwright e2e tests
  # ============================================================

  - id: T16
    title: "space-archive e2e spec (NEW)"
    description: |
      Space owner archives. Space disappears from default list,
      appears under Archived tab. Owner restores. Tenant owner
      permanently deletes from Archived tab; type-the-name enforced;
      delete succeeds. Verify space is gone everywhere.
    files:
      - create: src/client/e2e/tests/space-archive.spec.ts
    dependencies: [T11]
    verification: "cd src/client && npx playwright test space-archive"

  - id: T17
    title: "cascade-confirm-dialog e2e spec (NEW)"
    description: |
      For each of company / product / trial / asset / TA / RoA / MoA /
      marker-type delete: assert dialog renders count breakdown from
      preview RPC; type-the-name field required; mismatched name keeps
      submit disabled; matching name enables it; cancel closes.
      Separately: single-marker / single-note / single-event delete
      uses literal 'delete' typed-confirm.
    files:
      - create: src/client/e2e/tests/cascade-confirm-dialog.spec.ts
    dependencies: [T12]
    verification: "cd src/client && npx playwright test cascade-confirm-dialog"

  - id: T18
    title: "Update existing e2e specs for new delete flows"
    description: |
      Rewrite delete-flow assertions in:
      - company-management.spec.ts (delete now cascades + preview + typed)
      - trial-management.spec.ts (cascade reaches marker_assignments + trial_notes)
      - asset-management.spec.ts (product cascade reaches trials)
      - space-settings.spec.ts, space-management.spec.ts (archive vs permanently_delete affordance per role)
      - therapeutic-areas.spec.ts (TA delete sets trials.therapeutic_area_id null; assert (uncategorized) render)
      - taxonomies.spec.ts, marker-types.spec.ts (type-the-name on every named delete)
      - intelligence-crud.spec.ts, intelligence-history.spec.ts (polymorphic cleanup of PI on parent delete)
      - tenant-settings.spec.ts (tenant cascade enqueues r2_pending_deletes for every material)
    files:
      - modify: src/client/e2e/tests/company-management.spec.ts
      - modify: src/client/e2e/tests/trial-management.spec.ts
      - modify: src/client/e2e/tests/asset-management.spec.ts
      - modify: src/client/e2e/tests/space-settings.spec.ts
      - modify: src/client/e2e/tests/space-management.spec.ts
      - modify: src/client/e2e/tests/therapeutic-areas.spec.ts
      - modify: src/client/e2e/tests/taxonomies.spec.ts
      - modify: src/client/e2e/tests/marker-types.spec.ts
      - modify: src/client/e2e/tests/intelligence-crud.spec.ts
      - modify: src/client/e2e/tests/intelligence-history.spec.ts
      - modify: src/client/e2e/tests/tenant-settings.spec.ts
    dependencies: [T12, T17]
    verification: "cd src/client && npx playwright test"

  # ============================================================
  # Coverage gate
  # ============================================================

  - id: T19
    title: "Full run-all-tests.sh green"
    description: |
      Execute the full pre-push battery to confirm every layer is
      green end-to-end:
      - lint
      - units (vitest)
      - units (playwright)
      - worker
      - build
      - db reset (every inline smoke test passes)
      - integration
      - e2e (playwright)
      Block merge until all eight phases pass.
    files: []
    dependencies: [T1, T2, T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15, T16, T17, T18]
    verification: "bash src/client/scripts/run-all-tests.sh"
```

## Risks

- **Replacing `delete_space` mid-flight.** Migration-internal smoke tests in `20260503090000_delete_space_rpc.sql` and `20260510001400_audit_instrument_spaces.sql` reference the old RPC. T5 must rewrite those callers in the same migration to keep `supabase db reset` green.
- **R2 worker shipping after the trigger.** Until T8 lands, every materials delete enqueues but no file actually clears. Either ship T8 alongside T1 in the same release window, or accept temporary R2 bloat with a known drain path.
- **Existing `rpc-destructive.spec.ts` coverage.** The header comment on that file notes a prior `delete_space` regression slipped through. T15 must replace coverage carefully, not just delete it.

## Decision log

See the design doc (`docs/superpowers/specs/2026-05-20-cascade-safety-design.md`) decision log section for the seven choices made during the 2026-05-20 brainstorm.
