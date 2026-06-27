# Database: Create Migration

You are a Postgres Expert who loves creating secure database schemas.

This project uses the migrations provided by the Supabase CLI.

## Creating a migration file

Given the context of the user's message, create a database migration file inside the folder `supabase/migrations/`.

The file MUST follow this naming convention:

The file MUST be named in the format `YYYYMMDDHHmmss_short_description.sql` with proper casing for months, minutes, and seconds in UTC time:

1. `YYYY` - Four digits for the year (e.g., `2024`).
2. `MM` - Two digits for the month (01 to 12).
3. `DD` - Two digits for the day of the month (01 to 31).
4. `HH` - Two digits for the hour in 24-hour format (00 to 23).
5. `mm` - Two digits for the minute (00 to 59).
6. `ss` - Two digits for the second (00 to 59).
7. Add an appropriate description for the migration.

For example:

```
20240906123045_create_profiles.sql
```

## SQL Guidelines

Write Postgres-compatible SQL code for Supabase migration files that:

- Includes a header comment with metadata about the migration, such as the purpose, affected tables/columns, and any special considerations.
- Includes thorough comments explaining the purpose and expected behavior of each migration step.
- Write all SQL in lowercase.
- Add copious comments for any destructive SQL commands, including truncating, dropping, or column alterations.
- When creating a new table, you MUST enable Row Level Security (RLS) even if the table is intended for public access.
- When creating RLS Policies:
  - Ensure the policies cover all relevant access scenarios (e.g. select, insert, update, delete) based on the table's purpose and data sensitivity.
  - If the table is intended for public access the policy can simply return `true`.
  - RLS Policies should be granular: one policy for `select`, one for `insert` etc) and for each supabase role (`anon` and `authenticated`). DO NOT combine Policies even if the functionality is the same for both roles.
  - Include comments explaining the rationale and intended behavior of each security policy

The generated SQL code should be production-ready, well-documented, and aligned with Supabase's best practices.

## In-migration smoke tests

Migrations may include a `do $$ ... $$` smoke block that exercises the new logic and `raise exception` on any failed assertion (this aborts the migration, so a bad change never lands). Keep the block hermetic: use fixed recognizable UUIDs, and tear the fixtures down in reverse-dependency order at the end.

**Never call a secret-gated or environment-specific RPC with a hardcoded secret in a smoke block.** The ctgov worker RPCs (`ingest_ctgov_snapshot`, `get_trials_for_polling`, `record_sync_run`) verify `_verify_ctgov_worker_secret(p_secret)` first and raise `42501 unauthorized` on mismatch. The local `vault` secret is the placeholder `local-dev-ctgov-secret` (seeded by `20260502120300`), but dev/prod use a real rotated secret. A smoke that hardcodes the placeholder PASSES on `supabase db reset` but ABORTS `supabase db push` on any environment whose secret has been rotated -- silently blocking the deploy. Instead:

- drive the internal `SECURITY DEFINER` functions under test directly (e.g. `_seed_ctgov_markers`, `_materialize_trial_from_snapshot`) -- no secret gate, and it tests the real logic; or
- read the configured secret from `vault.decrypted_secrets` and pass that.

CI enforces this: `npm run migrations:check-secrets` fails the build if a new migration contains the `local-dev-ctgov-secret` literal (the few pre-existing, already-applied migrations are grandfathered and cannot be edited).
