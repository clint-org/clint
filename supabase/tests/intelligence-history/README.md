# intelligence-history SQL tests

Integration tests for the version-history schema, triggers, and RPCs introduced in:
- `20260509130000_intelligence_history_schema.sql`
- `20260509130050_intelligence_history_rls.sql`
- `20260509130100_intelligence_history_rpcs.sql`

## Running

```bash
./supabase/tests/intelligence-history/run.sh
```

Or individually:

```bash
docker exec -i supabase_db_clint-v2 \
  psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/intelligence-history/01_state_machine_guard.sql
```

## Seed data requirement

These tests pick a real entity (company, product, or marker) from a tenant that has an agency with members, then impersonate that agency member to exercise the RPCs. When the local DB has not been seeded with demo data, each test prints:

```
NOTICE:  no seed data; skipping
DO
```

and exits without running its assertions. This is intentional: the tests should not hard-fail in a fresh checkout. To exercise them locally, seed the demo data first via the dashboard's `/seed-demo` URL or the `seed_demo_data()` RPC, then re-run.

After a `supabase db reset` (which clears all data), the seed.sql only loads master data (marker types, event categories). Per-space pharma demo data is loaded on demand by an authenticated agency member.

## What each test asserts

| File | Asserts |
|---|---|
| `01_state_machine_guard.sql` | Guard trigger rejects `published -> draft` and any transition out of archived/withdrawn |
| `02_version_stamping.sql` | `version_number` and `published_at` are stamped on entry into published; in-place edit does not re-stamp |
| `03_archive_on_republish.sql` | `upsert_primary_intelligence` archives the prior published row instead of deleting it |
| `04_change_note_required.sql` | Republish without `change_note` raises when a prior version exists; first publish is exempt |
| `05_withdraw.sql` | `withdraw_primary_intelligence` only transitions `published -> withdrawn`; requires non-empty change_note; rejects double-withdraw |
| `06_purge.sql` | `purge_primary_intelligence` requires exact headline confirmation; `p_purge_anchor=true` cascades all rows for the anchor |
| `07_history_payload.sql` | `get_primary_intelligence_history` returns `{current, draft, versions[]}` with versions ordered `version_number desc` |

## Test patterns

Each test follows the same shape:

1. Pick an agency-linked entity and an agency-member user.
2. Add the user to `space_members` (editor) if not already, so SELECT RLS permits reading the rows back. Track this with `v_added_membership` so cleanup can remove it.
3. Impersonate as `authenticated` via `set_config('request.jwt.claims', ...)` and `set_config('role', 'authenticated', ...)`.
4. Exercise the RPCs.
5. Clean up created `primary_intelligence` rows.
6. If we added the space membership, switch back to `postgres`, flip `clint.member_guard_cascade='on'` to bypass the self-protection trigger, and delete the temporary `space_members` row.
