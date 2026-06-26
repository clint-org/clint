/**
 * Persona-fixture teardown regression guard.
 *
 * The persona wipe sweeps space/tenant/agency-scoped rows and then deletes the
 * auth.users rows. A who-did-this stamp on a GLOBAL (un-scoped) table breaks
 * that teardown: there is no space or tenant to cascade through, so the row
 * survives the wipe and its FK to auth.users blocks the user delete. GoTrue
 * then reports "Database error deleting user", the persona survives, and the
 * next suite's createUser fails with "already registered" -- cascading every
 * downstream integration suite to red.
 *
 * `ai_model_pricing.updated_by` was the offender: a platform admin who edited
 * model pricing stamped a global pricing row that the wipe could not reach.
 * The fix aligns it with the who-did-this convention used by
 * audit_events.actor_user_id / mechanisms_of_action.created_by /
 * routes_of_administration.created_by: ON DELETE SET NULL.
 *
 * This test reproduces the FK block by stamping the global row and then
 * attempting the auth.users delete inside a rolled-back transaction (so the
 * shared fixture stays intact for later suites). Before the fix the delete
 * raises a foreign_key_violation; after it, the stamp is nulled and the delete
 * succeeds.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { Client as PgClient } from 'pg';
import { buildPersonas, Personas } from '../fixtures/personas';
import { as } from '../harness/as';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;

beforeAll(async () => {
  p = await buildPersonas();
}, 120_000);

describe('persona teardown is not FK-blocked by global stamp tables', () => {
  it('a platform admin who edited ai_model_pricing can still be deleted', async () => {
    // Stamp updated_by on a GLOBAL pricing row (no space/tenant scope).
    const stamp = await as(p, 'platform_admin').rpc('platform_admin_upsert_ai_model_pricing', {
      p_model_id: 'claude-sonnet-4-6',
      p_reason: 'teardown regression guard',
      p_input_cents_per_mtok: 300,
    });
    expect(stamp.error).toBeNull();

    // Deleting the auth.users row must not trip ai_model_pricing_updated_by_fkey.
    // Roll the delete back so the shared persona fixture survives for later suites.
    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    await pg.connect();
    try {
      await pg.query('begin');
      await pg.query('delete from auth.users where id = $1', [p.ids.platform_admin]);
      await pg.query('rollback');
    } finally {
      await pg.end();
    }
  });
});
