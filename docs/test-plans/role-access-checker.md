# Role-Access Checker

[Back to test plan](2026-04-29-whitelabel-access-model.md), [spec](ui-editability-matrix.md), [follow-ups](follow-ups.md).

---

## Test pass complete (2026-05-01)

Strict tally: **58 of 58 boxes passed plus 1 n/a**. Every server-side denial held; every divergence found is a UX leak and is filed in `follow-ups.md`.

**By role**: Anonymous (6/6), Platform Admin (8/8), Space Owner (6/6), Tenant Owner (8/8 + 1 n/a -- direct-customer branding skipped, no fixture), Agency Owner (10/10), Space Reader (7/7), Space Contributor (8/8), Cross-cutting (5/5).

**Headline findings:**
- **#16 upgraded to production-blocker UX bug**: cold direct deep-link into any `/t/<id>/s/<id>/...` route redirects to `/spaces` for *every* user, including the user with maximum access. Topbar selection works around it. Almost certainly a guard/resolver on `s/:spaceId` reading a signal that hasn't populated yet.
- **#2 upgraded to data-integrity risk**: edit-event form populates with the *previous* form's stale values, not the existing event's values. Click Save without realizing → silent overwrite of the existing event with the previous form's payload. RLS lets the write through.
- **#3 refined**: Delete on `/settings/general` falsely navigates away as if delete succeeded; space remains.
- **#5 (umbrella role-aware UI gating sweep)** is the production-rollout blocker: every data-management page leaks write controls to readers/limited-write users. Server-side correctly denies, but the UX is a footgun. This run produced ample evidence to justify prioritizing it.
- **#15** confirmed at the data layer via curl: `tenants` returns `[]` for space-only members.

**Test users created (cleanup needed):** `madala.dodbele@gmail.com` (Reader), `novaelevatellc@gmail.com` (Contributor), `novaepicestates@gmail.com` (no memberships), plus earlier-phase throwaways listed in the cleanup block below.

**Current prod state for the test:**
- Stout agency at `stout.clintapp.com`, owner `aadi529@gmail.com`. Email-domain lock = `gmail.com`.
- Pfizer tenant under Stout at `pfizer.clintapp.com`. id `a87a88ae-1b76-4c6b-85e0-1b53c926d0f2`. Tenant owners: `aadi529@gmail.com` and `aadimadala@gmail.com`.
- One space under Pfizer: SGLT2 Pipeline. id `746d4832-374d-4f0e-93ce-47839388aa29`. Space owner: `aadi529`.
- `madala.dodbele@gmail.com`: still pure Space Reader of SGLT2 Pipeline post-Phase 6. (User row id `48990035-3b34-447d-abb6-c1af8c1da11f`.) Promote her to editor before starting Phase 7.
- `aadityamadala@gmail.com`: only platform admin in `platform_admins`.

**To advance Phase 7 from here:** promote madala to Contributor with SQL:
```
update space_members set role='editor' where space_id='746d4832-374d-4f0e-93ce-47839388aa29' and user_id='48990035-3b34-447d-abb6-c1af8c1da11f';
```
Then sign in to Incognito as `madala.dodbele@gmail.com` and walk the 9 Contributor scenarios. Note: SGLT2 currently has no demo data because seed_demo_data was not re-run after the space was recreated in Phase 3. Either re-seed (sign in as aadi529, hit `/seed-demo` URL on the space) before Phase 7 if you need real rows for the Contributor edit scenarios, or be prepared for empty-state pages on Manage > Trials etc.

Cleanup pending at end of run (Section 11 of `2026-04-29-whitelabel-access-model.md`):
- delete `auth.users` rows for `aadimadala@gmail.com`, `madala.dodbele@gmail.com`, `novaelevatellc@gmail.com`, `novaepicestates@gmail.com` (cascades to memberships)
- the `agency-2` agency owned by `aadityamadala` looks like a stray from earlier experimentation; verify it is a throwaway before deleting
- any held-invite rows for `phase4-throwaway@gmail.com`, `phase6-throwaway@gmail.com`, `phase7-throwaway@gmail.com`, or similar test emails

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

- [x] Visit the space catalysts page → expect data visible (page is read-only by design for everyone; no edit affordance to test here). Verified at the direct space URL. Side finding: tenant `/spaces` list page renders "No spaces yet" for her even though she has access to SGLT2; filed as follow-up #16.
- [x] Visit a trial detail page (Manage → Trials → click a trial) → attempt to edit any field, add a marker, or change phase data. Expect either no edit affordance rendered OR RLS rejection on save. Verified: edit controls render (follow-up #6, rolls under #5), Save was rejected, denial surfaced as a top-of-page banner not a toast (follow-up #1).
- [x] Visit the space's `/settings/general` → expect the chrome but Save button blocked, Delete-space button blocked. Verified: Save denial surfaced as banner (#1). Delete: confirm dialog appeared, click-through **navigated away as if delete succeeded** even though RLS rejected it (the space remains accessible via direct URL). Worse than #3 anticipated; #3 updated.
- [x] Visit the space's `/settings/members` → expect chrome with read-only members table; no Invite-to-space button. Verified: members table renders correctly. Her own row shows a static READER badge (correctly read-only). UI leaks (rolls under #5/#7): "Invite to space" button visible top-right; other members' rows render an editable role dropdown and `...` overflow menu. Server-side enforcement holds: clicking Invite and submitting a throwaway invite returned a denial.
- [x] curl `rpc/seed_demo_data` with `p_space_id=<sglt2-id>` → expect `Insufficient permissions`. Verified: HTTP 403, `42501`, `Insufficient permissions: must be space owner to seed demo data`.
- [x] curl POST on `events` with a valid body → expect RLS denial (`new row violates row-level security policy`). Verified: HTTP error `42501`, body `new row violates row-level security policy for table "events"`. Side finding via curl: `tenants` GET returns `[]` for her (confirms #15 at the data layer); `spaces?tenant_id=eq.X&select=*&order=created_at` returns SGLT2 correctly (so #16 is NOT a data-layer bug -- client-side only; #16 updated).
- [x] Visit `/t/<pfizer-id>/settings` → expect chrome renders (since 2026-05-01, `has_tenant_access` lets space-only members reach tenant routes for tenants whose spaces they belong to). RLS on `tenant_members` hides the owners list from her. All write actions on this page (Add owner, save branding) fail at the RPC layer because the strict `is_tenant_member` gate still applies for mutations. Verified: chrome rendered, write attempts returned `Insufficient permissions` surfaced as banner (confirms #14 chrome-reachable-but-inert and #1 banner-not-toast).

## Space Contributor

Sign in as a Contributor of the Survodutide Pipeline space.

- [x] Visit catalysts page → expect data visible (read-only view, no edit affordance to test here). Verified by `novaelevatellc` after re-seed.
- [x] On a trial detail page, edit a field (e.g. status), add a marker, save → expect success. (This is the actual catalyst edit surface; the catalysts page is a derived view.) Verified: trial edit saved successfully as Contributor.
- [x] Edit an existing event → expect form populates AND save succeeds. Verified bug per #2 -- worse than originally captured: form populates with the previous new-event's values rather than the existing event's values, creating a silent overwrite risk. New-event flow itself works fine; novaelevatellc successfully added one new event.
- [x] Open `/settings/general` → expect chrome but Save and Delete-space buttons blocked. Verified: Save edit-enables, click rejected via banner; Delete confirm-dialog appears, click navigates away even though the space remains. Same pattern madala saw -- confirms #1, #3/#5. Side finding: direct deep-link required a topbar "select space" first to hydrate the space context (added to #16).
- [x] Open `/settings/members` → expect chrome but no Invite-to-space button, no Remove actions. Verified: Invite button visible (UI leak per #7), but Invite submission failed at server with "failed to invite" -- server-side enforcement holds. Direct deep-link redirected to `/spaces` until the space was selected via the topbar (sharper data point for #16; entry refined).
- [x] curl `rpc/seed_demo_data` → expect `Insufficient permissions`. Verified: HTTP 403, `42501`, `Insufficient permissions: must be space owner to seed demo data`.
- [x] curl POST on `space_invites` with a valid body → expect RLS denial. Verified: HTTP 403, `42501`, `new row violates row-level security policy for table "space_invites"`.
- [x] Visit `/t/<pfizer-id>/settings` → expect chrome renders (post-2026-05-01 `has_tenant_access` includes space-only members). All write actions fail at the RPC layer (mutations use the strict `is_tenant_member`). Verified: chrome rendered, content empty/disabled (RLS hides members list), Add owner button visible (UI leak per #14), submit failed with "insufficient privileges" -- confirms #14 again from a Contributor's perspective.

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

- [x] As Anonymous, hit `/auth/callback` directly with no state → expect graceful failure or redirect to `/login`, not a hung page. Verified: spinner for a while, then "Sign in timed out. Please try again." with a "Return to sign in" link. Graceful, but spin-time before timeout could be tightened (UX nit, not a test failure).
- [x] As any signed-in user without memberships, on the apex → expect `/onboarding` join-code form (no Create-tenant tab). Verified with a third Google account (zero memberships): landed on `https://clintapp.com/onboarding` with only the join-code field, no Create-tenant tab.
- [x] Idempotent invites: as a Tenant Owner, click Add tenant owner twice for the same fresh email → expect both calls return the same `invite_code` and only one row in `tenant_invites`. Verified by aadi529 on Pfizer: both calls returned `invite_code=19ce7b08a29945e3a33f7f100871aae6`.
- [x] Idempotent space invites: as a Space Owner, click Invite to space twice for the same `(email, role)` → expect both calls return the same code and one row in `space_invites`. Verified by aadi529 on SGLT2: both calls returned `invite_code=fcbe81214ac24c43823006198e114afd`. Side finding: aadi529 also hit the direct deep-link redirect (was bounced to `/spaces` from the direct settings/members URL) -- proves #16 is universal, not space-only-member-specific. #16 upgraded.
- [x] Cross-host bounce: as `aadi529`, visit `admin.clintapp.com` → expect cross-host redirect to `stout.clintapp.com/admin` (not the super-admin chrome). Verified.

## What "expect denial" looks like

PostgREST returns the policy violation as a 403 with body `{"code":"42501","message":"new row violates row-level security policy for table \"<name>\""}` for INSERT/UPDATE rejections. RPC permission gates raise `Insufficient permissions` or `Platform admin only` or similar with errcode `42501`. The browser layer translates these to a toast on most pages. If a write succeeds when this checker says it should fail, that is a security divergence and stops the run; if a write fails when it should succeed, that is a UX or permission-gate bug and should be filed but does not stop the run.
