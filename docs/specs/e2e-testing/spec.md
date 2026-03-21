---
id: spec-2026-007
title: E2E Testing with Playwright + GitHub Actions CI
slug: e2e-testing
status: approved
created: 2026-03-21
updated: 2026-03-21
---

# E2E Testing with Playwright + GitHub Actions CI

## Summary

Add comprehensive end-to-end tests using Playwright that run against a local Supabase instance. Tests cover every core user flow -- auth, onboarding, dashboard, CRUD management, and multi-tenant navigation. A GitHub Actions workflow runs these tests on every push to main and on PRs, blocking merge on failure. A Claude Code hook runs tests after implementation changes to catch regressions before commit.

## Goals

- Protect core functionality from regressions on every push to main
- Cover all critical user flows end-to-end: auth, onboarding, dashboard, CRUD, navigation
- Tests are comprehensive but not repetitive -- each test validates a distinct flow
- Fully automated: local Supabase spins up in CI, migrations + seed run, tests execute against it
- Fast feedback: tests run in CI on push/PR; Claude Code hook catches issues pre-commit
- Test auth realistically using Supabase Admin API to create sessions (no Google OAuth bypass)

## Non-Goals

- Unit tests for individual services/components (future enhancement, separate spec)
- Visual regression testing (screenshot comparison)
- Performance/load testing
- Testing against production Supabase
- Mobile viewport testing (desktop-first for now)
- Cross-browser testing in CI (Chromium only for speed; local devs can run Firefox/WebKit)

---

## Architecture Overview

### Test Stack

```
Playwright (E2E runner)
  |-- Tests run in Chromium (CI) or multi-browser (local)
  |-- Connects to Angular dev server (localhost:4201)
  |-- Auth: Supabase Admin API creates test user + session token
  |-- Backend: Local Supabase (postgres + auth + postgrest)
  |-- Data: Migrations + seed.sql provide baseline data
```

### Auth Strategy

Tests bypass Google OAuth entirely by using Supabase's Admin API:

1. **Test setup** calls `supabase.auth.admin.createUser()` to create a test user
2. Gets back a valid session (access_token + refresh_token)
3. Injects the session into the browser via `page.evaluate()` setting `localStorage` keys that Supabase JS client reads
4. Navigates to the app -- auth guard sees a valid session, proceeds normally

This is realistic (RLS policies still enforce, session is real) without needing Google OAuth credentials in CI.

### Test Data Strategy

- **Baseline:** `supabase db reset` runs all migrations + seed.sql before the test suite
- **Per-test isolation:** Each test file uses a dedicated tenant/space created in `beforeAll`. CRUD tests create their own entities and clean up in `afterAll`
- **No shared mutable state:** Tests never depend on data created by other test files

### CI Pipeline

```
Push to main / PR opened
  └── GitHub Actions workflow
        ├── Checkout code
        ├── Setup Node 20
        ├── Install Supabase CLI
        ├── supabase start (local postgres + auth)
        ├── supabase db reset (migrations + seed)
        ├── npm ci (install deps)
        ├── ng build (verify build passes)
        ├── ng serve (start dev server, background)
        ├── npx playwright test (run E2E suite)
        ├── Upload test report artifact
        └── supabase stop (cleanup)
```

---

## Test Plan

### Test Suites & Coverage

Each suite covers a distinct feature area. Tests within a suite are ordered to follow natural user flows.

#### 1. `auth.spec.ts` -- Authentication Flow
- Unauthenticated user visiting `/` is redirected to `/login`
- Login page renders with Google sign-in button
- Authenticated user (injected session) can access protected routes
- Sign out clears session and redirects to `/login`

#### 2. `onboarding.spec.ts` -- Organization Setup
- New user with no tenants is redirected to `/onboarding`
- User can create a new organization (name input, submit, redirected to spaces)
- User can join an existing organization with invite code
- Invalid invite code shows error message

#### 3. `dashboard.spec.ts` -- Main Dashboard View
- Dashboard loads and renders trial timeline grid
- Company/product/therapeutic area filters narrow displayed trials
- Zoom control changes timeline granularity (yearly/quarterly/monthly)
- Clicking a trial row navigates to trial detail
- Legend displays marker types with correct shapes/colors
- Empty space triggers demo data seeding

#### 4. `company-management.spec.ts` -- Company CRUD
- Company list loads and displays companies in current space
- Create company via modal dialog (name validation, success toast)
- Edit company name via modal dialog
- Delete company (success when no products, error when products exist)

#### 5. `product-management.spec.ts` -- Product CRUD
- Product list loads with company names
- Create product via modal (select company, enter name + indication)
- Edit product via modal
- Delete product (success when no trials, error when trials exist)
- Expand product row to see associated trials

#### 6. `trial-management.spec.ts` -- Trial Detail + Nested CRUD
- Trial detail page loads with phases, markers, and notes sections
- Edit trial basic info (name, identifier, sponsor) and save
- Add a trial phase (start date, end date, type) via modal
- Edit a trial phase
- Delete a trial phase
- Add a trial marker (date, type, description) via modal
- Delete a trial marker
- Add a trial note via modal
- Delete a trial note
- CT.gov sync button populates fields from NCT ID (mocked API response)

#### 7. `marker-types.spec.ts` -- Marker Type CRUD
- Marker type list loads with color swatches
- Create marker type (name + color)
- Edit marker type
- Delete marker type

#### 8. `therapeutic-areas.spec.ts` -- Therapeutic Area CRUD
- Therapeutic area list loads
- Create therapeutic area
- Edit therapeutic area
- Delete therapeutic area (error when trials reference it)

#### 9. `navigation.spec.ts` -- Multi-tenant Navigation
- Header displays tenant and space dropdowns
- Switching spaces updates dashboard data
- Navigation tabs highlight active route
- Settings link navigates to tenant settings
- Back navigation preserves context

### What Is NOT Tested (by design)

- Google OAuth redirect flow (tested manually; CI uses admin-created sessions)
- PowerPoint export file contents (PPTX binary; tested manually)
- SVG pixel-perfect rendering (visual regression territory)
- Concurrent multi-user scenarios (not relevant for this app's usage pattern)

---

## File Structure

```
src/client/
  e2e/
    playwright.config.ts          -- Playwright configuration
    global-setup.ts               -- Create test user via Supabase Admin API
    global-teardown.ts            -- Cleanup test user
    helpers/
      auth.helper.ts              -- Session injection, authenticated page factory
      test-data.helper.ts         -- Tenant/space/entity creation helpers
    tests/
      auth.spec.ts
      onboarding.spec.ts
      dashboard.spec.ts
      company-management.spec.ts
      product-management.spec.ts
      trial-management.spec.ts
      marker-types.spec.ts
      therapeutic-areas.spec.ts
      navigation.spec.ts
  package.json                    -- Add playwright devDependency + test:e2e script
  angular.json                    -- No changes needed (Playwright runs standalone)
  tsconfig.e2e.json               -- TypeScript config for e2e tests
.github/
  workflows/
    ci.yml                        -- New CI workflow (lint + build + e2e)
.claude/
  settings.json                   -- Add Stop hook for running tests
```

---

## Tasks

```yaml
tasks:
  - id: T1
    title: Install Playwright and configure test infrastructure
    domain: frontend
    depends_on: []
    files:
      - src/client/package.json (modify - add @playwright/test devDependency, test:e2e script)
      - src/client/e2e/playwright.config.ts (create)
      - src/client/e2e/tsconfig.e2e.json (create)
      - src/client/.gitignore (modify - add playwright-report/, test-results/)
    verification: "cd src/client && npx playwright --version"
    notes: |
      Install @playwright/test and playwright browsers (chromium only for CI).
      Configure playwright.config.ts:
        - baseURL: http://localhost:4201
        - testDir: ./e2e/tests
        - globalSetup: ./e2e/global-setup.ts
        - globalTeardown: ./e2e/global-teardown.ts
        - retries: 1 in CI, 0 locally
        - reporter: html + list
        - webServer: { command: 'ng serve', port: 4201, reuseExistingServer: true }
        - projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
      Add tsconfig.e2e.json extending base tsconfig with e2e directory included.
      Add scripts: "test:e2e": "playwright test", "test:e2e:ui": "playwright test --ui"

  - id: T2
    title: Create auth helpers and global setup/teardown
    domain: frontend
    depends_on: [T1]
    files:
      - src/client/e2e/global-setup.ts (create)
      - src/client/e2e/global-teardown.ts (create)
      - src/client/e2e/helpers/auth.helper.ts (create)
      - src/client/e2e/helpers/test-data.helper.ts (create)
    verification: "cd src/client && npx tsc --noEmit -p e2e/tsconfig.e2e.json"
    notes: |
      global-setup.ts:
        - Use @supabase/supabase-js with service_role key to create test user
        - Email: e2e-test@clint.local, password: random
        - Store user ID + session tokens in a temp file for tests to read
      global-teardown.ts:
        - Delete the test user via admin API
        - Clean up temp file
      auth.helper.ts:
        - authenticatedPage(browser): creates a new page, injects Supabase session
          into localStorage, navigates to '/', waits for redirect to complete
        - Read session tokens from the temp file written by global-setup
      test-data.helper.ts:
        - createTestTenant(page, name): navigates to onboarding, creates org, returns tenantId
        - createTestSpace(page, tenantId, name): creates space, returns spaceId
        - navigateToSpace(page, tenantId, spaceId): navigates to /t/{tenantId}/s/{spaceId}
        - Supabase admin client for direct DB operations when needed

  - id: T3
    title: Write auth and onboarding E2E tests
    domain: frontend
    depends_on: [T2]
    files:
      - src/client/e2e/tests/auth.spec.ts (create)
      - src/client/e2e/tests/onboarding.spec.ts (create)
    verification: "cd src/client && npx playwright test auth onboarding --reporter=list"
    notes: |
      auth.spec.ts:
        - Test redirect to /login when unauthenticated
        - Test login page renders correctly
        - Test authenticated user can access dashboard
        - Test sign out flow
      onboarding.spec.ts:
        - Test redirect to /onboarding for user with no tenants
        - Test create organization flow
        - Test join organization with invite code
        - Test invalid invite code error

  - id: T4
    title: Write dashboard and navigation E2E tests
    domain: frontend
    depends_on: [T2]
    files:
      - src/client/e2e/tests/dashboard.spec.ts (create)
      - src/client/e2e/tests/navigation.spec.ts (create)
    verification: "cd src/client && npx playwright test dashboard navigation --reporter=list"
    notes: |
      dashboard.spec.ts:
        - Use seed demo data (already seeded by supabase db reset)
        - Test grid renders with trial rows
        - Test filter panel narrows results
        - Test zoom control changes timeline
        - Test clicking trial row navigates to detail
        - Test legend displays marker types
      navigation.spec.ts:
        - Test header tenant/space dropdowns
        - Test switching spaces
        - Test nav tab active states
        - Test settings link
      These tests use the pre-seeded demo data tenant/space.

  - id: T5
    title: Write CRUD management E2E tests
    domain: frontend
    depends_on: [T2]
    files:
      - src/client/e2e/tests/company-management.spec.ts (create)
      - src/client/e2e/tests/product-management.spec.ts (create)
      - src/client/e2e/tests/trial-management.spec.ts (create)
      - src/client/e2e/tests/marker-types.spec.ts (create)
      - src/client/e2e/tests/therapeutic-areas.spec.ts (create)
    verification: "cd src/client && npx playwright test company product trial marker therapeutic --reporter=list"
    notes: |
      Each test file:
        - beforeAll: create a dedicated test tenant + space via helpers
        - Tests follow create -> read -> update -> delete flow
        - afterAll: cleanup created entities
      trial-management.spec.ts also tests:
        - Nested phase/marker/note CRUD within trial detail
        - CT.gov sync (mock the fetch call via page.route() to return fixture data)
      Keep tests focused: one assertion per interaction, no redundant CRUD
      patterns across entity types (e.g., don't repeat identical modal-open/close
      validation for every entity -- test it once in company, skip in others).

  - id: T6
    title: Create GitHub Actions CI workflow
    domain: ci
    depends_on: [T1]
    files:
      - .github/workflows/ci.yml (create)
    verification: "cat .github/workflows/ci.yml && echo 'Workflow file created'"
    notes: |
      Workflow triggers: push to main, pull_request to main.
      Jobs:
        lint-and-build:
          - Checkout, setup Node 20
          - cd src/client && npm ci
          - ng lint
          - ng build
        e2e:
          - needs: lint-and-build
          - Checkout, setup Node 20
          - Install Supabase CLI (npx supabase --version or brew)
          - supabase start (uses supabase/config.toml, needs docker)
          - supabase db reset
          - cd src/client && npm ci
          - npx playwright install chromium --with-deps
          - npx playwright test
          - Upload playwright-report as artifact (always, even on failure)
          - supabase stop
      Environment variables needed:
        - SUPABASE_URL=http://127.0.0.1:54321
        - SUPABASE_ANON_KEY (from supabase status output)
        - SUPABASE_SERVICE_ROLE_KEY (from supabase status output, for test user creation)
      Use ubuntu-latest runner. Supabase CLI needs Docker, which is available on GitHub runners.

  - id: T7
    title: Add Claude Code hook to run tests after changes
    domain: config
    depends_on: [T1]
    files:
      - .claude/hooks/run-e2e-tests.sh (create)
      - .claude/settings.json (modify - add Stop hook)
    verification: "cat .claude/hooks/run-e2e-tests.sh && cat .claude/settings.json"
    notes: |
      Create run-e2e-tests.sh:
        - Check if Supabase is running (supabase status), skip if not
        - Check if Angular dev server is running (curl localhost:4201), skip if not
        - Run: cd src/client && npx playwright test --reporter=list
        - Exit 0 even on failure (hook should warn, not block)
      Add to settings.json Stop hooks array:
        - type: command
        - command: run-e2e-tests.sh
        - timeout: 120 (2 min)
        - statusMessage: "Running E2E tests..."
      This hook runs after Claude finishes making changes, giving early
      regression feedback. It's advisory (doesn't block), since CI is the gate.
```

---

## Verification

After all tasks are complete:

```bash
# Full local verification
cd src/client && ng lint && ng build
supabase start && supabase db reset
cd src/client && npx playwright test --reporter=list
supabase stop

# Verify CI workflow syntax
act -l  # or push to a branch and check GitHub Actions
```

## Open Questions

None -- all decisions resolved during clarification.
