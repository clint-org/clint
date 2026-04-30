# Role-Access Checker

[Back to test plan](2026-04-29-whitelabel-access-model.md), [spec](ui-editability-matrix.md), [follow-ups](follow-ups.md).

---

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
- [ ] Visit `/t/<pfizer-id>/settings` → expect `tenantGuard` redirect to `/onboarding?tab=join` (Reader holds no `tenant_members` row).

## Space Contributor

Sign in as a Contributor of the Survodutide Pipeline space.

- [ ] Visit catalysts page → expect data visible (read-only view, no edit affordance to test here).
- [ ] On a trial detail page, edit a field (e.g. status), add a marker, save → expect success. (This is the actual catalyst edit surface; the catalysts page is a derived view.)
- [ ] Edit an existing event → expect form populates AND save succeeds.
- [ ] Open `/settings/general` → expect chrome but Save and Delete-space buttons blocked.
- [ ] Open `/settings/members` → expect chrome but no Invite-to-space button, no Remove actions.
- [ ] curl `rpc/seed_demo_data` → expect `Insufficient permissions`.
- [ ] curl POST on `space_invites` with a valid body → expect RLS denial.
- [ ] Visit `/t/<pfizer-id>/settings` → expect `tenantGuard` redirect.

## Space Owner

Sign in as a Space Owner.

- [ ] Visit the space, edit data, add markers, edit events → expect all writes succeed.
- [ ] Open `/settings/general`, change description, Save → expect success and toast.
- [x] Open `/settings/general`, click Delete space, confirm → expect space deleted, redirect to spaces list. Verified by deleting `Survodutide Pipeline`. The delete cascaded and recreated as `SGLT2 Pipeline` (id `746d4832-374d-4f0e-93ce-47839388aa29`); test continues against the new space.
- [ ] Open `/settings/members`, invite a new user as Reader → expect `added to space` or `Invite held` toast.
- [ ] Visit `/seed-demo` URL on the space → expect populates demo data and redirects to catalysts. Repeat → expect idempotent (no duplicate rows).
- [ ] curl `rpc/invite_to_space` with `p_role='owner'` → expect success.

## Tenant Owner (not in `space_members` for the space being tested)

Sign in as a tenant owner who has not been added to any space in the tenant.

- [ ] Visit `pfizer.clintapp.com` → expect spaces list visible with all spaces in the tenant.
- [ ] Click into a space → expect data layer empty (RLS hides everything inside).
- [ ] Visit `/t/<pfizer-id>/settings` → expect chrome renders, members table read+write.
- [ ] Add a tenant owner via the Add owner dialog → expect `Invite held` or `added` toast.
- [ ] Try editing tenant branding (managed tenant) → expect read-only fields (agency owns branding).
- [ ] Try editing tenant branding (direct customer, `agency_id IS NULL`) → expect Save succeeds.
- [ ] Click "Create space" on the spaces empty state → expect dialog opens, submission creates the space.
- [ ] Visit `/seed-demo` URL on a space they are not a member of → expect `Insufficient permissions`.
- [ ] curl `rpc/update_tenant_branding` → expect success.

## Agency Owner (parent agency, NOT in `tenant_members` for the tenant)

Sign in as an agency owner who never personally provisioned the tenant or accepted a tenant invite, so they hold no `tenant_members` row.

- [ ] Visit `<agency>.clintapp.com/admin` → expect chrome renders, agency portal works.
- [ ] Provision a new tenant under the agency → expect success.
- [ ] Visit `<tenant>.clintapp.com/t/<id>/settings` → expect chrome renders (because `is_tenant_member` agency-disjunct), tenant branding editable.
- [ ] Visit `<tenant>.clintapp.com/t/<id>/spaces` → expect spaces list visible.
- [ ] Click into any space → expect data hidden (firewall: no `space_members` row, no agency disjunct in `has_space_access`).
- [ ] Click "Create space" on the spaces page → expect `Not a member of this tenant` from `create_space` (RPC checks `tenant_members` directly, no agency disjunct).
- [ ] Visit `/seed-demo` URL on a space → expect `Insufficient permissions`.
- [ ] curl `rpc/update_agency_branding` for the agency → expect success.
- [ ] curl `rpc/provision_agency` → expect `Platform admin only`.
- [ ] curl `rpc/seed_demo_data` for any space → expect `Insufficient permissions`.

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
