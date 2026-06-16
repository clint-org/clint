# Data API Least-Privilege Grants: Design

Date: 2026-06-11
Status: shipped (dev and prod, 2026-06-12)
Spec: `docs/specs/data-api-least-privilege/spec.md`

## Context

Supabase CLI 2.106.0 flipped `api.auto_expose_new_tables` to default false:
fresh local databases now revoke the legacy Data API default ACLs before
migrations run. The 2026-06-11 fix (PR #61) restored the legacy baseline via
`20260611120000_restore_data_api_table_grants.sql` so fresh local resets stay
grant-identical to the hosted projects, which were provisioned before the
flip and still carry the legacy ACLs.

That restored baseline is broad: `anon`, `authenticated`, and `service_role`
hold select/insert/update/delete on every table in `public`, with RLS as the
only gate. The advisor CI gate (`--fail-on warn`) enforces that RLS exists on
every table, so the posture is defensible, but it is one lock. A buggy or
missing policy on a single table exposes rows to any signed-in user.

This project moves the platform to two locks: explicit per-table grants in
addition to RLS, with the legacy auto-grant default ACLs revoked everywhere
(local and hosted), and a CI drift gate that keeps the live grant surface
equal to a reviewed matrix file forever.

The project is greenfield: no production users. Dev and prod cutover happen
the same day CI is green, with a prewritten rollback.

## Decisions

1. **authenticated: least privilege from observed usage.** The Angular
   client directly reads 33 of 52 public tables via supabase-js and writes
   roughly 20 of them; everything else flows through RPCs. The matrix grants
   exactly the observed surface (refined empirically, see Methodology), not
   blanket DML on all 52.

2. **anon: zero table access.** The only pre-auth surface is RPC
   (`get_brand_by_host`, `check_subdomain_available`, worker RPCs with shared
   secrets), all SECURITY DEFINER with explicit grants. RLS already returns
   zero rows to anon everywhere; after this project anon cannot address
   tables at all.

3. **service_role: broad, protected by secret hygiene, with a deny-list.**
   Narrowing the root key was considered and rejected: it keeps the
   provisioning RPCs either way, `BYPASSRLS` cannot be row-scoped, and every
   future fixture or ops script would pay recurring 42501 friction. Instead:
   the key is treated as a root credential (never shipped client-side,
   rotation guidance added to the runbook), and the matrix carries an
   explicit deny-list for tables where even root-key writes must go through
   SECURITY DEFINER RPCs. Today that list is `audit_events` (writes only via
   `record_audit_event()`) and `r2_pending_deletes`; the matrix makes it a
   first-class, extensible artifact.

4. **Function surface: unchanged.** The execute surface was already curated
   by `20260607120000` / `20260607130000` and reproduced exactly by
   `20260611120000`. This project does not touch function grants except to
   revoke six stray `anon` execute entries that exist only on hosted
   (`export_audit_events_csv`, `get_latest_sync_run`,
   `is_tenant_owner_strict`, `list_audit_events`,
   `recompute_trial_change_events`, `trigger_single_trial_sync`), aligning
   hosted with the already-tighter local state.

5. **New objects start dark everywhere.** The default ACLs that auto-grant
   `anon` and `authenticated` on new tables are revoked on local and hosted.
   `service_role` keeps its default ACL (decision 3). Every future
   `create table` migration must carry its own grants; the drift gate turns
   CI red if the matrix and the database disagree in either direction.

6. **Out of scope.** Consolidating the client's direct table writes into
   RPCs is deliberately excluded; the matrix encodes current reality and
   becomes the worklist for that later refactor. Narrowing `service_role`
   and row-scoping anything beyond RLS are also out.

## Matrix methodology

The matrix is evidence, not vibes:

1. Static inventory: grep the Angular client, integration fixtures and
   tests, Playwright e2e fixtures, `supabase/seed.sql`, and the Cloudflare
   Workers for `.from('<table>')` chains and the operation used. The seed
   path matters: `seed_demo_data` and its `_seed_demo_*` helpers are
   SECURITY INVOKER and insert as `authenticated`, so seed-touched tables
   need authenticated insert grants even where the app itself only reads.
2. Empirical refinement: build a throwaway database with the candidate
   matrix applied, run `supabase db reset`, the advisor gate, the full
   integration suite, and the Playwright e2e suite. Every 42501 is either a
   missing matrix row (add it, with justification) or an intentional denial
   (assert it in the smoke). Iterate until green. This is the same loop that
   validated the 2026-06-11 fix.
3. Every row carries a justification string (which consumer needs it). Rows
   without justification fail review.

### Empirical loop record (2026-06-11)

Four iterations on a throwaway stack (CLI 2.106.0, shifted ports): two triage
passes, then the two required all-green runs from complete fresh wipes
(volumes removed, fresh start, reset, advisors, drift gate, integration, e2e).

The one surprising consumer class the static inventory missed: SECURITY
INVOKER RPCs execute their reads and writes as the caller, so every table an
invoker RPC touches needs the corresponding authenticated grant even when no
client `.from()` chain addresses it. This added a third derivation rule to
the matrix meta block and eight row changes, all select unless noted:
asset_indications, condition_indication_map, trial_conditions (read by the
analytic get_dashboard_data / get_bullseye_* / get_landscape_index* /
get_positioning_data family, which the inventory had classed as RPC-only
tables), event_links and event_sources (read back by get_event_detail),
trial_change_events and primary_intelligence_links (new rows, read by the
dashboard and events feed RPCs and by list_primary_intelligence /
referenced_in_entity), and change_event_annotations
(insert/update/delete: upsert_change_event_annotation and
delete_change_event_annotation write as the caller, gated by RLS).
ctgov_sync_runs and trial_field_changes are also read by invoker functions
(get_latest_sync_run, recompute_trial_change_events) but no client, worker,
or test calls those as authenticated, so both stay dark and the smoke keeps
asserting it.

Intentional denials surfaced by the loop: three anon rows in
role-access.spec (direct tenants and spaces selects, and the anonymous
get_dashboard_data call) previously asserted RLS-empty results and now
assert 42501; the migration smoke gained matching anon denial assertions on
tenants and spaces. Two e2e specs (trial-management, dashboard zoom) failed
for reasons unrelated to grants: their selectors had drifted behind UI
refactors that the browser e2e suite, which CI does not run, never caught.
Both failures reproduced identically under the broad legacy baseline
(rollback SQL applied to the throwaway), confirming they predate this
project; the stale selectors were repaired in the same change.

## Artifacts

- **`supabase/data-api-grants.json`**: the matrix. Shape:
  `{ "tables": { "<table>": { "authenticated": ["select", ...], "service_role_denied": ["insert", ...] } }, ... }`
  plus a `meta` block recording methodology and review date. anon is absent
  by construction (zero rows); service_role is broad by default and only
  appears via the deny-list.
- **`supabase/migrations/<ts>_data_api_least_privilege.sql`**: supersedes
  the blanket parts of `20260611120000` at the end of migration history.
  Sections, in order: revoke the anon/authenticated default ACLs
  re-established by `20260611120000` (service_role ACL stays); revoke the
  blanket anon/authenticated table grants; apply the matrix grants; revoke
  the six stray hosted anon function grants; in-migration smoke asserting
  representative invariants (a granted read, a granted write, an anon
  denial, a deny-list denial, a not-in-matrix denial); finish with
  `notify pgrst, 'reload schema'`.
- **`src/client/scripts/check-data-api-grants.mjs`** plus an npm script and
  a CI step after the advisor gate: reads the matrix, queries
  `information_schema.role_table_grants` (and default ACLs) on the local
  database, fails on missing AND excess grants. Excess matters as much as
  missing: it is the regression detector for someone hand-granting in a
  future migration without updating the matrix.

## Fresh-reset replay analysis

Migration history replays on every reset. History before `20260611120000`
runs in the dark world (already privilege-safe after PR #61's three smoke
edits), `20260611120000` then grants broadly, and the new migration narrows
to the matrix at the end. The end state is the matrix; the intermediate
broad window exists only inside the reset transaction sequence and never
serves traffic. `seed.sql` runs after all migrations and therefore under the
matrix, which is why the seed path is part of the static inventory.

On hosted, `db push` applies only the new migration: the revokes do real
work there (hosted still has legacy ACLs), the matrix grants are largely
no-ops, and the result converges with local. The grants drift gate then
guarantees the two never diverge again.

## Rollout and rollback

1. PR to develop; CI "tests" job (fresh runner, reset, advisors, drift gate,
   integration) is the primary verifier.
2. Merge: deploy-dev pushes the migration to the dev project. Run the e2e
   suite against dev, plus a manual smoke of sign-in, dashboard, manage
   flows.
3. Same day, approve the prod deploy through the production environment
   gate.
4. Rollback: a prewritten re-grant migration (the blanket section of
   `20260611120000` re-applied, default ACLs restored) is kept in this
   design doc's appendix; applying it restores the pre-project posture in
   one `db push`.

## Risks

- **Hidden access paths** (Studio habits, ad-hoc scripts, the
  send-invite-email edge function): mitigated by the empirical loop, the
  same-day e2e pass against dev, and the cheap rollback. Greenfield status
  means a missed path inconveniences us, not users.
- **Seed and fixture churn**: any future fixture touching a new table goes
  red in CI until the matrix is updated. This is the design working, but it
  is new friction; the runbook documents the one-line workflow.
- **Applied-migration constraint**: `20260611120000` stays untouched in
  history; the new migration supersedes its effects. Fresh resets replay
  both and end at the matrix.

## Appendix: rollback migration body

```sql
-- Restore the legacy-equivalent broad baseline (pre least-privilege).
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables
  to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;
revoke select, insert, update, delete on public.platform_admins
  from anon, authenticated;
revoke select, insert, update, delete on public.r2_pending_deletes
  from anon, authenticated;
grant select on public.r2_pending_deletes to authenticated;
revoke insert, update, delete on public.r2_pending_deletes from service_role;
revoke insert, update, delete on public.user_redactions
  from anon, authenticated;
revoke insert, update, delete on public.audit_events
  from anon, authenticated, service_role;
notify pgrst, 'reload schema';
```
