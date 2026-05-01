# Role-Access Checker

[Back to test plan](2026-04-29-whitelabel-access-model.md), [spec](ui-editability-matrix.md), [follow-ups](follow-ups.md).

---

## Resume here (2026-05-01 pause point)

Test pass paused mid-Phase 6 (Space Reader). Tally so far: **38 of 53 boxes passed plus 1 n/a**. Anonymous (6/6), Platform Admin (8/8), Space Owner (6/6), Tenant Owner (8/8 + 1 n/a), Agency Owner (10/10) all complete. Reader (0/7), Contributor (0/9), Cross-cutting (0/5) remaining.

**Current prod state for the test:**
- Stout agency at `stout.clintapp.com`, owner `aadi529@gmail.com`. Email-domain lock = `gmail.com`.
- Pfizer tenant under Stout at `pfizer.clintapp.com`. id `a87a88ae-1b76-4c6b-85e0-1b53c926d0f2`. Tenant owners: `aadi529@gmail.com` and `aadimadala@gmail.com`.
- One space under Pfizer: SGLT2 Pipeline. id `746d4832-374d-4f0e-93ce-47839388aa29`. Space owner: `aadi529`.
- `madala.dodbele@gmail.com`: pure Space Reader of SGLT2 Pipeline, no other roles. (User row id `48990035-3b34-447d-abb6-c1af8c1da11f`.) She is set up for Phase 6.
- `aadityamadala@gmail.com`: only platform admin in `platform_admins`.
- Phase 6 is unblocked; the `has_tenant_access` fix (commit `1008726`, migration 84) is live. She can now reach `/t/<pfizer-id>/s/<sglt2-id>/...`.

**To advance Phase 6 from here:** sign in to Incognito as `madala.dodbele@gmail.com` (Google OAuth). Walk the 7 Reader scenarios below. The first 6 are browser; the last (curl POST on events) needs her JWT pasted from DevTools. Then transition to Phase 7 by SQL: `update space_members set role='editor' where space_id='746d4832-374d-4f0e-93ce-47839388aa29' and user_id='48990035-3b34-447d-abb6-c1af8c1da11f';` and walk the 9 Contributor scenarios.

Cleanup pending at end of run (Section 11 of `2026-04-29-whitelabel-access-model.md`):
- delete `auth.users` rows for `aadimadala@gmail.com`, `madala.dodbele@gmail.com` (cascades to memberships)
- the `agency-2` agency owned by `aadityamadala` looks like a stray from earlier experimentation; verify it is a throwaway before deleting
- any held-invite rows for `phase4-throwaway@gmail.com` or similar test emails

A short, runnable checklist that walks a fresh prod environment through the role boundaries in 30 minutes. One scenario per checkbox. Each row says: as <Actor>, do <action>, expect <observable result>. UI scenarios use a browser; API scenarios use curl with the actor's JWT.

## How to get a JWT for an actor

1. Sign in to the app as that actor in a browser.
2. Open DevTools, Application tab.
3. Cookies (when the host is on the apex) or Local Storage (otherwise) holds a Supabase session entry whose value is JSON containing `access_token`. Copy the token.
4. Also copy the anon key from any Network request to `*.supabase.co/rest/v1/...` (look at the `apikey` request header).

## Curl recipe

```bash
ANON='<anon key>'
JWT='<access_token>'
PROJECT='https://gmgprkymyjzkzirbzqzd.supabase.co'

# Read a table:
curl -sS "$PROJECT/rest/v1/<table>?select=*" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT" | jq 'length'

# Call an RPC:
curl -sS -X POST "$PROJECT/rest/v1/rpc/<fn>" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  -d '{"p_arg":"value"}'
```

## Anonymous

Open Incognito, do not sign in.

- [x] Visit `admin.clintapp.com/super-admin` → expect redirect to `/login`.
- [x] Visit `stout.clintapp.com/admin` → expect redirect to `/login`.
- [x] Visit `pfizer.clintapp.com/t/<pfizer-id>/spaces` → expect redirect to `/login`.
- [x] Visit `pfizer.clintapp.com/onboarding` → expect redirect to `/login`.
- [x] curl `rpc/provision_agency` with no Authorization → expect `42501 permission denied for function provision_agency` (PostgREST blocks at the GRANT layer before the function body's `Must be authenticated` check ever runs; defense in depth).
- [x] curl `rpc/get_dashboard_data` with no Authorization → expect HTTP 200 with body `[]`. The RPC is granted to anon by design but uses SECURITY INVOKER, so RLS on `companies` etc. filters every row out for an anon caller. Functionally indistinguishable from a denied call: anon learns nothing about which spaces or rows exist.

## Space Reader

Sign in as a Reader of the Survodutide Pipeline space.

- [ ] Visit the space catalysts page → expect data visible (page is read-only by design for everyone; no edit affordance to test here).
- [ ] Visit a trial detail page (Manage → Trials → click a trial) → attempt to edit any field, add a marker, or change phase data. Expect either no edit affordance rendered OR RLS rejection on save.
- [ ] Visit the space's `/settings/general` → expect the chrome but Save button blocked, Delete-space button blocked.
- [ ] Visit the space's `/settings/members` → expect chrome with read-only members table; no Invite-to-space button.
- [ ] curl `rpc/seed_demo_data` with `p_space_id=<survodutide-id>` → expect `Insufficient permissions`.
- [ ] curl POST on `events` with a valid body → expect RLS denial (`new row violates row-level security policy`).
- [ ] Visit `/t/<pfizer-id>/settings` → expect chrome renders (since 2026-05-01, `has_tenant_access` lets space-only members reach tenant routes for tenants whose spaces they belong to). RLS on `tenant_members` hides the owners list from her. All write actions on this page (Add owner, save branding) fail at the RPC layer because the strict `is_tenant_member` gate still applies for mutations.

## Space Contributor

Sign in as a Contributor of the Survodutide Pipeline space.

- [ ] Visit catalysts page → expect data visible (read-only view, no edit affordance to test here).
- [ ] On a trial detail page, edit a field (e.g. status), add a marker, save → expect success. (This is the actual catalyst edit surface; the catalysts page is a derived view.)
- [ ] Edit an existing event → expect form populates AND save succeeds.
- [ ] Open `/settings/general` → expect chrome but Save and Delete-space buttons blocked.
- [ ] Open `/settings/members` → expect chrome but no Invite-to-space button, no Remove actions.
- [ ] curl `rpc/seed_demo_data` → expect `Insufficient permissions`.
- [ ] curl POST on `space_invites` with a valid body → expect RLS denial.
- [ ] Visit `/t/<pfizer-id>/settings` → expect chrome renders (post-2026-05-01 `has_tenant_access` includes space-only members). All write actions fail at the RPC layer (mutations use the strict `is_tenant_member`).

## Space Owner

Sign in as a Space Owner.

- [x] Visit the space, edit data, add markers, edit events → expect all writes succeed.
- [x] Open `/settings/general`, change description, Save → expect success and toast.
- [x] Open `/settings/general`, click Delete space, confirm → expect space deleted, redirect to spaces list. Verified by deleting `Survodutide Pipeline`. The delete cascaded and recreated as `SGLT2 Pipeline` (id `746d4832-374d-4f0e-93ce-47839388aa29`); test continues against the new space.
- [x] Open `/settings/members`, invite a new user as Reader → expect `added to space` or `Invite held` toast. Verified by inviting `madaladodbele@gmail.com` as Reader (also primes Phase 6).
- [x] Visit `/seed-demo` URL on the space → expect populates demo data and redirects to catalysts. Repeat → expect idempotent (no duplicate rows).
- [x] curl `rpc/invite_to_space` with `p_role='owner'` → expect success. Verified, returned held invite for throwaway email (cleaned up after).

## Tenant Owner (not in `space_members` for the space being tested)

Sign in as a tenant owner who has not been added to any space in the tenant.

- [x] Visit `pfizer.clintapp.com` → expect spaces list visible with all spaces in the tenant.
- [x] Click into a space → expect data layer empty (RLS hides everything inside).
- [x] Visit `/t/<pfizer-id>/settings` → expect chrome renders, members table read+write.
- [x] Add a tenant owner via the Add owner dialog → expect `Invite held` or `added` toast. Verified, invite held for `phase4-throwaway@gmail.com` (cleanup pending).
- [x] Try editing tenant branding (managed tenant) → expect tenant branding form is NOT rendered on tenant settings (agency owns branding for agency-managed tenants per runbook 09; lives in `/admin/tenants/:id` on the agency host). Verified: form is absent. The runbook says a "read-only identity card with a hint pointing to the agency" should appear in its place; that hint is missing today (see follow-up #9).
- [ ] Try editing tenant branding (direct customer, `agency_id IS NULL`) → expect Save succeeds. **Skip in this run** — Pfizer is agency-managed; we have no direct-customer tenant set up. Mark as `n/a` in this strict pass.
- [x] Click "Create space" on the spaces empty state → expect dialog opens, submission creates the space.
- [x] Visit `/seed-demo` URL on a space they are not a member of → expect `Insufficient permissions`.
- [x] curl `rpc/update_tenant_branding` → expect success. Verified, HTTP 200 returned `{"id":"a87a88ae-...","updated":true}`.

## Agency Owner (parent agency, NOT in `tenant_members` for the tenant)

Sign in as an agency owner who never personally provisioned the tenant or accepted a tenant invite, so they hold no `tenant_members` row.

**Setup (post-2026-05-01):** the agency members page now uses `add_agency_member`, which has a held-invite branch. To set up an agency-owner-only actor, sign in as the existing agency owner (e.g. `aadi529` for Stout) and use the agency members page to add the new actor's email. If they have not yet signed in to the platform, the form returns `Invite held` and an `agency_invites` row is written. On the new actor's first sign-in via Google OAuth, the `handle_new_user` trigger auto-promotes the held invite into an `agency_members` row. They are then a clean Agency Owner, not in `tenant_members` anywhere. (Earlier notes about "the actor must sign in first before being added" no longer apply, see follow-up #11 in `follow-ups.md`.)

- [x] Visit `<agency>.clintapp.com/admin` → expect chrome renders, agency portal works.
- [x] Provision a new tenant under the agency → expect success. Verified, throwaway tenant `Phase5 Test` (`phase5-test`) created (cleanup pending).
- [x] Visit `<tenant>.clintapp.com/t/<id>/settings` → expect chrome renders (because `is_tenant_member` agency-disjunct), tenant branding editable. Verified chrome renders; branding-edit moved to curl check 8 since the form isn't surfaced on this UI for agency-managed tenants (see follow-up #9).
- [x] Visit `<tenant>.clintapp.com/t/<id>/spaces` → expect spaces list visible.
- [x] Click into any space → expect data hidden (firewall: no `space_members` row, no agency disjunct in `has_space_access`).
- [x] Click "Create space" on the spaces page → expect `Not a member of this tenant` from `create_space` (RPC checks `tenant_members` directly, no agency disjunct).
- [x] Visit `/seed-demo` URL on a space → expect `Insufficient permissions`.
- [x] curl `rpc/update_agency_branding` for the agency → expect success. Verified, HTTP 200, returned `{"id":"18669229-...","updated":true}`.
- [x] curl `rpc/provision_agency` → expect `Platform admin only`. Verified, 42501.
- [x] curl `rpc/seed_demo_data` for any space → expect `Insufficient permissions`. Verified, 42501 with the new gate text from migration 82: `Insufficient permissions: must be space owner to seed demo data`.

## Platform Admin

Sign in as the platform admin.

- [x] Visit `admin.clintapp.com/super-admin` → expect chrome renders, agencies list visible.
- [x] Provision an agency → expect success.
- [x] Visit any tenant route, including data inside any space → expect read access (admin bypass).
- [x] Try writing to a space without being a `space_members` row → expect denial (admin bypass is read-only for write checks). Verified via trial-detail save: server rejected the write as expected. Note: the UI surfaces this rejection as a top-of-page banner instead of a toast (see follow-up #1).
- [x] curl `rpc/provision_agency` → expect success. Verified, created `Phase2 Curl` agency.
- [x] curl `rpc/lookup_user_by_email` → expect success. Verified, found `aadi529`.
- [x] curl `rpc/register_custom_domain` → expect success. Verified, attached `phase2-curl-test.example.com` to Pfizer.
- [x] curl `rpc/seed_demo_data` for any space → expect success (platform-admin disjunct). Verified HTTP 204.

## Cross-cutting checks

- [ ] As Anonymous, hit `/auth/callback` directly with no state → expect graceful failure or redirect to `/login`, not a hung page.
- [ ] As any signed-in user without memberships, on the apex → expect `/onboarding` join-code form (no Create-tenant tab).
- [ ] Idempotent invites: as a Tenant Owner, click Add tenant owner twice for the same fresh email → expect both calls return the same `invite_code` and only one row in `tenant_invites`.
- [ ] Idempotent space invites: as a Space Owner, click Invite to space twice for the same `(email, role)` → expect both calls return the same code and one row in `space_invites`.
- [ ] Cross-host bounce: as `aadi529`, visit `admin.clintapp.com` → expect cross-host redirect to `stout.clintapp.com/admin` (not the super-admin chrome).

## What "expect denial" looks like

PostgREST returns the policy violation as a 403 with body `{"code":"42501","message":"new row violates row-level security policy for table \"<name>\""}` for INSERT/UPDATE rejections. RPC permission gates raise `Insufficient permissions` or `Platform admin only` or similar with errcode `42501`. The browser layer translates these to a toast on most pages. If a write succeeds when this checker says it should fail, that is a security divergence and stops the run; if a write fails when it should succeed, that is a UX or permission-gate bug and should be filed but does not stop the run.
