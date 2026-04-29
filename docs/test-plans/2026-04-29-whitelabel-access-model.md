# Test Plan: Whitelabel Access Model (Apr 29, 2026)

A resumable QA pass over what landed in this session. Check each box as you verify; commit between sessions so a new Claude session sees current state. Order matters within a section -- earlier steps create state used by later ones.

## Context for a future session

What was shipped (commits on `main`, latest `ab070f8`):
- Migration 75 (`20260429010000_owner_only_explicit_space_access.sql`) -- collapsed access model. `agency_members.role` and `tenant_members.role` are now `owner`-only. New `agencies.email_domain` optional lock. New `space_invites` table. New RPCs: `add_tenant_owner`, `invite_to_space`, `accept_space_invite`. `provision_tenant` auto-adds caller as tenant + space owner. `has_space_access` rewritten -- only explicit `space_members` rows grant data access; no implicit cascade from tenant or agency level. Migration applied to **both local and prod** Supabase.
- Migration 74 (`20260429000000_remove_accent_color.sql`) -- dropped unused accent_color column. Applied prod.
- Member self-protection guards (migration 73) -- can't self-remove or remove the last owner.
- Cross-host tenant switching (commit `01f97e3`).
- Brand-color model (revised mid-test, see git log around test-plan commit): super-admin portal stays platform teal (locked); agency portal reflects agency `primary_color`; tenant surface reflects tenant `primary_color`.
- Mobile fixes: catalysts vertical scroll on iOS, sidebar full-height on mobile, topbar dropdowns no longer clipped, all PrimeNG overlays portaled to `body`.
- "Org" -> "Tenant" rename across the codebase (commit `ab070f8`).

Prod state at start of test pass:
- Apex: `clintapp.com` (default brand, marketing landing).
- Super-admin: `admin.clintapp.com`.
- Agency: **Stout** at `stout.clintapp.com`. Owner: `aadi529@gmail.com`. After migration 75 the `email_domain` was backfilled to `gmail.com`.
- Tenant under Stout: **Pfizer** at `pfizer.clintapp.com`. Owner: same user (auto-added by migration backfill). One default space `Workspace` with seeded catalysts data; user is also auto-added as space owner.

Every step below should be performed against **prod** unless otherwise noted.

---

## Test accounts and browser setup

**Gmail `+alias` does NOT work with Google OAuth.** First test pass attempted aliases (`aadi529+ownerB@gmail.com` etc.) and Google's account picker rejected them with "Couldn't find your Google Account". The `+alias` is a Gmail-side delivery feature, not a Google account identifier. Distinct real Google accounts are required for any flow that involves sign-in.

| Role | Email | Used in |
|---|---|---|
| Primary owner | `aadi529@gmail.com` | All sections (Stout owner, Pfizer owner, Workspace owner) |
| Second tenant owner | `<TBD: real Gmail #2>` | Sections 2, 3, 4, 7 |
| Space reader | `<TBD: real Gmail #3>` | Section 5 |
| Negative-test (rejected by lock) | any non-gmail temp-mail address | Section 2 negative path only — no sign-in needed |

Sections 2-5 already used the second account once they're filled in below; update the placeholders before resuming.

**Browser sessions** (so you can be signed in as two users simultaneously):
- Chrome normal profile -> `aadi529@gmail.com`
- Chrome Incognito (or a second Chrome profile / Firefox) -> the second account under test
- Reuse the Incognito window across the second-tenant-owner and space-reader accounts -- just sign out between them

**Verify each new user landed in auth.users.** After creating a Google account and signing in for the first time, run this in the Supabase prod SQL editor to confirm the row exists:

```sql
select id, email, created_at
from auth.users
order by created_at desc
limit 5;
```

The newly-created user should appear at the top of the list with the email address you signed in with.

---

## Section 0: Pre-flight

- [x] Sign in to `admin.clintapp.com` as `aadi529@gmail.com` (super-admin). Confirm Stout agency and Pfizer tenant are both listed and active (not suspended).
- [x] Sign in to `stout.clintapp.com/admin` as the same user. Confirm Stout's agency portal reflects Stout's `primary_color` (the value set on `/admin/branding`). Primary buttons (e.g. "Provision tenant") and active nav items should match Stout's seed color, not platform teal.
- [x] Sign in to `pfizer.clintapp.com` as the same user. Confirm catalysts page loads and shows seeded data (catalysts table, not "no data"). [Note: desktop vertical scroll bug found and dispatched to a fork to fix; tracked separately, not blocking.]

If any of the above fails, fix before proceeding -- the rest of the plan assumes this baseline.

---

## Section 1: Email-domain lock

The Stout agency was backfilled with `email_domain = 'gmail.com'`. Decide what you want it to be before testing tenant-owner adds.

- [x] On `stout.clintapp.com/admin/branding`, scroll to "Member email domain (lock)". Confirm it's pre-populated with `gmail.com`.
- [x] **Default for this run: Path A (keep `gmail.com`).** All `aadi529+...@gmail.com` aliases pass; the negative test in Section 2 uses a non-gmail temp-mail address.
   - (Alternatives: Path B blanks the lock to allow any domain; Path C sets a real domain you own. Skip unless deliberately testing those.)
- [ ] Save and verify "Agency branding updated" toast appears.

---

## Section 2: Add a tenant owner (positive path)

Goal: prove `add_tenant_owner` works and the UI surfaces both the "user already exists" and "invite held" branches.

Account: `aadi529+ownerB@gmail.com` (does not yet exist in `auth.users`, so this exercises the "invite held" branch).

- [x] On `stout.clintapp.com/admin/tenants`, click into Pfizer.
- [x] Click "Add owner". Enter `aadi529+ownerB@gmail.com`.
- [x] Expected (since the alias has never signed in): green message `Invite held for aadi529+ownerB@gmail.com. Code: <32-char hex>`. **Copy the code** -- you'll paste it after first sign-in in Section 3. (Code: `f8132fd124274eb2a2abfafdbedd8a90`)
- [x] Members table refreshes; the new owner does NOT yet appear (invite is held until first sign-in). That's expected.
- [x] **Negative test:** Click "Add owner" again, enter a non-gmail address (e.g. `test@mailinator.com`). Expect a red error like `Email domain (mailinator.com) does not match agency domain (gmail.com)`. No sign-in for this address is required.

---

## Section 3: Firewall verification (the big one)

This is the architectural test that justifies migration 75. Tenant ownership must NOT grant space data access.

- [ ] In **Chrome Incognito**, go to `stout.clintapp.com` (or any host) and sign in with Google as `aadi529+ownerB@gmail.com`. Choose "Use another account" if Google offers the primary -- you must pick the alias explicitly.
- [ ] After landing, run this SQL in Supabase prod to confirm the alias landed correctly:
  ```sql
  select id, email from auth.users where email = 'aadi529+ownerB@gmail.com';
  ```
  If zero rows or the row's email is plain `aadi529@gmail.com`, Google collapsed the alias -- stop and triage.
- [ ] Navigate to `stout.clintapp.com/onboarding?tab=join`, paste the invite code from Section 2, submit. Expected: redirect into Pfizer's tenant scope.
- [ ] You should now be on `pfizer.clintapp.com` viewing the spaces list (or the tenant root).
- [ ] Click into the Workspace space.
- [ ] **Expected:** the catalysts/landscape pages load but show NO data, OR a permission error. The user is a tenant owner but NOT a space member, so `has_space_access` returns false.
- [ ] Open `pfizer.clintapp.com/t/<id>/settings` (tenant settings) -- expected: works (they're a tenant owner). Members table should show both owners.

If the second user CAN see catalysts data, the migration's authority cascade did not get fully removed. Check `supabase/migrations/20260429010000_owner_only_explicit_space_access.sql` step 5 (`has_space_access` body) and verify it ran on prod (`select prosrc from pg_proc where proname = 'has_space_access';` via Supabase SQL editor).

---

## Section 4: Space invite (existing user, Contributor role)

Goal: prove `invite_to_space` adds an existing user directly and they can edit data.

- [ ] In your **primary Chrome profile** as `aadi529@gmail.com`, navigate to `pfizer.clintapp.com/t/<id>/s/<workspaceId>/settings/members` (or open the space, then Settings -> Members).
- [ ] Click "Invite to space". Enter `aadi529+ownerB@gmail.com`, role = Contributor. Submit.
- [ ] Expected: green message `aadi529+ownerB@gmail.com added to space.` (Direct add, not invite-held -- the user already exists from Section 3.)
- [ ] Switch to **Incognito** (still signed in as `+ownerB`). Hard-refresh Pfizer Workspace.
- [ ] Catalysts data is now visible.
- [ ] As `+ownerB`, edit a catalyst (change status or add a marker) -- expected: write succeeds (Contributor role allows writes).

---

## Section 5: Space invite (new user, Reader role)

Goal: prove invites hold for unknown emails AND that spaces accept invites independent of agency-level domain locks.

- [ ] In your **primary Chrome profile** as `aadi529@gmail.com`, on Workspace's space-members page, click "Invite to space".
- [ ] Enter `aadi529+reader@gmail.com`, role = Reader. Submit.
- [ ] Expected: green message `Invite held for aadi529+reader@gmail.com. Code: <hex>.` **Copy the code.**
- [ ] In **Incognito**, sign out from `+ownerB`. Sign in with Google as `aadi529+reader@gmail.com` (use "Use another account" if needed).
- [ ] Verify the alias landed: `select email from auth.users where email = 'aadi529+reader@gmail.com';`
- [ ] Go to `pfizer.clintapp.com/onboarding?tab=join` (or any host's onboarding), paste the code, submit.
- [ ] Expected: redirected to `pfizer.clintapp.com/t/<id>/s/<workspaceId>` and catalysts data is visible (read-only).
- [ ] As `+reader`, try to edit a catalyst -- expected: edit fails (Reader is view-only).

---

## Section 6: Cross-host session persistence

Goal: prove the apex cookie + cross-host redirect work end-to-end.

- [ ] Sign in fresh on `stout.clintapp.com` as `aadi529@gmail.com`.
- [ ] In the topbar, open the tenant dropdown and pick Pfizer. Expect a full-page navigation to `pfizer.clintapp.com/t/<pfizer-id>/spaces` AND that you stay signed in (no re-login, no redirect to /login).
- [ ] Bonus: open dev tools, Application tab, Cookies, confirm a cookie with `Domain = .clintapp.com` and a Supabase session token.

If the user is bounced to /login on the new host, the apex cookie isn't being set or read correctly. Check `environment.apexDomain` and the `cookie-storage` chunking fix (commit `6130b6c`).

---

## Section 7: Member self-protection

Goal: prove migration 73 still works under the new owner-only model.

- [ ] In primary Chrome as `aadi529@gmail.com`, on `pfizer.clintapp.com/t/<id>/settings`, with `aadi529@gmail.com` and `aadi529+ownerB@gmail.com` both listed as tenant owners: find your own row -- expected: no row-actions menu (you can't remove yourself).
- [ ] Open the row-actions for `+ownerB` -- "Remove owner" should be available.
- [ ] **Don't actually remove them yet.** Try a SQL-level removal of your own row in the Supabase prod SQL editor: `delete from tenant_members where tenant_id = '<pfizer-id>' and user_id = '<aadi529-uid>';` Expected: error `42501 You cannot remove yourself from this tenant. Ask another owner to remove you.`
- [ ] In Incognito as `+ownerB`, navigate to the same tenant settings page and attempt to remove the `+ownerB` row -- expected: row-actions menu is suppressed for their own row (UI-side self-removal block).

---

## Section 8: Mobile UI sanity (iOS Safari)

Quick visual pass. On a phone:

- [ ] `pfizer.clintapp.com` catalysts page: vertical scroll works past the first viewport (the late-April fix that motivated half this session).
- [ ] Catalysts page: horizontal scroll on the table still works (swipe sideways shows more columns).
- [ ] Topbar tenant/space dropdown opens and is fully visible (not clipped, not hidden behind page content).
- [ ] Tenant settings or space-members page: tap a `p-select` (e.g. role dropdown) -- panel renders and is fully visible (PrimeNG overlay portaled to body).
- [ ] Sidebar: dark icon rail spans the full page height, not just the content card.

---

## Section 9: Brand-color isolation

Three surfaces, three sources:

- [ ] On `admin.clintapp.com/super-admin`: every primary button, active nav item, and accent should be platform teal (#0d9488 / #14b8a6 family). Locked regardless of any other state. This is platform chrome.
- [ ] On `stout.clintapp.com/admin`: primary buttons and active nav items reflect **Stout's** `agencies.primary_color`. Change Stout's color on `/admin/branding`, hard-refresh, confirm the portal repaints to the new color.
- [ ] On `pfizer.clintapp.com` (any tenant page): primary color reflects **Pfizer's** `tenants.primary_color` (or default teal if not customized). Whitelabel surface for the agency's clients.

---

## Section 10: Negative -- cascading parent delete still works

The member-guard triggers should NOT block a legit tenant deletion (cascade flag).

- [ ] On `admin.clintapp.com/super-admin/tenants`, create a throwaway tenant under Stout (or any agency). Note its id.
- [ ] On the same page, delete the throwaway tenant. Expected: succeeds. The `tenant_members` cascade should not be blocked by the self-removal guard.
- [ ] Confirm the tenant is gone from the list AND the subdomain is in `retired_hostnames` (visible from the super-admin domains page if surfaced; otherwise via SQL).

---

## Section 11: Cleanup

After QA:

- [ ] Delete the alias users from prod auth.users so they don't linger:
  ```sql
  delete from auth.users where email in ('aadi529+ownerB@gmail.com', 'aadi529+reader@gmail.com');
  ```
  (Or via Supabase dashboard -> Authentication -> Users.) Cascading deletes will clean up `tenant_members` / `space_members` rows automatically.
- [ ] If you used a throwaway tenant in Section 10, decide whether to release its subdomain via the super-admin domains page.

---

## Failure-triage cheat sheet

| Symptom | Likely cause | First place to look |
|---|---|---|
| Tenant owner sees catalysts data without being added to the space | `has_space_access` cascade not removed on prod | SQL: `select prosrc from pg_proc where proname = 'has_space_access'` |
| `add_tenant_owner` succeeds for any email | `email_domain` is null on agency, or platform admin bypass triggered | `select email_domain from agencies where id = '<id>'`; check whether you're calling as super-admin |
| Cross-host nav bounces to /login | Apex cookie not set | dev tools cookies, check Domain=.clintapp.com; `environment.apexDomain` setting |
| Self-removal blocked from UI but allowed via SQL | `tenant_members_self_protection` trigger not present | `select tgname from pg_trigger where tgrelid = 'tenant_members'::regclass` |
| Mobile dropdown clipped | `:host` z-index lost in `contextual-topbar.component.ts` | Inspect `.topbar` in dev tools |
| Super-admin chrome shows non-teal color | `.admin-brand-scope` class missing on `SuperAdminShellComponent` wrapper | Inspect `<div class="sa-shell ...">` |
| Agency portal stays teal after agency color change | Stale build, OR `.admin-brand-scope` was re-added to `agency-shell.component.ts` | `git log -p src/client/src/app/features/agency/agency-shell.component.ts` |
