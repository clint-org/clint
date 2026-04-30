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

Prod state at start of test pass (after the 2026-04-30 reset — all prior agencies/tenants/spaces/members deleted, only `aadi529@gmail.com` and `aadityamadala@gmail.com` remain in `auth.users`):
- Apex: `clintapp.com` (default brand, marketing landing).
- Super-admin: `admin.clintapp.com`.
- Agency: none yet — Section 0 re-provisions **Stout** at `stout.clintapp.com` with owner `aadi529@gmail.com` and `email_domain = gmail.com`.
- Tenant: none yet — Section 0 re-provisions **Pfizer** under Stout at `pfizer.clintapp.com`. `provision_tenant` auto-adds caller as tenant + Workspace space owner.

Every step below should be performed against **prod** unless otherwise noted.

---

## Test accounts and browser setup

**Gmail `+alias` does NOT work with Google OAuth.** A first test pass attempted aliases (`aadi529+ownerB@gmail.com` etc.) and Google's account picker rejected them with "Couldn't find your Google Account". The `+alias` is a Gmail-side delivery feature, not a Google account identifier. The test plan now uses distinct real Google accounts.

| Role | Email | Used in |
|---|---|---|
| Platform admin (only super-admin operator) | `aadityamadala@gmail.com` | Section 0 (provisioning), Section 7 series (negative checks) |
| Agency / tenant / space owner (the "customer" persona) | `aadi529@gmail.com` | All sections — owns Stout, Pfizer, and Workspace |
| Second tenant owner | `aadimadala@gmail.com` | Sections 2, 3, 4, 7 |
| Space reader | `madaladodbele@gmail.com` | Section 5, plus negative-path role coverage in 7a-7e |
| Negative-test (rejected by lock) | any non-gmail temp-mail address | Section 2 negative path only — no sign-in needed |

**Important separation of concern:** `aadityamadala@gmail.com` is the only row in `platform_admins` and is used purely as the platform operator who provisions agencies. It is NOT an owner of any agency / tenant / space in the test data — `aadi529@gmail.com` plays that role. This mirrors how a real super-admin operates a whitelabel platform on behalf of customers.

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

## Section 0: Pre-flight (re-provision the test environment)

Performed by `aadityamadala@gmail.com` (the platform admin). `aadi529@gmail.com` will be set as the agency owner during provisioning, but does NOT need to be a platform admin — it owns the customer-facing layer only.

- [ ] Sign in to `admin.clintapp.com` as **`aadityamadala@gmail.com`** (platform admin). Provision a new agency: name `Stout Strategy`, subdomain `stout`, **owner email `aadi529@gmail.com`**. Confirm it appears in the agencies list, active.
- [ ] Sign out, then sign in as **`aadi529@gmail.com`** (agency owner). Visit `stout.clintapp.com/admin/branding`. Set `primary_color` to a non-teal value (e.g. `#4597d0`) so Section 9 brand-isolation is meaningful. Set `email_domain = gmail.com`. Save and confirm "Agency branding updated" toast.
- [ ] Still as `aadi529@gmail.com`, on `stout.clintapp.com/admin/tenants`, provision tenant: name `Pfizer`, subdomain `pfizer`. Leave the `First user email` field BLANK on this tenant — Section 2 covers the held-invite flow via the standalone "Add owner" path. Confirm Pfizer appears in the tenants list. `provision_tenant` auto-adds `aadi529@gmail.com` as both tenant owner and Workspace space owner.
  - [ ] Fill the optional `Logo URL` field with a hosted Pfizer logo URL at provision time. After submit, verify `tenants.logo_url` is populated (`select logo_url from tenants where subdomain = 'pfizer';`) and the logo renders on `pfizer.clintapp.com` without needing a follow-up upload from the tenant detail page.
  - [ ] **Deferred — first-user-email path:** create a throwaway tenant under Stout (e.g. name `Throwaway`, subdomain `throwaway-fue`) and fill the `First user email` field with a real Gmail account that does NOT yet exist in `auth.users`. Expected: tenant is created, an invite is held (`select * from tenant_invites where tenant_id = '<id>';`), the form shows a copyable code or success toast. Tear down the throwaway tenant afterward (Section 11 cleanup logic). This exercises `createTenantInvite` at provision time, which is a different code path than `add_tenant_owner` from the tenant detail page.
- [ ] Visit `pfizer.clintapp.com`. Confirm catalysts page loads (may be empty — seed data does not auto-populate for newly-provisioned tenants. That's fine for the access-model tests, except Section 3's "data visible vs not" test needs at least one row to discriminate. Seed at least one catalyst manually if Workspace is empty before starting Section 3).
- [ ] Confirm `stout.clintapp.com/admin` reflects Stout's `primary_color` (primary buttons + active nav items, not platform teal).

If any of the above fails, fix before proceeding -- the rest of the plan assumes this baseline.

---

## Section 1: Email-domain lock

Set during Section 0; this section is now just a verification + alternative-path note.

- [ ] On `stout.clintapp.com/admin/branding`, scroll to "Member email domain (lock)". Confirm it shows `gmail.com` from Section 0.
- [ ] **Default for this run: Path A (keep `gmail.com`).** Test accounts are all `@gmail.com`; the negative test in Section 2 uses a non-gmail temp-mail address.
   - (Alternatives: Path B blanks the lock to allow any domain; Path C sets a real domain you own. Skip unless deliberately testing those.)

---

## Section 2: Add a tenant owner (positive path)

Goal: prove `add_tenant_owner` works and the UI surfaces both the "user already exists" and "invite held" branches.

Account: `aadimadala@gmail.com` (real Google account; if it has not yet signed into `clintapp.com`, this exercises the "invite held" branch — its row in `auth.users` won't exist until first OAuth sign-in).

- [x] On `stout.clintapp.com/admin/tenants`, click into Pfizer.
- [x] Click "Add owner". Enter `aadimadala@gmail.com`.
- [x] Expected (assuming the account has never signed into clintapp): green message `Invite held for aadimadala@gmail.com. Code: <32-char hex>`. **Copy the code** -- you'll paste it after first sign-in in Section 3. (Code: `72a871bd3b2b46a8bb60ea1ef44cba83`)
- [x] Members table refreshes; the new owner does NOT yet appear (invite is held until first sign-in). That's expected.
- [x] **Negative test:** Click "Add owner" again, enter a non-gmail address (e.g. `test@mailinator.com`). Expect a red error like `Email domain (mailinator.com) does not match agency domain (gmail.com)`. No sign-in for this address is required.
- [ ] **Idempotency check (added after the dedup migration on 2026-04-30):** Click "Add owner" twice in a row with the same fresh email (e.g. `madaladodbele@gmail.com` — but plan to use this for Section 5; pick another throwaway gmail if you don't want to consume that slot). Expected: both calls return the same invite code, and `select count(*) from tenant_invites where email = '<email>' and accepted_at is null` shows exactly 1 row.

---

## Section 3: Firewall verification (the big one)

This is the architectural test that justifies migration 75. Tenant ownership must NOT grant space data access.

- [ ] In **Chrome Incognito**, go to `stout.clintapp.com` (or any host) and sign in with Google as `aadimadala@gmail.com`. Choose "Use another account" if Google offers the primary.
- [ ] After landing, run this SQL in Supabase prod to confirm the user landed correctly:
  ```sql
  select id, email from auth.users where email = 'aadimadala@gmail.com';
  ```
  If zero rows, the OAuth flow didn't complete — stop and triage.
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
- [ ] Click "Invite to space". Enter `aadimadala@gmail.com`, role = Contributor. Submit.
- [ ] Expected: green message `aadimadala@gmail.com added to space.` (Direct add, not invite-held -- the user already exists from Section 3.)
- [ ] Switch to **Incognito** (still signed in as `aadimadala@gmail.com`). Hard-refresh Pfizer Workspace.
- [ ] Catalysts data is now visible.
- [ ] As `aadimadala`, edit a catalyst (change status or add a marker) -- expected: write succeeds (Contributor role allows writes).

---

## Section 5: Space invite (new user, Reader role)

Goal: prove invites hold for unknown emails AND that spaces accept invites independent of agency-level domain locks.

- [ ] In your **primary Chrome profile** as `aadi529@gmail.com`, on Workspace's space-members page, click "Invite to space".
- [ ] Enter `madaladodbele@gmail.com`, role = Reader. Submit.
- [ ] Expected: green message `Invite held for madaladodbele@gmail.com. Code: <hex>.` **Copy the code.** (Code: `__________`)
- [ ] In **Incognito**, sign out from `aadimadala`. Sign in with Google as `madaladodbele@gmail.com` (use "Use another account" if needed).
- [ ] Verify the user landed: `select email from auth.users where email = 'madaladodbele@gmail.com';`
- [ ] Go to `pfizer.clintapp.com/onboarding?tab=join` (or any host's onboarding), paste the code, submit.
- [ ] Expected: redirected to `pfizer.clintapp.com/t/<id>/s/<workspaceId>` and catalysts data is visible (read-only).
- [ ] As `madaladodbele`, try to edit a catalyst -- expected: edit fails (Reader is view-only).

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

- [ ] In primary Chrome as `aadi529@gmail.com`, on `pfizer.clintapp.com/t/<id>/settings`, with `aadi529@gmail.com` and `aadimadala@gmail.com` both listed as tenant owners: find your own row -- expected: no row-actions menu (you can't remove yourself).
- [ ] Open the row-actions for `aadimadala` -- "Remove owner" should be available.
- [ ] **Don't actually remove them yet.** Try a SQL-level removal of your own row in the Supabase prod SQL editor: `delete from tenant_members where tenant_id = '<pfizer-id>' and user_id = '<aadi529-uid>';` Expected: error `42501 You cannot remove yourself from this tenant. Ask another owner to remove you.`
- [ ] In Incognito as `aadimadala`, navigate to the same tenant settings page and attempt to remove your own row -- expected: row-actions menu is suppressed for the self-row (UI-side self-removal block).

---

## Section 7a: Anonymous (logged-out) access

Goal: prove every protected access point bounces a logged-out user to `/login`. UI guards (`authGuard`) should never let an unauthenticated session through, regardless of host or route.

Setup: open a fresh Incognito window, do NOT sign in. For each row below, paste the URL in the address bar and observe.

| URL | Expected |
|---|---|
| `https://admin.clintapp.com/super-admin` | Redirect to `/login` |
| `https://admin.clintapp.com/super-admin/agencies` | Redirect to `/login` |
| `https://admin.clintapp.com/super-admin/tenants` | Redirect to `/login` |
| `https://admin.clintapp.com/super-admin/domains` | Redirect to `/login` |
| `https://stout.clintapp.com/admin` | Redirect to `/login` |
| `https://stout.clintapp.com/admin/branding` | Redirect to `/login` |
| `https://stout.clintapp.com/admin/tenants` | Redirect to `/login` |
| `https://pfizer.clintapp.com/t/<pfizer-id>/spaces` | Redirect to `/login` |
| `https://pfizer.clintapp.com/t/<pfizer-id>/s/<workspace-id>` | Redirect to `/login` |
| `https://pfizer.clintapp.com/t/<pfizer-id>/settings` | Redirect to `/login` |
| `https://pfizer.clintapp.com/onboarding?tab=join` | Redirect to `/login` |

- [ ] Walk every URL above. None should render the destination page.
- [ ] Bonus: open dev tools Network tab on `https://admin.clintapp.com/super-admin`, watch the navigation. Confirm no PostgREST `rpc/*` calls fired before redirect (UI shouldn't leak data even if the user is fast).

**Expected RPC behavior when called without auth (verify with `curl` once):**

```bash
# Replace <anon-key> with the project anon key from the browser network tab.
curl -X POST 'https://gmgprkymyjzkzirbzqzd.supabase.co/rest/v1/rpc/provision_agency' \
  -H "apikey: <anon-key>" -H "Content-Type: application/json" \
  -d '{"p_name":"hax","p_slug":"hax","p_subdomain":"hax","p_owner_email":"x@y.com"}'
```

- [ ] Expected: `Must be authenticated` (the function raises this before any other check). Do this once for any super-admin RPC; the rest follow the same pattern.

---

## Section 7b: Wrong role on a privileged host (UI guard + server enforcement)

Goal: prove both layers of defense work — the route guard redirects users who lack the right role away from privileged surfaces, AND the server-side RPC gate rejects any action that slips past the UI.

**Scenario 1 — non-platform-admin lands on `admin.clintapp.com/super-admin`:**

Actor: `aadi529@gmail.com` (agency/tenant/space owner, but NOT in `platform_admins`).

- [ ] Sign in as `aadi529@gmail.com`. Visit `https://admin.clintapp.com/super-admin/agencies`.
- [ ] **Expected (post-guard-hardening):** redirected away — typically cross-host redirect to `stout.clintapp.com/admin` (their real home, resolved by `marketingLandingGuard`). The super-admin chrome must NOT render.
- [ ] Confirm in network tab: no `is_platform_admin` true response, no super-admin component bundle loaded after the redirect resolves.
- [ ] Server enforcement check (defense in depth): use Recipe A from Section 7c to call `provision_agency` directly with aadi529's JWT. Expected: `Platform admin only`. SQL verify:

  ```sql
  select count(*) from agencies;
  ```

  Count must be unchanged (1 = Stout).

**Scenario 2 — non-agency-owner lands on `<agency>.clintapp.com/admin`:**

Actor: `aadimadala@gmail.com` (Pfizer tenant owner only — not Stout agency owner).

- [ ] Sign in as `aadimadala@gmail.com`. Visit `https://stout.clintapp.com/admin/branding`.
- [ ] **Expected (post-guard-hardening):** redirected away — typically to `pfizer.clintapp.com/t/<id>/spaces` (their real home as Pfizer tenant member). Stout admin chrome must NOT render.
- [ ] Server enforcement check: call `update_agency_branding` with Stout's id and aadimadala's JWT (Recipe A). Expected: `Insufficient permissions`. SQL verify:

  ```sql
  select primary_color from agencies where subdomain = 'stout';
  ```

  Color unchanged.

**Scenario 3 — non-tenant-member lands on `<tenant>.clintapp.com/t/<id>/...`:**

Actor: `madaladodbele@gmail.com` (space reader of Pfizer Workspace, NOT tenant member). Or any signed-in user who isn't in `tenant_members` for Pfizer.

- [ ] Sign in as `madaladodbele@gmail.com`. Visit `https://pfizer.clintapp.com/t/<pfizer-id>/settings`.
- [ ] **Expected (post-tenantGuard, 2026-04-30):** redirected away — typically to `/onboarding?tab=join` if the user has no other tenant, or to their actual home if they do. The tenant-settings chrome must NOT render.
- [ ] Server enforcement check (defense in depth): use Recipe A from Section 7c with this user's JWT to call `add_tenant_owner(<pfizer-id>, 'foo@bar.com')`. Expected: `Insufficient permissions`. SQL verify `tenant_members` count for Pfizer is unchanged.
- [ ] Same Recipe A, call `update_tenant_branding`. Expected: `Insufficient permissions`.

**Scenario 4 — tenant owner tries to access space data (the firewall, already in Section 3):**

Duplicated here for completeness. Tenant ownership of Pfizer does NOT grant SELECT on Workspace catalysts. The server enforces this via `has_space_access()` in the data RPC bodies, NOT via the route guard.

---

## Section 7c: Privilege-escalation matrix (RPC-level)

Goal: every server-side gate is enforced from any role beneath it. Run each cell as the listed actor; expected error must match.

**How to call an RPC as a specific user.** The app does not expose the supabase client on `window`. Two ways to drive RPCs as a non-platform-admin actor:

**Recipe A — curl with the actor's JWT (no code changes):**

1. Sign into the app as the actor (e.g. `aadi529@gmail.com`).
2. Open dev tools → Application tab → Cookies (if on apex) or Local Storage (if on a non-apex host) → find the Supabase auth entry. The value is JSON containing `access_token`. Copy it.
3. Run:

   ```bash
   ANON='<paste anon key from any network request to supabase.co>'
   JWT='<paste access_token here>'
   curl -sS -X POST 'https://gmgprkymyjzkzirbzqzd.supabase.co/rest/v1/rpc/<fn>' \
     -H "apikey: $ANON" -H "Authorization: Bearer $JWT" \
     -H 'Content-Type: application/json' \
     -d '{"<arg>":"<value>"}'
   ```

   The response body is the RPC's error JSON or success payload.

**Recipe B — temporarily expose the client (one-line code change, revert before commit):**

In `src/client/src/main.ts`, inside the `bootstrapApplication(...).then(...)` callback, add:

```ts
(window as any).__supabase = appRef.injector.get(SupabaseService).client;
```

…and import `SupabaseService` at the top. Run `ng serve` (or `wrangler dev`) against your local build, sign in as each actor, and from the console:

```js
await __supabase.rpc('provision_agency', { p_name: 'hax', p_slug: 'hax', p_subdomain: 'hax-test', p_owner_email: 'x@y.com' }).then(r => r.error?.message ?? 'OK');
```

Revert the one-line edit before committing — this is dev-only.

- [ ] Pick Recipe A or B and stick with it for this section.

| Actor | RPC | Args | Expected error |
|---|---|---|---|
| `aadi529@gmail.com` (agency owner) | `provision_agency` | any | `Platform admin only` |
| `aadi529@gmail.com` | `delete_agency` | Stout's id | `Platform admin only` |
| `aadi529@gmail.com` | `register_custom_domain` | any | `Platform admin only` |
| `aadi529@gmail.com` | `release_retired_hostname` | any | `Platform admin only` |
| `aadi529@gmail.com` | `lookup_user_by_email` | any | `Insufficient permissions` |
| `aadimadala@gmail.com` (tenant owner only) | `provision_tenant` | under Stout | `Must be agency owner or platform admin` |
| `aadimadala@gmail.com` | `update_agency_branding` | Stout's id, any field | `Insufficient permissions` |
| `aadimadala@gmail.com` | `add_tenant_owner` | a different tenant's id | `Insufficient permissions` |
| `madaladodbele@gmail.com` (space reader) | `update_tenant_branding` | Pfizer's id | `Insufficient permissions` |
| `madaladodbele@gmail.com` | `update_tenant_access` | Pfizer's id | `Insufficient permissions` |
| `madaladodbele@gmail.com` | `add_tenant_owner` | Pfizer's id, any email | `Insufficient permissions` |
| `madaladodbele@gmail.com` | `invite_to_space` | Workspace's id, any email | `Only space owners can invite` |

- [ ] Run every row. Note which (if any) fail to raise the expected error.
- [ ] If any cell silently succeeds, that's a security issue — capture the RPC name + args and stop the test pass.

---

## Section 7d: Invite-code abuse

Goal: prove `accept_space_invite` (and the tenant-owner-invite branch of `add_tenant_owner`) handle reuse, expiry, wrong email, and garbage codes correctly.

**Reuse:**
- [ ] After Section 5 succeeds, sign in again as `madaladodbele@gmail.com` and submit the same invite code at `/onboarding?tab=join`. Expected: `Invite already used`.
- [ ] Sign in as a different user (e.g. `aadimadala@gmail.com` if signed out from prior tests) and submit the same code. Expected: `Invite already used` OR `Invite was sent to a different email address` (whichever fires first in the function body).

**Wrong email:**
- [ ] Generate a fresh invite for `madaladodbele@gmail.com` from Workspace's space-members page (use a throwaway role). Copy the code.
- [ ] In Incognito, sign in as `aadimadala@gmail.com`. Submit the code. Expected: `Invite was sent to a different email address`.
- [ ] After this, sign in as `madaladodbele@gmail.com` and confirm the code still works for the intended invitee (`Invite already used` should NOT have fired yet — the wrong-email attempt should not consume the invite).

**Garbage code:**
- [ ] In Incognito as any signed-in user, submit `00000000000000000000000000000000` (32 zero hex). Expected: `Invalid invite code`. UI should not leak whether real codes exist.

**Expired code (manual aging):**
- [ ] In SQL, generate an invite, then artificially expire it:
  ```sql
  -- In supabase prod SQL editor; replace <space-id> with Workspace's id.
  insert into space_invites (space_id, email, role, invite_code, created_by, expires_at)
  values ('<workspace-id>', 'aadimadala@gmail.com', 'reader',
          encode(gen_random_bytes(16), 'hex'), auth.uid(), now() - interval '1 day')
  returning invite_code;
  ```
  Copy the returned code.
- [ ] Sign in as `aadimadala@gmail.com` and submit the expired code. Expected: `Invite expired`.

---

## Section 7e: Direct-table RLS verification

Goal: bypass RPCs and query tables directly via the supabase-js client. RLS must filter to only what the user is allowed to see, regardless of which RPC they go through.

For each actor, use Recipe A or B from Section 7c. With the supabase client exposed via Recipe B:

```js
const tables = ['agencies','tenants','spaces','agency_members','tenant_members','space_members','space_invites','platform_admins'];
for (const t of tables) {
  const { data, error } = await __supabase.from(t).select('*');
  console.log(t, error?.message ?? `${data?.length} rows`);
}
```

With Recipe A, run one curl per table:

```bash
curl -sS "https://gmgprkymyjzkzirbzqzd.supabase.co/rest/v1/agencies?select=*" \
  -H "apikey: $ANON" -H "Authorization: Bearer $JWT" | jq 'length'
```

**Expected result matrix:**

| Table | `aadityamadala` (platform admin) | `aadi529` (agency/tenant/space owner) | `aadimadala` (tenant owner only) | `madaladodbele` (space reader) | Anonymous |
|---|---|---|---|---|---|
| `agencies` | all | only Stout | only Stout (visible because tenant member) | only Stout | 0 / RLS denies |
| `tenants` | all | only Pfizer | only Pfizer | only Pfizer | 0 |
| `spaces` | all | only Workspace | only Workspace | only Workspace | 0 |
| `agency_members` | all | rows for Stout | rows for Stout (or just self — depends on policy) | depends on policy | 0 |
| `tenant_members` | all | rows for Pfizer | rows for Pfizer | rows for Pfizer | 0 |
| `space_members` | all | rows for Workspace | rows for Workspace | rows for Workspace | 0 |
| `space_invites` | all | rows for Workspace (where they're owner) | 0 (not space member) | 0 (reader, not owner) | 0 |
| `platform_admins` | all (1 row, self) | 0 | 0 | 0 | 0 |

- [ ] Run for each actor (4 sign-ins + anonymous). Mark any cell whose actual count diverges from expected.
- [ ] Specifically verify: `aadimadala` (tenant owner of Pfizer, but NOT a Workspace member after Section 3) returns **0 rows** when querying any data table that lives under Workspace — `catalysts`, `drug_programs`, etc. This re-confirms the firewall from Section 3 at the table level, not just the RPC level.

---

## Section 7f: Cross-scope isolation (deferred — flag if you have time)

Setting up a second agency with its own tenant + members purely to test cross-agency / cross-tenant isolation is expensive (more accounts, more state). Recommend deferring unless a regression suggests cross-scope leakage. If you do run it:

- [ ] Provision a second agency `Acme` with owner `aadimadala@gmail.com` (note: this requires temporarily promoting `aadimadala@gmail.com`'s domain or blanking Acme's `email_domain`). Provision a tenant `Beta` under it.
- [ ] Sign in as `aadi529@gmail.com` (Stout owner). Try to access `https://acme.clintapp.com/admin`. Expected: agencyGuard passes (host check), but every data fetch returns empty / RLS denies.
- [ ] Try to call `update_agency_branding` for Acme's id while signed in as `aadi529`. Expected: `Insufficient permissions`.
- [ ] Tear down Acme + Beta when done (Section 11 cleanup).

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

- [ ] Delete the test users from prod auth.users so they don't linger:
  ```sql
  delete from auth.users where email in ('aadimadala@gmail.com', 'madaladodbele@gmail.com');
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
| Non-platform-admin can complete a super-admin action from the UI | Server-side gate missing or commented out on the RPC | `select prosrc from pg_proc where proname = '<rpc>'`; look for `is_platform_admin()` call near the top |
| Non-agency-owner can edit Stout's branding | `update_agency_branding` missing the agency-owner check, or RLS on `agencies` UPDATE too permissive | `select prosrc from pg_proc where proname = 'update_agency_branding'`; `select polname, polcmd, polqual from pg_policies where tablename = 'agencies'` |
| Logged-out user can hit `/super-admin` route without redirect | `authGuard` not in the route's `canActivate` chain, or session check is short-circuiting | `src/client/src/app/app.routes.ts` (look for the `/super-admin` route) |
| Reused or expired invite code gets accepted | `accept_space_invite` missing the `accepted_at`/`expires_at` checks | `select prosrc from pg_proc where proname = 'accept_space_invite'` |
| Cross-tenant SELECT returns rows it shouldn't | RLS policy on `catalysts` (or other data table) using OR instead of AND in tenant scope | `select polname, polqual from pg_policies where tablename = '<table>'` |
| Direct-table SELECT from supabase-js returns rows the actor shouldn't see | RLS policy missing on that table OR policy uses USING (true) | `select tablename, rowsecurity from pg_tables where schemaname='public' and not rowsecurity` to find tables with RLS disabled |
