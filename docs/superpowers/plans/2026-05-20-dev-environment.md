# Dev Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a persistent dev environment at `dev.clintapp.com` (separate Cloudflare Worker `clint-dev`, separate Supabase project, separate R2 bucket, wildcard subdomain support) and replace Cloudflare Workers Builds with two atomic GHA deploy workflows (one per env), with the prod workflow gated by a `production` GitHub Environment requiring reviewer approval.

**Architecture:** Long-lived `develop` branch deploys dev via `deploy-dev.yml`; PR `develop -> main` deploys prod via `deploy-prod.yml`, gated. Both workflows are atomic: `supabase db push` runs first; if it fails, `wrangler deploy` is skipped. Angular has three build configurations (`local` / `dev` / `production`) with file-replacement environment swaps. Wrangler env overrides (`[env.dev]` in `wrangler.jsonc`) keep one config file for both Workers.

**Tech Stack:** Angular 21, Cloudflare Workers (Static Assets), Supabase (Auth, Postgres, Edge Functions), GitHub Actions, `cloudflare/wrangler-action@v3`, `supabase/setup-cli@v1`.

**Spec:** `docs/superpowers/specs/2026-05-20-dev-environment-design.md`

---

## File Map

**Files to create:**
- `src/client/src/environments/environment.dev.ts` — dev Supabase URL + anon key, `apexDomain: 'dev.clintapp.com'`
- `.github/workflows/deploy-dev.yml` — atomic dev deploy
- `.github/workflows/deploy-prod.yml` — atomic prod deploy, gated by `production` environment

**Files to rename:**
- `src/client/src/environments/environment.development.ts` -> `src/client/src/environments/environment.local.ts` (byte-for-byte; no content change)

**Files to modify:**
- `src/client/angular.json` — rename `development` configuration to `local` (build + serve), add `dev` configuration, change `serve.defaultConfiguration` from `"development"` to `"local"`
- `src/client/wrangler.jsonc` — add `[env.dev]` block with overrides
- `.github/workflows/ci.yml` — extend triggers to include `develop`
- `CLAUDE.md` (root) — document the new `local` / `dev` / `production` env convention, dev URL, and prod deploy approval gate
- `docs/runbook/12-deployment.md` — replace Cloudflare Workers Builds section with the new dual-GHA-workflow flow; add destructive-migration two-deploy pattern

**Files NOT touched (intentional):**
- `src/client/scripts/set-env.js` — currently a no-op against `environment.ts` (placeholder strings absent). The new build-configuration file-replacement makes it unnecessary; safe to leave in place for now and remove in a follow-up if you want.
- `supabase/migrations/**` — no schema changes for this work
- `supabase/functions/send-invite-email/**` — out of scope (see spec)

---

## Phase 0: External system bootstrap

These tasks are dashboard work and CLI commands that must complete before the code changes can be deployed end-to-end. Run them in order. Capture values as you go — Phase 1 needs them.

### Task 0.1: Create the Supabase dev project

**Where:** Supabase dashboard (https://supabase.com/dashboard)

- [ ] **Step 1:** Create new project named `clint-dev`. Same region as prod. Choose a strong DB password and store it in your password manager.

   **Important — Security settings during creation:** Leave **"Automatically expose new tables" CHECKED** (the default). The clint migrations do NOT issue explicit `GRANT` statements for new tables; they rely on Supabase's auto-grant event trigger to give `anon` / `authenticated` table-level access. Disabling this setting causes the `20260502121200_get_latest_sync_run.sql` smoke test (and others) to fail with `permission denied for table ctgov_sync_runs`. Leave **"Enable Data API" CHECKED** as well. **"Enable automatic RLS"** can stay unchecked — migrations explicitly enable RLS where needed.
- [ ] **Step 2:** Capture three values for later use:
  - Project ref (the `xxxxxxxxxxxx` part of `https://xxxxxxxxxxxx.supabase.co`)
  - `anon` public API key (Settings -> API)
  - DB password (the one you set above)
- [ ] **Step 3 (verify):** Visit `https://<dev-ref>.supabase.co` in a browser. Expected: Supabase project loads (not a 404).

### Task 0.2: Apply migrations and seed to the dev project

**Where:** Your local terminal, in repo root.

- [ ] **Step 1:** Link the local CLI to the dev project.

```bash
supabase link --project-ref <dev-ref>
```

Expected: "Finished supabase link." (You may be prompted for the DB password.)

- [ ] **Step 2:** Push all migrations to dev.

```bash
supabase db push
```

Expected: List of pending migrations followed by "Finished supabase db push."

<<<<<<< HEAD
- [ ] **Step 3 (skipped intentionally):** `seed.sql` is **not** loaded on dev. System constants (marker_categories, marker_types, event_categories with `is_system=true`) are seeded by migrations and already exist after `db push`. `seed.sql` would additionally create a "Demo Pharma CI" demo tenant + populate it + install an auto-join trigger — useful for local dev convenience but undesirable for cloud dev (we want first Google sign-in on dev to mirror the new-user experience: zero tenants, zero spaces, manual provisioning required).

- [ ] **Step 4 (verify):** Open the dev project's Table Editor in the Supabase dashboard. Confirm `public.marker_types` has rows (seeded by migrations, not seed.sql).
=======
- [ ] **Step 3:** Load seed data via psql. (Seed is only auto-applied on `db reset` against local; remote pushes don't run it.)

```bash
psql "postgresql://postgres:<dev-db-password>@db.<dev-ref>.supabase.co:5432/postgres" -f supabase/seed.sql
```

Expected: A series of `INSERT 0 N` lines, no errors. (If your prod connection uses pgbouncer port 6543, the direct port 5432 above is correct for `psql`.)

- [ ] **Step 4 (verify):** Open the dev project's Table Editor in the Supabase dashboard. Confirm `public.marker_types` has rows.
>>>>>>> 1d43e68 (docs(plans): dev environment implementation plan (clint-dev + GHA deploys))

- [ ] **Step 5:** Re-link the local CLI back to **prod** so you don't accidentally push to dev later from local.

```bash
supabase link --project-ref gmgprkymyjzkzirbzqzd
```

Expected: "Finished supabase link."

### Task 0.3: Configure dev Supabase Auth

**Where:** Supabase dashboard, `clint-dev` project.

- [ ] **Step 1:** **Auth -> Providers -> Google.** Toggle Enabled. Paste the **same** Client ID and Client Secret as the prod project uses. (One Google OAuth client serves both.) Save.

- [ ] **Step 2:** **Auth -> URL Configuration.**
  - Site URL: `https://dev.clintapp.com`
  - Redirect URLs (add both):
    - `https://dev.clintapp.com/auth/callback`
    - `https://*.dev.clintapp.com/auth/callback`
  - Save.

- [ ] **Step 3 (verify):** The Providers page shows Google as Enabled and the URL Configuration page shows both redirect URLs in the allow-list.

### Task 0.4: Add dev redirect URI to Google Cloud OAuth client

**Where:** Google Cloud Console (https://console.cloud.google.com/) — same project that hosts your existing OAuth client.

- [ ] **Step 1:** **APIs & Services -> Credentials.** Open the OAuth 2.0 Client ID currently used by prod Supabase.

- [ ] **Step 2:** Under **Authorized redirect URIs**, click Add URI and paste:

```
https://<dev-ref>.supabase.co/auth/v1/callback
```

(Use the dev project ref from Task 0.1.) Save.

- [ ] **Step 3 (verify):** Visit the URL in a browser. Expected: a Supabase JSON response (`{"code":"validation_failed",...}` or similar — anything other than a Google "redirect_uri_mismatch" error means the URI is registered).

- [ ] **Step 4 (optional, only if Azure AD will be tested on dev):** In Azure Portal -> App registrations -> the existing app used by prod Supabase -> Authentication, add `https://<dev-ref>.supabase.co/auth/v1/callback` to the Redirect URIs (Web platform). Save. Skip this step entirely if dev will only exercise Google OAuth.

### Task 0.5: Create the dev R2 bucket

**Where:** Your local terminal, in `src/client/`.

- [ ] **Step 1:** Create the bucket.

```bash
cd src/client
npx wrangler r2 bucket create clint-materials-dev
```

Expected: "Successfully created bucket 'clint-materials-dev'."

- [ ] **Step 2:** Mirror CORS / lifecycle rules from `clint-materials`. In the Cloudflare dashboard, R2 -> `clint-materials` -> Settings, capture the JSON for CORS and any lifecycle rules. Then R2 -> `clint-materials-dev` -> Settings, paste the same JSON.

- [ ] **Step 3 (verify):** `npx wrangler r2 bucket list` shows both `clint-materials` and `clint-materials-dev`.

### Task 0.6: Create Cloudflare API token + capture account ID

**Where:** Cloudflare dashboard.

- [ ] **Step 1:** **My Profile -> API Tokens -> Create Token.** Use the "Edit Cloudflare Workers" template (or custom: `Account:Workers Scripts:Edit`, `Account:Account Settings:Read`, `User:User Details:Read`, scoped to your account). Name it `clint-gha-deploys`. Save the token value (shown once).

- [ ] **Step 2:** Capture your Cloudflare account ID: dashboard home page -> right sidebar -> "Account ID" -> click to copy. Store this and the API token from Step 1 for Task 0.7.

- [ ] **Step 3 (verify):** From local terminal, set the token as `CLOUDFLARE_API_TOKEN` and run:

```bash
CLOUDFLARE_API_TOKEN=<token> npx wrangler whoami
```

Expected: Your account ID and email are shown. Confirms the token works.

### Task 0.7: Add GitHub repository secrets

**Where:** GitHub repo -> Settings -> Secrets and variables -> Actions -> Repository secrets.

- [ ] **Step 1:** Add the following secrets one at a time. Names must match exactly:

| Secret name | Value source |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase account -> Account -> Access Tokens -> Generate new token |
| `SUPABASE_DEV_PROJECT_REF` | from Task 0.1 |
| `SUPABASE_DEV_DB_PASSWORD` | from Task 0.1 |
| `SUPABASE_PROD_PROJECT_REF` | `gmgprkymyjzkzirbzqzd` (current prod project) |
| `SUPABASE_PROD_DB_PASSWORD` | Supabase dashboard -> prod project -> Settings -> Database -> Connection String (extract password) |
| `CLOUDFLARE_API_TOKEN` | from Task 0.6 |
| `CLOUDFLARE_ACCOUNT_ID` | from Task 0.6 |

- [ ] **Step 2 (verify):** The Secrets page lists all seven. (Values are masked; that's expected.)

### Task 0.8: Create `production` GitHub Environment with required reviewers

**Where:** GitHub repo -> Settings -> Environments.

- [ ] **Step 1:** Click **New environment**, name it `production`. Save.

- [ ] **Step 2:** On the environment's page, under **Deployment protection rules** -> **Required reviewers**, add yourself (and ideally one backup reviewer). Save.

- [ ] **Step 3:** Under **Deployment branches and tags**, set to "Selected branches and tags" and add `main`. (Prevents the environment being usable from any other branch.)

- [ ] **Step 4 (verify):** The environment page shows: required reviewers configured; deployment branches restricted to `main`.

### Task 0.9: Enable branch protection on `main`

**Where:** GitHub repo -> Settings -> Branches -> Branch protection rules.

- [ ] **Step 1:** Click **Add rule** (or edit existing rule for `main`).

- [ ] **Step 2:** Branch name pattern: `main`. Enable:
  - Require a pull request before merging
  - Require approvals (minimum 1)
  - Require status checks to pass before merging
  - Required status checks: select `lint-and-build` and `tests` (the jobs from `ci.yml`)
  - Require branches to be up to date before merging (recommended)
  - Do NOT enable "Require linear history" unless you have a strong preference (we use `--merge` for develop->main to preserve develop history)

- [ ] **Step 3:** Save.

- [ ] **Step 4 (verify):** Try (and cancel) a direct push to main from local to confirm protection is active.

```bash
git checkout main
git commit --allow-empty -m "test: confirm branch protection"
git push origin main
```

Expected: `! [remote rejected] main -> main (protected branch hook declined)`. Then clean up:

```bash
git reset --hard origin/main
```

(`develop` is left permissive — no protection rule. Direct push is the intended workflow.)

---

## Phase 1: Code changes (single PR)

All Phase 1 work goes on one feature branch off `develop`. Since `develop` doesn't exist yet, the first task creates it.

### Task 1.1: Create the `develop` branch off `main`

**Where:** Your local terminal, in repo root.

- [ ] **Step 1:** Ensure local main is up to date.

```bash
git checkout main && git pull origin main
```

Expected: "Already up to date." or a fast-forward update.

- [ ] **Step 2:** Create and push `develop`.

```bash
git checkout -b develop
git push -u origin develop
```

Expected: `develop` branch created on origin with same SHA as `main`.

- [ ] **Step 3:** Create a feature branch off `develop` for Phase 1 work.

```bash
git checkout -b feat/dev-env-bootstrap
```

- [ ] **Step 4 (verify):** `git branch --show-current` prints `feat/dev-env-bootstrap`. `git log --oneline -1` shows the latest main commit.

### Task 1.2: Rename `environment.development.ts` to `environment.local.ts`

**Files:**
- Rename: `src/client/src/environments/environment.development.ts` -> `src/client/src/environments/environment.local.ts`

- [ ] **Step 1:** Rename the file (preserves git history as a rename).

```bash
git mv src/client/src/environments/environment.development.ts src/client/src/environments/environment.local.ts
```

- [ ] **Step 2 (verify):** Content is unchanged.

```bash
cat src/client/src/environments/environment.local.ts
```

Expected output (byte-for-byte the previous content):

```ts
export const environment = {
  production: false,
  supabaseUrl: 'http://127.0.0.1:54321',
  supabaseAnonKey: 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH',
  apexDomain: '',
};
```

### Task 1.3: Create `environment.dev.ts`

**Files:**
- Create: `src/client/src/environments/environment.dev.ts`

- [ ] **Step 1:** Create the file. Replace `<dev-ref>` and `<dev-anon-key>` with the actual values captured in Task 0.1.

```ts
export const environment = {
  production: true,
  supabaseUrl: 'https://<dev-ref>.supabase.co',
  supabaseAnonKey: '<dev-anon-key>',
  apexDomain: 'dev.clintapp.com',
};
```

- [ ] **Step 2 (verify):** No literal `<dev-ref>` or `<dev-anon-key>` placeholders remain.

```bash
grep -n "<dev-" src/client/src/environments/environment.dev.ts
```

Expected: no output (exit code 1).

### Task 1.4: Update `angular.json` configurations

**Files:**
- Modify: `src/client/angular.json` (build configurations + serve configurations + serve default)

The current file has a `development` configuration that points at `environment.development.ts`. We need to:
1. Rename the existing `development` build configuration to `local` and repoint to `environment.local.ts`.
2. Add a new `dev` build configuration that file-replaces with `environment.dev.ts`, otherwise inheriting prod's optimization settings.
3. Rename the existing `development` serve configuration to `local`, pointing at `clinical-trial-dashboard:build:local`.
4. Add a new `dev` serve configuration pointing at `clinical-trial-dashboard:build:dev`.
5. Change `serve.defaultConfiguration` from `"development"` to `"local"`.

- [ ] **Step 1:** Read `src/client/angular.json` lines 29-77 to confirm the current shape matches the spec snippet.

- [ ] **Step 2:** Replace the build `configurations` block. Find:

```json
            "development": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true,
              "fileReplacements": [
                {
                  "replace": "src/environments/environment.ts",
                  "with": "src/environments/environment.development.ts"
                }
              ]
            }
```

Replace with:

```json
            "local": {
              "optimization": false,
              "extractLicenses": false,
              "sourceMap": true,
              "fileReplacements": [
                {
                  "replace": "src/environments/environment.ts",
                  "with": "src/environments/environment.local.ts"
                }
              ]
            },
            "dev": {
              "outputHashing": "all",
              "fileReplacements": [
                {
                  "replace": "src/environments/environment.ts",
                  "with": "src/environments/environment.dev.ts"
                }
              ]
            }
```

(The `dev` configuration deliberately omits `optimization`/`extractLicenses`/`sourceMap` so it inherits Angular's prod defaults — same as the `production` configuration above it.)

- [ ] **Step 3:** Replace the serve `configurations` block. Find:

```json
          "configurations": {
            "production": {
              "buildTarget": "clinical-trial-dashboard:build:production"
            },
            "development": {
              "buildTarget": "clinical-trial-dashboard:build:development"
            }
          },
          "defaultConfiguration": "development"
```

Replace with:

```json
          "configurations": {
            "production": {
              "buildTarget": "clinical-trial-dashboard:build:production"
            },
            "dev": {
              "buildTarget": "clinical-trial-dashboard:build:dev"
            },
            "local": {
              "buildTarget": "clinical-trial-dashboard:build:local"
            }
          },
          "defaultConfiguration": "local"
```

- [ ] **Step 4 (verify):** No `development` references remain in `angular.json`.

```bash
grep -n "development" src/client/angular.json
```

Expected: no output.

- [ ] **Step 5 (verify): build with `local` configuration succeeds and embeds the local Supabase URL.**

```bash
cd src/client
npm run build -- --configuration local
grep -r "127.0.0.1:54321" dist/clinical-trial-dashboard/browser/ | head -3
```

Expected: at least one match (the local Supabase URL is in the bundle).

- [ ] **Step 6 (verify): build with `dev` configuration succeeds and embeds the dev Supabase URL.**

```bash
cd src/client
npm run build -- --configuration dev
grep -r "<dev-ref>.supabase.co" dist/clinical-trial-dashboard/browser/ | head -3
```

(Substitute the real dev ref captured in Task 0.1.) Expected: at least one match.

- [ ] **Step 7 (verify): build with `production` (default) configuration still embeds prod values.**

```bash
cd src/client
npm run build
grep -r "gmgprkymyjzkzirbzqzd" dist/clinical-trial-dashboard/browser/ | head -3
```

Expected: at least one match.

- [ ] **Step 8 (verify): `ng serve` default still works.**

```bash
cd src/client
timeout 20 npx ng serve --port 8000 &
sleep 12
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/
kill %1 2>/dev/null || true
```

Expected: `200`. Confirms the renamed `local` serve configuration is the default.

- [ ] **Step 9:** Grep the rest of the repo for stale references and update any hits in tracked source/config (do NOT modify old plan/spec documents under `docs/superpowers/plans/` or `docs/specs/` — those are historical).

```bash
grep -rn "environment.development\|configuration[: =\"']*development" src/client docs/runbook .github 2>/dev/null | grep -v node_modules | grep -v "\.git/"
```

Expected: zero hits outside historical docs. If any hits land in `src/client/**`, `docs/runbook/**`, or `.github/**`, update them as part of this task.

- [ ] **Step 10:** Commit.

```bash
git add src/client/angular.json src/client/src/environments/
git commit -m "build(angular): rename development config to local; add dev config

Renames the existing 'development' build/serve configurations to 'local'
(pointing at environment.local.ts, the renamed environment.development.ts).
Adds a new 'dev' build configuration that file-replaces with
environment.dev.ts so the cloud dev environment at dev.clintapp.com gets a
prod-style build pointed at the clint-dev Supabase project. ng serve
default is now --configuration local."
```

### Task 1.5: Update `wrangler.jsonc` with `[env.dev]` overrides

**Files:**
- Modify: `src/client/wrangler.jsonc`

- [ ] **Step 1:** Open `src/client/wrangler.jsonc`. After the existing top-level `ratelimits` array (closing `]` followed by `}`), add a comma and the `env` block. Final shape:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "clint",
  "main": "./worker/index.ts",
  "compatibility_date": "2026-04-28",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./dist/clinical-trial-dashboard/browser",
    "not_found_handling": "single-page-application",
    "binding": "ASSETS"
  },
  // CTGOV_WORKER_SECRET is provisioned via `wrangler secret put` and is
  // intentionally NOT listed here.
  "vars": {
    "ALLOWED_APEXES": "clintapp.com",
    "R2_BUCKET": "clint-materials",
    "CTGOV_BASE_URL": "https://clinicaltrials.gov",
    "CTGOV_BATCH_SIZE": "100",
    "CTGOV_PARALLEL_FETCHES": "10"
  },
  "triggers": {
    "crons": ["0 7 * * *"]
  },
  "ratelimits": [
    {
      "name": "UPLOAD_LIMITER",
      "namespace_id": "1001",
      "simple": { "limit": 30, "period": 60 }
    },
    {
      "name": "DOWNLOAD_LIMITER",
      "namespace_id": "1002",
      "simple": { "limit": 120, "period": 60 }
    }
  ],
  "env": {
    "dev": {
      "name": "clint-dev",
      "vars": {
        "ALLOWED_APEXES": "dev.clintapp.com",
        "R2_BUCKET": "clint-materials-dev",
        "CTGOV_BASE_URL": "https://clinicaltrials.gov",
        "CTGOV_BATCH_SIZE": "100",
        "CTGOV_PARALLEL_FETCHES": "10"
      },
      "triggers": {
        "crons": []
      },
      "ratelimits": [
        {
          "name": "UPLOAD_LIMITER",
          "namespace_id": "1003",
          "simple": { "limit": 30, "period": 60 }
        },
        {
          "name": "DOWNLOAD_LIMITER",
          "namespace_id": "1004",
          "simple": { "limit": 120, "period": 60 }
        }
      ]
    }
  }
}
```

- [ ] **Step 2 (verify): the prod config still parses.**

```bash
cd src/client
npx wrangler deploy --dry-run
```

Expected: dry-run completes with "Your worker has access to the following bindings:" listing the prod `ASSETS` binding and prod vars. No errors.

- [ ] **Step 3 (verify): the dev config parses and reports the dev overrides.**

```bash
cd src/client
npx wrangler deploy --env dev --dry-run
```

Expected: dry-run completes with bindings reflecting `ALLOWED_APEXES: "dev.clintapp.com"` and `R2_BUCKET: "clint-materials-dev"`.

- [ ] **Step 4:** Commit.

```bash
git add src/client/wrangler.jsonc
git commit -m "build(wrangler): add [env.dev] overrides for clint-dev worker

Adds dev environment overrides so wrangler deploy --env dev targets a
distinct clint-dev worker bound to clint-materials-dev R2, with
ALLOWED_APEXES=dev.clintapp.com, separate rate-limiter namespaces, and
the daily CT.gov ingest cron disabled (manual trigger only on dev)."
```

### Task 1.6: Add `.github/workflows/deploy-dev.yml`

**Files:**
- Create: `.github/workflows/deploy-dev.yml`

- [ ] **Step 1:** Create the file with the following content:

```yaml
name: Deploy to dev
on:
  push:
    branches: [develop]
  workflow_dispatch:

concurrency:
  group: deploy-dev
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: src/client/package-lock.json

      - name: Install Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Link dev Supabase project
        run: supabase link --project-ref ${{ secrets.SUPABASE_DEV_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Apply migrations to dev
        run: supabase db push
        env:
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DEV_DB_PASSWORD }}

      - name: Install client deps
        run: cd src/client && npm ci

      - name: Build SPA (dev)
        run: cd src/client && npm run build -- --configuration dev

      - name: Deploy Worker (dev)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: src/client
          command: deploy --env dev
```

- [ ] **Step 2 (verify): YAML parses.**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/deploy-dev.yml','utf8'))" \
  || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-dev.yml'))"
```

Expected: no output (success). If `js-yaml` is missing, the python3 fallback covers it.

- [ ] **Step 3:** Commit.

```bash
git add .github/workflows/deploy-dev.yml
git commit -m "ci: add deploy-dev workflow (atomic supabase push + wrangler deploy)

Single job that links the dev Supabase project, applies migrations, then
builds and deploys the SPA via wrangler-action. If migrations fail, the
SPA deploy step never runs. Triggered on push to develop and via
workflow_dispatch for manual redeploys."
```

### Task 1.7: Add `.github/workflows/deploy-prod.yml`

**Files:**
- Create: `.github/workflows/deploy-prod.yml`

- [ ] **Step 1:** Create the file:

```yaml
name: Deploy to production
on:
  push:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: src/client/package-lock.json

      - name: Install Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Link prod Supabase project
        run: supabase link --project-ref ${{ secrets.SUPABASE_PROD_PROJECT_REF }}
        env:
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}

      - name: Apply migrations to prod
        run: supabase db push
        env:
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_PROD_DB_PASSWORD }}

      - name: Install client deps
        run: cd src/client && npm ci

      - name: Build SPA (prod)
        run: cd src/client && npm run build

      - name: Deploy Worker (prod)
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: src/client
          command: deploy
```

- [ ] **Step 2 (verify): YAML parses.**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/deploy-prod.yml','utf8'))" \
  || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy-prod.yml'))"
```

Expected: no output.

- [ ] **Step 3:** Commit.

```bash
git add .github/workflows/deploy-prod.yml
git commit -m "ci: add deploy-prod workflow gated by production environment

Mirrors deploy-dev.yml shape (supabase push then wrangler deploy, atomic)
but adds environment: production so the job pauses for required-reviewer
approval before any step runs. Concurrency group prevents back-to-back
prod merges from racing."
```

### Task 1.8: Extend `ci.yml` triggers to include `develop`

**Files:**
- Modify: `.github/workflows/ci.yml` (the `on:` block at the top)

- [ ] **Step 1:** Find the existing `on:` block:

```yaml
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
```

Replace with:

```yaml
on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
```

- [ ] **Step 2 (verify): YAML parses.**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/ci.yml','utf8'))" \
  || python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: no output.

- [ ] **Step 3:** Commit.

```bash
git add .github/workflows/ci.yml
git commit -m "ci: extend triggers to include develop branch

Lint, build, and tests now run on push to develop and on PRs targeting
develop, in addition to main. Test jobs remain env-agnostic (local
Supabase only)."
```

### Task 1.9: Update root `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (project root)

- [ ] **Step 1:** Read `CLAUDE.md` to locate the Tech Stack section and the Spec Location section. Make two additions:

(a) Under the **Tech Stack** section's frontend bullet, append a sentence noting the dev environment. Find:

```
- **Frontend:** Angular 19 (standalone components, no SSR) with PrimeNG + Tailwind CSS v4, deployed to Cloudflare (Workers + static assets via `src/client/wrangler.jsonc`; SPA fallback handled by `not_found_handling: "single-page-application"`; security headers in `src/client/public/_headers`)
```

Replace with:

```
- **Frontend:** Angular 19 (standalone components, no SSR) with PrimeNG + Tailwind CSS v4, deployed to Cloudflare (Workers + static assets via `src/client/wrangler.jsonc`; SPA fallback handled by `not_found_handling: "single-page-application"`; security headers in `src/client/public/_headers`). Two Workers: `clint` (prod, `clintapp.com`) and `clint-dev` (dev, `dev.clintapp.com` + wildcard `*.dev.clintapp.com`). Three Angular build configurations: `local` (laptop, local Supabase), `dev` (cloud dev), `production` (prod). Deploys via GHA workflows (`deploy-dev.yml`, `deploy-prod.yml`) -- Cloudflare Workers Builds is disabled. Prod deploys are gated by a `production` GitHub Environment requiring reviewer approval.
```

(b) Under the **Spec Location** section, add a line at the end:

```
- Dev environment design: `docs/superpowers/specs/2026-05-20-dev-environment-design.md`
```

- [ ] **Step 2 (verify): grep finds the new content.**

```bash
grep -c "clint-dev" CLAUDE.md
grep -c "deploy-prod.yml" CLAUDE.md
grep -c "2026-05-20-dev-environment-design" CLAUDE.md
```

Expected: each prints at least `1`.

- [ ] **Step 3:** Commit.

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): document dev environment + GHA-only deploys

Adds Tech Stack notes for the two Workers (clint, clint-dev), the three
Angular build configurations (local/dev/production), and the GHA-driven
deploy flow with production environment approval gate. Adds spec link."
```

### Task 1.10: Update `docs/runbook/12-deployment.md`

**Files:**
- Modify: `docs/runbook/12-deployment.md`

The existing runbook documents the now-replaced Cloudflare Workers Builds setup. Replace that section with the new GHA-driven flow and add a destructive-migration pattern note.

- [ ] **Step 1:** Read `docs/runbook/12-deployment.md` to locate the "## Cloudflare Setup" section (starts around line 14) and the table of Builds settings (around line 44-50).

- [ ] **Step 2:** Replace the entire "## Cloudflare Setup" section (from the `## Cloudflare Setup` heading through the line ending with "...full policy and rationale).") with:

```markdown
## Cloudflare Setup

The frontend is configured by a small set of files in `src/client/`:

`src/client/wrangler.jsonc` declares two environments:
- **top-level** -- prod (`clint` Worker, bound to `clintapp.com`)
- **`[env.dev]`** -- dev (`clint-dev` Worker, bound to `dev.clintapp.com` + wildcard `*.dev.clintapp.com`)

The dev block overrides `name`, `vars` (ALLOWED_APEXES, R2_BUCKET), rate-limiter namespace ids, and disables the daily CT.gov cron (`triggers.crons: []`).

`src/client/public/_headers` carries security headers (CSP, frame-ancestors, etc.); the same file is served by both Workers since Custom Domains are bound per-Worker.

`not_found_handling: "single-page-application"` is the Worker-level catch-all that hands every unknown route back to `/index.html`. There is no `_redirects` file -- Cloudflare's docs explicitly reject the Netlify-style `/* /index.html 200` rewrite as recursive.

## Deploy flow (GHA-driven, atomic per env)

Cloudflare Workers Builds auto-deploys are **disabled**. Both environments deploy via GitHub Actions workflows that call `wrangler deploy` themselves using `CLOUDFLARE_API_TOKEN`. Each workflow is a single atomic job: `supabase db push` runs first; if it fails, `wrangler deploy` is skipped and the Worker stays on the previous build.

### Dev: push to `develop`

Triggers `.github/workflows/deploy-dev.yml`. No approval gate. Workflow runs:

1. `supabase link --project-ref $SUPABASE_DEV_PROJECT_REF`
2. `supabase db push` against dev project
3. `cd src/client && npm ci`
4. `cd src/client && npm run build -- --configuration dev`
5. `wrangler deploy --env dev` via `cloudflare/wrangler-action@v3`

### Prod: merge `develop -> main`

Triggers `.github/workflows/deploy-prod.yml`. Gated by the `production` GitHub Environment which requires reviewer approval before any step runs. Reviewer opens the run in Actions, reviews the migration diff and SHA, clicks "Approve and deploy". Then the workflow runs the same shape as dev but against prod project + prod Worker + `--configuration production` (the angular default).

### Destructive migrations (two-deploy pattern)

The atomic flow assumes additive migrations: SPA sees old-or-newer schema, never older. For destructive changes (dropping a column the current prod SPA still reads, renaming an RPC, etc.) there is still a window between the migration step and the wrangler deploy step where the new schema is live and the old SPA is still serving.

Pattern for destructive migrations:

1. **PR 1:** SPA change only. Remove all references to the soon-to-be-dropped column / renamed RPC. Merge, deploy. Prod SPA no longer touches the doomed surface.
2. **PR 2:** Migration only. Drop the column / rename. Merge, deploy.

Convention, not enforcement. When in doubt, split the PR.

### Emergency fallback

The Cloudflare Workers Build connection for the `clint` Worker is left in place (just with "Automatic deploys" turned off). If GHA is unavailable, re-enable auto-deploy on the dashboard as a one-click workaround. Don't forget to re-disable when GHA comes back.

The CSP is conservative -- loosen if a specific integration breaks (see [08-authentication-security.md](08-authentication-security.md) for the full policy and rationale).
```

- [ ] **Step 3 (verify): the Builds settings table is gone; the new sections are present.**

```bash
grep -n "Build command\|Deploy command\|Non-production branch deploy" docs/runbook/12-deployment.md
grep -n "deploy-dev.yml\|deploy-prod.yml\|Destructive migrations" docs/runbook/12-deployment.md
```

Expected: first grep returns no output; second grep returns multiple hits.

- [ ] **Step 4:** Commit.

```bash
git add docs/runbook/12-deployment.md
git commit -m "docs(runbook): rewrite deployment section for two-env GHA flow

Replaces the Cloudflare Workers Builds settings table with the new
GHA-driven flow: deploy-dev.yml on push to develop (atomic, no gate),
deploy-prod.yml on push to main (atomic, production environment
approval gate). Adds destructive-migration two-deploy pattern."
```

### Task 1.11: Run full local verification before pushing the PR

- [ ] **Step 1:** Lint passes.

```bash
cd src/client && npm run lint
```

Expected: zero errors (warnings ok if not new).

- [ ] **Step 2:** Build passes for all three configurations.

```bash
cd src/client && npm run build -- --configuration local
cd src/client && npm run build -- --configuration dev
cd src/client && npm run build
```

Expected: each ends with "Application bundle generation complete."

- [ ] **Step 3:** Worker tests still pass (no change expected, sanity check).

```bash
cd src/client && npm run test:worker
```

Expected: all tests pass.

- [ ] **Step 4:** Push and open PR.

```bash
git push -u origin feat/dev-env-bootstrap
gh pr create --base develop --title "Dev environment bootstrap (clint-dev + GHA deploys)" --body "$(cat <<'EOF'
## Summary
- Renames Angular development configuration to local; adds new dev configuration pointing at environment.dev.ts
- Adds wrangler.jsonc [env.dev] block for clint-dev worker
- Adds deploy-dev.yml and deploy-prod.yml (atomic supabase push + wrangler deploy; prod gated by production environment)
- Extends ci.yml triggers to develop
- Documents dev env in root CLAUDE.md and rewrites docs/runbook/12-deployment.md

## Test plan
- [ ] CI green on this PR (lint, build, tests against local Supabase)
- [ ] After Phase 2 (clint-dev Worker bootstrap + Custom Domains), merging this PR triggers deploy-dev.yml end-to-end
- [ ] dev.clintapp.com loads after the workflow completes
- [ ] Google OAuth sign-in works on dev
- [ ] Wildcard *.dev.clintapp.com resolves and matches tenant subdomain

Spec: docs/superpowers/specs/2026-05-20-dev-environment-design.md
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 5:** Watch CI on the PR. Expected: all jobs green.

---

## Phase 2: Bootstrap the `clint-dev` Worker (one-time, from local)

This phase runs **before** merging the PR from Phase 1. Goal: have the `clint-dev` Worker exist with Custom Domains attached so the first GHA-triggered deploy (right after merge) lands somewhere usable.

You must be on the `feat/dev-env-bootstrap` branch (or any branch with the updated `wrangler.jsonc`) for these commands to work.

### Task 2.1: First-time `clint-dev` Worker deploy from local

- [ ] **Step 1:** Confirm you're on the right branch.

```bash
git branch --show-current
```

Expected: `feat/dev-env-bootstrap`.

- [ ] **Step 2:** Build the dev SPA so wrangler has something to upload.

```bash
cd src/client && npm run build -- --configuration dev
```

Expected: "Application bundle generation complete." (Output in `dist/clinical-trial-dashboard/browser/`.)

- [ ] **Step 3:** Deploy to create the `clint-dev` Worker.

```bash
cd src/client && npx wrangler deploy --env dev
```

Expected: "Uploaded clint-dev (... seconds)" followed by "Deployed clint-dev". A `*.workers.dev` URL is printed; ignore it (we'll bind Custom Domains next).

- [ ] **Step 4 (verify):** Cloudflare dashboard -> Workers & Pages shows two Workers: `clint` and `clint-dev`.

### Task 2.2: Add Custom Domains to `clint-dev`

**Where:** Cloudflare dashboard -> `clint-dev` Worker -> Settings -> Domains & Routes.

- [ ] **Step 1:** Click **Add** -> **Custom Domain**. Enter `dev.clintapp.com`. Save. Cloudflare creates the DNS record (proxied) and provisions a cert.

- [ ] **Step 2:** Click **Add** -> **Custom Domain**. Enter `*.dev.clintapp.com`. Save. Cloudflare creates the wildcard DNS record and provisions a wildcard cert.

- [ ] **Step 3 (verify):**

```bash
curl -sI https://dev.clintapp.com/ | head -5
```

Expected: HTTP/2 200 (or 404 if SPA fallback isn't hit yet -- either is fine, confirms TLS + routing). Cert may take 1-2 minutes to provision; retry if you get a TLS error.

```bash
curl -sI https://test.dev.clintapp.com/ | head -5
```

Expected: same as above. Confirms wildcard resolution + cert.

### Task 2.3: Set `CTGOV_WORKER_SECRET` for `clint-dev`

- [ ] **Step 1:** Generate a fresh secret value (don't reuse prod's).

```bash
openssl rand -hex 32
```

Save the value temporarily (clipboard or password manager).

- [ ] **Step 2:** Set the secret on the dev Worker.

```bash
cd src/client && npx wrangler secret put CTGOV_WORKER_SECRET --env dev
```

Paste the value when prompted. Expected: "Success! Uploaded secret CTGOV_WORKER_SECRET."

- [ ] **Step 3 (verify):**

```bash
cd src/client && npx wrangler secret list --env dev
```

Expected: list includes `CTGOV_WORKER_SECRET`.

- [ ] **Step 4:** If the prod Worker has any other secrets (check via `npx wrangler secret list` from `src/client`), set the dev equivalents the same way with `--env dev`. Use fresh values, not prod's.

---

## Phase 3: Switchover (disable prod CF Build, merge to develop, smoke test)

### Task 3.1: Disable Cloudflare auto-deploy on the `clint` Worker

**Where:** Cloudflare dashboard -> `clint` Worker -> Settings -> Builds.

- [ ] **Step 1:** If a "Builds" connection is present, click into it. Toggle off **Automatic deploys** (or set the branch filter to a non-existent branch like `cloudflare-fallback`). **Do not delete the connection** -- leave it as an emergency fallback.

- [ ] **Step 2 (verify):** The Builds settings page shows automatic deploys disabled.

> **Critical ordering:** This must complete BEFORE the Phase 4 merge to `main`. If both CF Builds and the GHA workflow try to deploy on the same push, you get a race.

### Task 3.2: Merge the Phase 1 PR into `develop`

- [ ] **Step 1:** Confirm CI is green on the PR.

```bash
gh pr view feat/dev-env-bootstrap --json statusCheckRollup | grep -i "SUCCESS\|FAILURE\|PENDING"
```

Expected: only SUCCESS entries.

- [ ] **Step 2:** Merge.

```bash
gh pr merge feat/dev-env-bootstrap --squash --delete-branch
```

Expected: "Merged pull request #N."

- [ ] **Step 3 (verify):** `deploy-dev.yml` was triggered.

```bash
gh run list --workflow=deploy-dev.yml --limit 1
```

Expected: A run with status `queued` or `in_progress` for the latest `develop` SHA.

### Task 3.3: Watch `deploy-dev.yml` to completion and verify

- [ ] **Step 1:** Tail the workflow run.

```bash
gh run watch
```

Select the deploy-dev run. Expected: each step succeeds; final status "completed success." Migration step may say "Remote database is up to date" if no new migrations -- that's fine.

- [ ] **Step 2 (verify):** dev URL serves the new build.

```bash
curl -s https://dev.clintapp.com/ | grep -o '<title>[^<]*</title>'
```

Expected: the app's title tag is returned.

- [ ] **Step 3 (verify):** SPA loads in a browser. Open `https://dev.clintapp.com` and confirm the landing page renders, no console errors.

- [ ] **Step 4 (verify):** Wildcard subdomain resolves to the same Worker.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://acme.dev.clintapp.com/
```

Expected: `200` (the SPA loads even though no `acme` tenant exists; the brand resolver will fall back to default).

- [ ] **Step 5 (manual):** Sign in with Google OAuth on `https://dev.clintapp.com`. Confirm:
  - Google consent screen appears.
  - After consent, you land back on dev with a session.
  - Browser dev tools -> Application -> Cookies shows a Supabase cookie with `Domain=.dev.clintapp.com` (or `dev.clintapp.com` — both scope to the dev subtree).

---

## Phase 4: First prod deploy via the new pipeline

### Task 4.1: PR `develop -> main`

- [ ] **Step 1:** Open the PR.

```bash
git checkout develop && git pull origin develop
gh pr create --base main --head develop --title "Promote dev environment changes to prod" --body "$(cat <<'EOF'
## Summary
Promotes the dev-environment-bootstrap changes (deploy-dev.yml, deploy-prod.yml, [env.dev] in wrangler.jsonc, renamed Angular configurations, runbook + CLAUDE.md updates) to prod.

## Test plan
- [ ] CI green
- [ ] After merge, deploy-prod.yml queues and pauses on production environment approval
- [ ] Approving runs supabase db push (no-op; no new migrations) then wrangler deploy
- [ ] clintapp.com still loads with the new build
EOF
)"
```

- [ ] **Step 2:** Wait for CI green, then merge.

```bash
gh pr merge develop --merge   # use --merge (not squash) to preserve develop history
```

Expected: "Merged pull request #N."

### Task 4.2: Approve the prod deploy and watch it run

- [ ] **Step 1:** Confirm `deploy-prod.yml` queued and is waiting on the environment gate.

```bash
gh run list --workflow=deploy-prod.yml --limit 1
```

Expected: A run with status `waiting`.

- [ ] **Step 2:** Approve. Open the run in the browser:

```bash
gh run view --web
```

In the Actions UI, click "Review deployments", check the `production` box, optionally add a comment, click "Approve and deploy".

- [ ] **Step 3:** Tail to completion.

```bash
gh run watch
```

Expected: each step succeeds; final status "completed success." The migration step should report "Remote database is up to date" (no new migrations in this PR).

- [ ] **Step 4 (verify):** prod URL still loads.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://clintapp.com/
```

Expected: `200`.

- [ ] **Step 5 (manual):** Open `https://clintapp.com` in a browser. Confirm the SPA renders and your existing prod session (if any) still works.

---

## Phase 5: End-to-end migration smoke test (optional but recommended)

Tests that the atomic migration pipeline actually works end-to-end with a real (no-op) migration. Skip if you'd rather wait for a real change.

### Task 5.1: Add a no-op migration on `develop`

- [ ] **Step 1:** Create a feature branch off `develop`.

```bash
git checkout develop && git pull
git checkout -b chore/deploy-pipeline-smoke
```

- [ ] **Step 2:** Generate a no-op migration.

```bash
supabase migration new deploy_pipeline_smoke
```

Expected: file created at `supabase/migrations/<timestamp>_deploy_pipeline_smoke.sql`.

- [ ] **Step 3:** Edit the file to a true no-op:

```sql
-- Smoke test for the GHA deploy pipeline. No schema change.
select 1;
```

- [ ] **Step 4:** Verify locally.

```bash
supabase db reset
```

Expected: clean run, including the new migration.

- [ ] **Step 5:** Commit, push, PR, merge.

```bash
git add supabase/migrations/
git commit -m "chore(db): no-op migration for deploy pipeline smoke test"
git push -u origin chore/deploy-pipeline-smoke
gh pr create --base develop --title "No-op migration: deploy pipeline smoke" --body "Smoke test for deploy-dev.yml end-to-end (migration step + SPA deploy)."
# After CI green:
gh pr merge chore/deploy-pipeline-smoke --squash --delete-branch
```

### Task 5.2: Verify `deploy-dev.yml` applied the migration

- [ ] **Step 1:** Watch the workflow.

```bash
gh run watch
```

Expected: migration step prints "Applying migration <timestamp>_deploy_pipeline_smoke.sql" then succeeds. SPA deploy step succeeds.

- [ ] **Step 2 (verify):** dev project's migration history includes the new file.

```bash
supabase migration list --linked --project-ref <dev-ref>
```

Expected: the new migration appears in the "Remote" column.

### Task 5.3: Promote to prod and verify

- [ ] **Step 1:** PR `develop -> main`, wait for CI, merge.

```bash
gh pr create --base main --head develop --title "Deploy: no-op migration smoke" --body "Promotes the no-op migration to prod to test deploy-prod.yml end-to-end."
# After CI green:
gh pr merge develop --merge
```

- [ ] **Step 2:** Approve the production environment gate (as in Task 4.2).

- [ ] **Step 3:** Watch and verify.

```bash
gh run watch
```

Expected: migration step applies the same migration to prod; SPA deploy step succeeds.

- [ ] **Step 4 (verify):**

```bash
supabase migration list --linked --project-ref gmgprkymyjzkzirbzqzd
```

Expected: the no-op migration is now in the prod "Remote" column.

---

## Done criteria

- [ ] `develop` branch exists; pushing to it triggers `deploy-dev.yml` which atomically pushes migrations to the dev Supabase project then deploys the `clint-dev` Worker.
- [ ] `https://dev.clintapp.com` loads the SPA built with `environment.dev.ts`.
- [ ] Wildcard `https://<anything>.dev.clintapp.com` resolves to the same Worker.
- [ ] Google OAuth sign-in works on dev.
- [ ] Merging `develop -> main` queues `deploy-prod.yml`, which pauses on the `production` environment gate until approved.
- [ ] After approval, the prod workflow atomically pushes migrations to the prod Supabase project then deploys the `clint` Worker.
- [ ] `https://clintapp.com` loads the SPA built with `environment.ts` (prod).
- [ ] Cloudflare Workers Builds auto-deploy is disabled on the `clint` Worker (connection retained as emergency fallback).
- [ ] `ng serve` (default) still works locally with the renamed `local` configuration.
- [ ] `docs/runbook/12-deployment.md` documents the new flow; `CLAUDE.md` mentions the two-Worker / three-configuration setup.

## What's left out (explicit non-goals)

- `send-invite-email` is not deployed to dev. When invite emails go live in prod, a follow-up effort handles dev (see spec "Out of scope").
- No `set-env.js` cleanup. The script is a no-op against the current `environment.ts`; remove it in a separate PR if you want.
- No per-PR previews. Single shared dev URL.
- No prod-data snapshot in dev. Bare migrations + seed.
- No automated destructive-migration enforcement. Convention only.
