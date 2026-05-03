# Trial Change Feed — Test Script

Branch under test: `feat/trial-change-feed` (43 commits ahead of `main`).

This is a manual + automated test plan covering everything shipped in Phases 1–10. Work top to bottom; later sections depend on earlier ones being green. Time budget: ~45 min if no surprises.

---

## 0. Setup (5 min)

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
git fetch
git checkout feat/trial-change-feed
git status      # expect clean
git log --oneline main..HEAD | wc -l   # expect 43

# Reset Supabase to apply every migration including the destructive Phase 7 drop
supabase stop || true
supabase start
supabase db reset
```

**Expected during `db reset`** — every smoke notice ends in `PASS`:

```
NOTICE: trial change feed tables smoke test: PASS
NOTICE: ctgov worker secret smoke test: PASS
NOTICE: ctgov helper functions smoke test: PASS
NOTICE: ingest_ctgov_snapshot smoke test: PASS
NOTICE: polling rpcs smoke test: PASS
NOTICE: markers audit trigger + classifier smoke test: PASS
NOTICE: surface rpcs smoke test: PASS
NOTICE: dashboard change counts smoke test: PASS
NOTICE: get_latest_sync_run smoke test: PASS
NOTICE: orphaned trial columns cleanup smoke test: PASS
```

If any line says `FAIL` or `ERROR`, stop and read the migration's smoke block.

---

## 1. Static gates (3 min)

```bash
cd src/client
ng lint                  # expect: All files pass linting.
ng build                 # expect: Application bundle generation complete.
npm run test:worker      # expect: Test Files 8 passed, Tests 64 passed
```

If any of these fail, the branch is not ready.

---

## 2. Schema sanity (2 min)

```bash
PGURL='postgresql://postgres:postgres@localhost:54322/postgres'

# All 5 new tables exist with RLS
psql "$PGURL" -c "select tablename, rowsecurity from pg_tables where tablename in ('trial_ctgov_snapshots','trial_field_changes','trial_change_events','marker_changes','ctgov_sync_runs');"

# trials has watermark trio + materialized 3
psql "$PGURL" -c "select column_name from information_schema.columns where table_schema='public' and table_name='trials' order by column_name;" | grep -E "phase|recruitment_status|study_type|last_update_posted_date|latest_ctgov_version|last_polled_at|ctgov_last_synced_at"

# a representative subset of the 36 dropped columns is GONE
psql "$PGURL" -c "select column_name from information_schema.columns where table_schema='public' and table_name='trials' and column_name in ('lead_sponsor','sponsor_type','sample_size','conditions','start_date','primary_completion_date','has_dmc');"
# expect: zero rows

# 17 RPCs in place (worker-side + user-side)
psql "$PGURL" -c "select proname from pg_proc where proname in ('_verify_ctgov_worker_secret','_materialize_trial_from_snapshot','_compute_field_diffs','_classify_change','_emit_events_from_marker_change','ingest_ctgov_snapshot','get_trials_for_polling','record_sync_run','bulk_update_last_polled','get_activity_feed','get_trial_activity','get_marker_history','trigger_single_trial_sync','update_space_field_visibility','recompute_trial_change_events','get_latest_sync_run','backfill_marker_history') order by proname;"
# expect: 17 rows

# Markers BEFORE trigger is installed
psql "$PGURL" -c "select tgname, tgtype from pg_trigger where tgname='markers_audit';"
# expect: tgtype with BEFORE bit (decimal 31, hex 0x1F)
```

---

## 3. Worker pipeline end-to-end (10 min)

In one terminal:

```bash
cd src/client
# Worker needs three things in .dev.vars: the worker secret, plus the local
# Supabase REST URL and anon key (otherwise the poller logs
# "Invalid URL: undefined/rest/v1/rpc/get_trials_for_polling"). Pull the anon
# key from `supabase status -o env`. .dev.vars is gitignored.
cat > .dev.vars <<'VARS'
CTGOV_WORKER_SECRET = "local-dev-ctgov-secret"
SUPABASE_URL = "http://127.0.0.1:54321"
SUPABASE_ANON_KEY = "<paste ANON_KEY from `supabase status -o env`>"
VARS
wrangler dev --test-scheduled --port 8787
```

In a second terminal — sign in to the running app at least once so the gated
seed (`seed_demo_data`) populates a tenant, space, products, and therapeutic
areas. Then attach a real NCT-bearing trial:

```bash
PGURL='postgresql://postgres:postgres@localhost:54322/postgres'

# get the first seeded space + product + therapeutic area to attach the trial to
SPACE_ID=$(psql "$PGURL" -tAc "select id from public.spaces limit 1;")
PRODUCT_ID=$(psql "$PGURL" -tAc "select id from public.products where space_id='$SPACE_ID' limit 1;")
TA_ID=$(psql "$PGURL" -tAc "select id from public.therapeutic_areas where space_id='$SPACE_ID' limit 1;")

# pick a real, currently-recruiting NCT (any phase 3 with frequent updates works)
NCT='NCT04832594'

psql "$PGURL" <<SQL
insert into public.trials (space_id, created_by, product_id, therapeutic_area_id, name, identifier)
select '$SPACE_ID', (select created_by from public.products where id='$PRODUCT_ID'), '$PRODUCT_ID', '$TA_ID', 'Test trial $NCT', '$NCT'
returning id, identifier;
SQL
```

Trigger the cron:

```bash
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"
```

**Expected wrangler logs** include lines from `runScheduledSync`. After ~10s, query results:

```bash
psql "$PGURL" -c "select status, trials_checked, ncts_with_changes, snapshots_written, events_emitted from public.ctgov_sync_runs order by started_at desc limit 1;"
# expect: status='success', trials_checked >= 1, snapshots_written >= 1 (first poll)

psql "$PGURL" -c "select trial_id, ctgov_version, last_update_post_date, fetched_via from public.trial_ctgov_snapshots order by fetched_at desc limit 5;"
# expect: at least one row with the seeded NCT

psql "$PGURL" -c "select last_polled_at, latest_ctgov_version, last_update_posted_date from public.trials where identifier='$NCT';"
# expect: all three columns now populated
```

Trigger the cron a second time:

```bash
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"
```

```bash
psql "$PGURL" -c "select snapshots_written, events_emitted from public.ctgov_sync_runs order by started_at desc limit 1;"
# expect: snapshots_written=0 (idempotent — same version, ON CONFLICT DO NOTHING)
```

**Manual backfill endpoint** — needs a platform-admin JWT. Easiest path: sign in as a platform admin in the running app (Section 4), grab the access token from devtools, then:

```bash
TOKEN='<paste access_token from a platform-admin session>'
curl -X POST http://localhost:8787/admin/ctgov-backfill \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"nct_ids":["'"$NCT"'"]}'
# expect: 200 + run summary jsonb. status should be 'success' or 'partial'.
```

```bash
curl -X POST http://localhost:8787/admin/ctgov-backfill -d '{}'
# expect: 401 unauthorized (no Authorization header)

curl -X POST http://localhost:8787/admin/ctgov-backfill \
  -H "Authorization: Bearer $TOKEN" -d '{}'
# expect: 400 nct_ids_required
```

---

## 4. UI walkthrough (20 min)

```bash
# in the same shell, with supabase + wrangler dev still running:
cd src/client
ng serve --port 8000
```

Open `http://localhost:8000`, sign in, pick a tenant + space.

### 4.1 Engagement landing — what-changed widget

- The page renders without console errors.
- Above "Latest from Stout" you see a **What changed** card.
- Either it lists up to 5 high-signal events from the last 7 days, OR (more likely on a fresh stack) it shows "No notable changes in the past 7 days."
- "View all" link goes to `/t/<tenant>/s/<space>/activity`.

### 4.2 Latest from Stout — system updates mixing

- After Section 3 ran the cron (and emitted at least one event), reload the engagement landing.
- The "Latest from Stout" feed should now interleave intelligence rows with rows labeled **SYSTEM UPDATE** in mono uppercase, smaller font, slate left accent bar.
- If the seed has no published intelligence yet, the feed may show only system updates — that's fine.

### 4.3 Activity page

- Navigate directly: `/t/<tenant>/s/<space>/activity`.
- Filter pills: Date range (Last 7 days / Last 30 days / All time, default 30d), Event type multi-select, Source (All / CT.gov / Analyst), Trial multi-select.
- Each row shows: source badge (CT.GOV / ANALYST), timestamp, trial NCT or name, event summary, "Show details" button.
- Click "Show details" — payload renders as JSON `<pre>`.
- Footer: `Last sync: Xh ago · 1 trial(s) checked · X change(s) detected` (or "No sync runs yet" if empty).
- Filter test: pick "CT.gov" — only rows with CT.GOV badge remain. Pick "All" — full list returns.

### 4.4 Trial row badges

- Open a Bullseye view (e.g. `/landscape/by-therapy-area/<id>`).
- Trial rows that had changes in the last 7d show a **slate dot** next to the name. If a date_moved / phase_transitioned / trial_withdrawn happened, the dot is **red**.
- Same dot appears in Key Catalysts list and in the Bullseye detail panel's trial list.
- Hover the dot — tooltip reads `N change(s) in last 7 days`.

### 4.5 Trial-detail rework

Pick a trial that was synced in Section 3:
`/t/<tenant>/s/<space>/manage/trials/<trialId>`

- **Header**: trial name + NCT identifier as before.
- **No more "Edit trial" topbar action.** Confirmed retired.
- **CT.gov data** section:
  - Phase / Recruitment status / Study type rows populated from the materialized columns.
  - Below those, the configured extra fields render via the renderer (Lead sponsor, Primary completion date by default).
  - "Sync from CT.gov" button (visible to space owner/editor). Click it — toast says "Sync from CT.gov queued.", trial reloads, snapshot timestamp updates to "just now".
  - "Show all CT.gov data" button — opens a modal listing the full ~62-entry catalogue rendered against the latest snapshot. Read-only; no save action.
- **Markers / catalysts** section unchanged from before.
- **Activity** section at the bottom: most recent events for this trial via change-event-row. Empty state on a fresh trial reads "No activity yet."

### 4.6 Markers audit + history panel

- Pick any trial with a marker; click a marker to open the marker detail panel.
- Scroll to the **History** section (collapsed by default). Expand it.
- A "Created" row appears (synthesized by `backfill_marker_history()` on initial deploy) with timestamp + author email.
- Edit the marker (change event_date by 30 days).
- Reload / re-expand History — a new "Updated" row appears, dated now.
- Click a row — old/new values render side-by-side as JSON.
- Navigate back to Activity page — a `date_moved` event with `source=ANALYST` appears for the same marker.

### 4.7 Trial-create dialog

- Go to `/t/<tenant>/s/<space>/manage/trials`.
- Click **Add trial** in the topbar (or per-page primary action).
- Dialog opens with: Name (required), NCT identifier (optional), Product (required dropdown), Therapeutic area (required dropdown).
- Try Save with Name empty — Save button is disabled.
- Try entering identifier `NCT123` — Save remains disabled (validation requires `NCT\d{8}` if provided).
- Fill a real test trial: Name "QA Test Trial", NCT `NCT04832594`, Product + TA from existing seed.
- Submit — dialog closes, you land on `/manage/trials/<newId>`. Toast says "Trial created."
- Within ~10s a snapshot appears for the new trial (Sync from CT.gov was kicked off in the background).

### 4.8 Per-space field visibility

- Sign in as a space **owner** (other roles will see read-only).
- Navigate to `/t/<tenant>/s/<space>/settings/fields` (also reachable from the sidebar's Settings → **Fields**).
- 5 tabs: Trial detail / Bullseye detail / Timeline detail / Key catalysts / Trial list.
- On the Trial detail tab: drag "Conditions" (or any field) from Available → Visible. Drag to reorder within Visible.
- Save button enables on first change. Click it — toast confirms save.
- Open a trial-detail page in another tab — the new field now renders in the CT.gov data section.
- As a non-owner (space editor or viewer): the page renders read-only; Save is disabled with the helper text "Only space owners can save changes."

---

## 5. Edge cases + regressions (5 min)

- **Trial without an NCT**: open one. Trial-detail still renders cleanly. CT.gov data block shows "(not set)" rows; "Show all CT.gov data" button is hidden (no snapshot to render). "Sync from CT.gov" still appears but click does nothing user-visible (the RPC returns `{ok: false, reason: 'no_nct_id'}`).
- **Dropped columns**: open every Bullseye, Timeline, Catalysts view. No "n=Sample size" line should appear anywhere. No console errors about missing properties.
- **Routes that used to point to trial-form**: navigate to `/manage/trials` and use Edit on a row — should route to trial-detail (no modal pops up, no broken URL).
- **Worker secret rotation drill** (optional, paranoid): in psql do `update vault.secrets set secret = 'rotated-secret-' || gen_random_uuid()::text where name = 'ctgov_worker_secret';` then trigger the cron — expect `status='failed'` with `unauthorized` in the error_summary. Reset: `update vault.secrets set secret = 'local-dev-ctgov-secret' where name = 'ctgov_worker_secret';`.

---

## 6. Documentation spot-check (2 min)

```bash
# all hand-written runbook updates committed
grep -l "trial change feed\|trial-change-feed\|change feed" docs/runbook/*.md

# auto-gen blocks deterministic
cd src/client
npm run docs:arch
git diff --exit-code docs/runbook/   # expect: clean (no diff)
```

---

## 7. Accept criteria

The branch is ready to merge when ALL of the following hold:

- Section 0: every smoke test PASSes on `supabase db reset`.
- Section 1: lint, build, worker tests all green.
- Section 2: 5 new tables present, 17 RPCs present, 36 columns gone, BEFORE trigger installed.
- Section 3: cron writes a snapshot on first run, no-ops on second run, manual backfill endpoint correctly rejects unauthorized + missing-payload requests.
- Section 4: every UI sub-section renders without console errors and the listed behaviors match.
- Section 5: edge cases don't surface regressions.
- Section 6: runbook is current and `docs:arch` is deterministic.

---

## If something fails

- **A smoke test fails on `db reset`**: read the failing migration's `do $$` block; the `raise exception` message tells you which assertion broke.
- **`ng build` fails**: usually a model trim that left a consumer dangling. `grep -rn "<missing field>" src/client/src/app/`.
- **Worker test fails**: `cd src/client && npx vitest run --config worker/vitest.config.mts <spec file>` to focus on one file.
- **Cron does nothing**: confirm `wrangler dev --test-scheduled` is running; confirm a trial with `identifier IS NOT NULL` exists; check `select last_polled_at, latest_ctgov_version from public.trials where identifier is not null;`.
- **Manual backfill returns 403**: the JWT in your Authorization header isn't a platform admin. `select * from public.platform_admins;` and add the test user with `insert into public.platform_admins (user_id) values ('<your auth.users.id>');`.
- **UI surface looks wrong**: open devtools → console; most issues will be visible network errors or signal-resolution warnings. The most common error is "Cannot read property 'X' of null" when a snapshot hasn't been pulled yet — Section 3 must complete first.

---

## Branch artifacts (for reference)

- Plan: `docs/superpowers/plans/2026-05-02-trial-change-feed.md`
- Spec: `docs/superpowers/specs/2026-05-02-trial-change-feed-design.md`
- 14 new SQL migrations: `supabase/migrations/2026050212*` and `20260502122000_drop_orphaned_trial_columns.sql`
- Worker pipeline: `src/client/worker/ctgov-sync/`
- Worker tests: `src/client/worker/test/ctgov-sync/`
- New Angular routes: `/activity`, `/settings/fields`
- New components: change-event-row, change-badge, what-changed-widget, ctgov-field-renderer, ctgov-field-picker, trial-create-dialog, engagement-activity-page, space-field-visibility-settings
- New services: change-event.service, space-field-visibility.service
- Retired: trial-form.component, ctgov-sync.service, 36 trials columns, sample_size displays
