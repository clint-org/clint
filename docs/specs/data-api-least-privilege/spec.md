---
id: spec-2026-data-api-least-privilege
title: Data API Least-Privilege Grants
slug: data-api-least-privilege
status: completed
created: 2026-06-11
updated: 2026-06-12
design_doc: docs/superpowers/specs/2026-06-11-data-api-least-privilege-design.md
---

# Data API Least-Privilege Grants

## Summary

Replace the broad legacy-parity grants baseline
(`20260611120000_restore_data_api_table_grants.sql`) with an explicit
per-table grants matrix: `anon` loses all table access, `authenticated` gets
exactly the table privileges the app, seed, and test suites demonstrably
use, `service_role` stays broad with an explicit deny-list (`audit_events`,
`r2_pending_deletes` writes). The legacy auto-grant default ACLs are revoked
on local and hosted so new tables start dark, and a CI drift gate compares
the live grant surface against the checked-in matrix after every reset,
failing on missing and excess grants alike.

Full rationale, decisions, replay analysis, and the prewritten rollback live
in the design doc. This spec is the actionable task list and status tracker.

## Goals

- Two locks on every table: explicit grant plus RLS. A single buggy policy
  no longer exposes rows by itself.
- `anon` cannot address any table; its surface is exactly the explicitly
  granted SECURITY DEFINER RPCs.
- The grant surface is a reviewed artifact (`supabase/data-api-grants.json`)
  enforced by CI in both directions, on every reset, forever.
- Hosted and local converge: the same migration that narrows local does the
  real revokes on dev and prod, and the six stray hosted-only anon function
  grants are removed.
- New tables start dark; their migrations must declare access.

## Non-Goals

- Consolidating the client's direct table writes into RPCs (the matrix
  becomes the worklist for that later refactor).
- Narrowing `service_role` (root-credential model; secret rotation guidance
  goes in the runbook instead).
- Any change to the curated function execute surface beyond the six stray
  hosted anon entries.

## Verification commands

- `supabase db reset` (throwaway stack, CLI latest)
- `supabase db advisors --local --type all --fail-on warn`
- `npm run grants:check` (new drift gate, from `src/client`)
- `npm run test:integration` (from `src/client`, env per `integration/README.md`)
- `npm run test:e2e` (from `src/client`)
- `npm run docs:arch` (regen, commit any drift)

## Tasks

```yaml
tasks:

  - id: T1
    title: "Grants matrix from evidence"
    description: |
      Build supabase/data-api-grants.json from static inventory: grep the
      Angular client, integration fixtures/tests, Playwright e2e fixtures,
      supabase/seed.sql + the _seed_demo_* helper bodies (SECURITY INVOKER,
      insert as authenticated), and the Cloudflare Workers for
      .from('<table>') usage and operations. Every row carries a
      justification string naming the consumer. Include the
      service_role deny-list (audit_events, r2_pending_deletes writes) as
      first-class entries. anon has no entries by construction.
      Cover all 52 public tables: tables absent from the matrix are
      implicitly no-access for authenticated and that absence is the
      assertion.
    files:
      - create: supabase/data-api-grants.json
    dependencies: []
    verification: "jq . supabase/data-api-grants.json && node -e 'matrix sanity: parses, has meta block, every entry justified'"

  - id: T2
    title: "Least-privilege migration"
    description: |
      New migration superseding the blanket parts of 20260611120000, in
      order: revoke the anon/authenticated table+sequence default ACLs
      (service_role ACL stays); revoke the blanket anon/authenticated table
      grants; apply the matrix grants (generated from
      supabase/data-api-grants.json; keep the generator snippet in a comment
      so the SQL is reproducible); revoke the six stray hosted anon function
      grants (export_audit_events_csv, get_latest_sync_run,
      is_tenant_owner_strict, list_audit_events,
      recompute_trial_change_events, trigger_single_trial_sync; no-op
      locally); inline smoke asserting a granted read, a granted write, an
      anon table denial, a service_role deny-list denial, and a
      not-in-matrix authenticated denial; notify pgrst, 'reload schema'.
    files:
      - create: supabase/migrations/<ts>_data_api_least_privilege.sql
    dependencies: [T1]
    verification: "supabase db reset (throwaway stack on shifted ports, CLI latest)"

  - id: T3
    title: "Grants drift gate"
    description: |
      src/client/scripts/check-data-api-grants.mjs: reads the matrix,
      queries information_schema.role_table_grants and pg_default_acl on the
      local database, fails on missing AND excess grants for anon and
      authenticated, and on deny-list violations for service_role. Wire as
      npm run grants:check, add to .github/workflows/ci.yml after the
      advisor step. Prove both directions locally: a temporary hand GRANT
      turns it red (excess), a temporarily deleted matrix row turns it red
      (excess again from the matrix side), a temporary REVOKE turns it red
      (missing).
    files:
      - create: src/client/scripts/check-data-api-grants.mjs
      - modify: src/client/package.json
      - modify: .github/workflows/ci.yml
    dependencies: [T2]
    verification: "npm run grants:check"

  - id: T4
    title: "Empirical verification loop"
    description: |
      On a throwaway stack built from scratch with CLI latest: supabase db
      reset, advisors --fail-on warn, npm run grants:check, full integration
      suite, full e2e suite. Every 42501 is either a missing matrix row (add
      with justification, regenerate migration grants, repeat) or an
      intentional denial (assert it in the migration smoke). Iterate until
      all five commands are green twice in a row from a fresh wipe. Record
      the final iteration count and any surprising consumers in the design
      doc's matrix methodology section.
    files:
      - modify: supabase/data-api-grants.json
      - modify: supabase/migrations/<ts>_data_api_least_privilege.sql
    dependencies: [T3]
    verification: "supabase db reset && supabase db advisors --local --type all --fail-on warn && npm run grants:check && npm run test:integration && npm run test:e2e"

  - id: T5
    title: "Runbook + docs regen"
    description: |
      Rewrite the "Data API Grants Baseline" section of
      docs/runbook/11-developer-guide.md for the new posture: matrix file,
      drift gate, new-table migration template (create table, RLS, policies,
      grants in one file), the one-line workflow when CI goes red on a new
      fixture, and service-role key hygiene (never client-side, rotation via
      dashboard, treat as root). Run npm run docs:arch and commit the regen.
    files:
      - modify: docs/runbook/11-developer-guide.md
      - modify: docs/runbook/07-database-schema.md
    dependencies: [T4]
    verification: "npm run docs:arch (no unexplained drift)"

  - id: T6
    title: "Rollout: PR, dev, prod"
    description: |
      Branch off develop, PR with the verification table, CI green
      (tests job now includes grants:check), merge. deploy-dev pushes the
      migration to the dev project: run npm run test:e2e against dev plus a
      manual smoke (sign-in, dashboard, manage, super-admin). Same day,
      approve the prod deploy through the production environment gate.
      Rollback if needed: apply the prewritten re-grant migration from the
      design doc appendix. Update project memory afterward.
    files:
      - modify: .github/workflows/ci.yml
    dependencies: [T5]
    verification: "gh pr checks <pr> && gh run watch <deploy-dev run> --exit-status"
```

## Open questions

None. Decisions (least privilege for authenticated, anon zero, service_role
broad with deny-list and rotation hygiene, same-day dev-then-prod rollout)
were settled with the user on 2026-06-11 and are recorded in the design doc.
