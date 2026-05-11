# Deferred items

Cross-cutting backlog of work that was intentionally deferred during a feature implementation: future enhancements, optional follow-ups, items waiting on an external trigger (a customer ask, a regulator, observability rollout, volume threshold, etc.). Each entry has a status, the spec or feature it came from, the trigger that would unblock it, and a fix shape so a future session can pick it up cold.

This list complements per-spec "Deferred follow-ups" sections. Specs are the source of truth for context; this file is the running index. When picking up an item, link the work commit back to the entry and flip the status.

Statuses: `open` (not started), `in-progress` (work begun, not landed), `done` (shipped, with commit reference).

Conventions:
- Newest entries at the top of each section.
- Each entry numbered globally so cross-references survive reordering within sections.
- "Surfaced" line names the spec or session that produced the deferral, with a date so age is visible.

---

## Open

### 6. Manual test plan for audit log feature
- **Status:** open. Vitest integration suite covers the backend behavior (RPC emission, RLS, GDPR redaction, list/export, lockdown) but no human has walked the four UI surfaces (agency portal, tenant settings tab, space sidebar, super-admin) end-to-end against a real workspace. Need a written manual test plan a human can follow to verify and *understand* the feature.
- **Spec:** `docs/superpowers/specs/2026-05-10-audit-log-design.md`.
- **Trigger:** before the first paying pharma customer, or before a SOC 2 evidence collection pass. Useful as soon as a real workspace is provisioned with realistic actors so the audit rows look meaningful.
- **Fix shape:** create `docs/test-plans/2026-05-??-audit-log-manual-test.md` mirroring the access-model test plan style. Should walk through:
  - Per-scope visibility: sign in as agency owner, tenant owner, strict tenant owner without space membership, space owner, space editor, space viewer, no-memberships user, and confirm each sees the right subset of audit rows on their respective page.
  - Action emission: trigger each Tier 1 action (provision tenant, update branding, update access policy, suspend tenant, invite tenant member, redeem invite, change space member role, register custom domain, grant platform admin) and confirm the corresponding event appears with the expected metadata.
  - Filter + CSV export: exercise actor / action / date-range filters; export and inspect the CSV.
  - GDPR redaction: call `redact_user_pii` as platform admin against a real test user; confirm the user's email/IP/UA are scrubbed in the UI but the action record is preserved.
  - Edge cases: tenant suspension blocks writes but audit reads continue; deleted space's audit rows still show their UUID after the space is gone; agency owner without explicit tenant membership cannot see tenant-scoped rows.
- **Surfaced:** 2026-05-10 by aadi529 after audit-log feature shipped; integration suite passes but no manual run-through has happened.

### 5. Read event capture for audit log
- **Status:** open. Only act if HIPAA scope ever enters (Clint storing PHI-adjacent data) or a customer explicitly contracts for read-access audit. Current spec opts out: pharma CI is not PHI, SOC 2 doesn't require it.
- **Spec:** `docs/superpowers/specs/2026-05-10-audit-log-design.md` (Read events section).
- **Trigger:** customer brings PHI-adjacent data, HIPAA reviewer asks, or regulated-data customer signs.
- **Fix shape:** fundamentally different volume model. Choose between full SELECT logging (every row read), targeted high-value reads (member list views, exports, audit-log opens), or per-tenant opt-in. Each option has its own schema + retention + cost implications. Re-brainstorm before implementing.
- **Surfaced:** 2026-05-10 audit-log spec.

### 4. Per-tenant retention policy for audit log
- **Status:** open. Only act if a tenant requests shorter retention.
- **Spec:** `docs/superpowers/specs/2026-05-10-audit-log-design.md` (Retention and GDPR).
- **Trigger:** tenant contract negotiation requesting non-default retention.
- **Fix shape:** add a `retention_days` column to `tenants` (or a `tenant_audit_settings` table). Add a scheduled purge RPC that deletes rows older than the per-tenant policy. Will conflict with the current append-only intent; document the trade-off in the spec deviation.
- **Surfaced:** 2026-05-10 audit-log spec.

### 3. Hash chain or KMS row signing for audit log
- **Status:** open. Only act if a customer or auditor explicitly asks for tamper evidence.
- **Spec:** `docs/superpowers/specs/2026-05-10-audit-log-design.md` (Integrity section, options C and D).
- **Trigger:** SOC 2 auditor or pharma customer asking "prove this log is tamper-evident", or 21 CFR Part 11 entering scope.
- **Fix shape:**
  - Hash chain: add `prev_hash` and `row_hash` columns to `audit_events`. Each insert computes sha256 over the canonical row plus prev_hash. Provide a verifier function that scans for chain breaks. Per-tenant chain probably easier than global.
  - KMS row signing: each insert signs the row via an external KMS. Significant ops dependency.
- **Surfaced:** 2026-05-10 audit-log spec.

### 2. Cold archival of audit_events to R2
- **Status:** open. Activate when volume forces a Postgres move (likely years away at Tier 1 rates).
- **Spec:** `docs/superpowers/specs/2026-05-10-audit-log-design.md` (Retention).
- **Trigger:** audit_events row count exceeds ~10M, query latency degrades, or storage cost forces a tier.
- **Fix shape:** scheduled job (pg_cron or a Worker) exports rows older than 2 years to R2 as compressed JSON, then deletes from Postgres. BRIN index on `occurred_at` is already in place to make the export efficient. Query tooling that spans both stores is out of scope for v1.
- **Surfaced:** 2026-05-10 audit-log spec.

### 1. Axiom mirror for audit events
- **Status:** open. Lands with the observability rollout.
- **Spec:** `docs/superpowers/specs/2026-05-10-audit-log-design.md` (Observability relationship). Companion: `docs/superpowers/specs/2026-04-29-observability-design.md`.
- **Trigger:** observability spec finalized, Axiom provisioned.
- **Fix shape:** single-line addition to `record_audit_event()` after the DB insert: `pg_net.http_post('https://api.axiom.co/...', headers, payload)`. DB stays canonical; Axiom is best-effort fire-and-forget. `request_id` is already captured at write time so cross-correlation works without backfill.
- **Surfaced:** 2026-05-10 audit-log spec.

## Done

(none yet)
