/**
 * event-admin-cleanup-backtest.spec.ts
 *
 * Phase D definition-of-done gate: three destructive paths leave no orphaned
 * event-family rows AND record their Tier-1 audit events.
 *
 *   Test 1 -- permanently_delete_space (as platform_admin, no archive required)
 *             removes all event-family rows for the space and records a
 *             space.deleted audit event.
 *
 *   Test 2 -- direct pg DELETE on a trial (_cleanup_polymorphic_refs trigger)
 *             removes only that trial's anchored events and their event_sources;
 *             sibling events anchored to other entities survive.
 *
 *   Test 3 -- redact_user preserves event authorship (created_by stays set to
 *             the redacted user's id) and records a compliance.user_pii_redacted
 *             audit event.
 *
 * Uses seed_events_model_qa as the seeding backbone (same fixture as
 * A9/B4/C6). Models imports, persona/scratch usage, and pg-client pattern on
 * rpc-cascade-safety.spec.ts and rpc-redaction.spec.ts.
 */

import { afterAll, beforeAll, describe, it } from 'vitest';
import { buildPersonas, Personas, adminClient, createAuthUser } from '../fixtures/personas';
import { createScratchSpace } from '../fixtures/scratch';
import { as, expectOk } from '../harness/as';
import { SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import { randomUUID } from 'node:crypto';

const SUPABASE_DB_URL =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let p: Personas;
let svc: SupabaseClient;

beforeAll(async () => {
  p = await buildPersonas();
  svc = adminClient();
}, 90_000);

// ---------------------------------------------------------------------------
// Test 1: space delete leaves no event-family orphans + audit recorded
// ---------------------------------------------------------------------------

describe('permanently_delete_space leaves no event-family orphans + audit', () => {
  it(
    'space delete removes all event-family rows and records space.deleted audit',
    async () => {
      const scratch = await createScratchSpace(p);

      // Seed via the canonical QA fixture. createScratchSpace calls create_space
      // as tenant_owner, which auto-inserts a space_members.owner row for that
      // persona. The fixture gate (space_members.owner OR platform_admin) passes.
      await expectOk(
        await as(p, 'tenant_owner').rpc('seed_events_model_qa', {
          p_space_id: scratch.spaceId,
        }),
      );

      const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
      let preEventIds: string[] = [];
      let prePiIds: string[] = [];

      try {
        await pg.connect();

        // Capture ids needed for post-delete lookups (space_id FK is gone after delete).
        const evtIdRes = await pg.query<{ id: string }>(
          `select id from public.events where space_id = $1`,
          [scratch.spaceId],
        );
        preEventIds = evtIdRes.rows.map((r) => r.id);

        const piIdRes = await pg.query<{ id: string }>(
          `select id from public.primary_intelligence where space_id = $1`,
          [scratch.spaceId],
        );
        prePiIds = piIdRes.rows.map((r) => r.id);

        // ---- PRE-DELETE snapshot: every count > 0 proves non-vacuousness ----

        const evtCount = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.events where space_id = $1`,
          [scratch.spaceId],
        );
        if (parseInt(evtCount.rows[0].count, 10) === 0) {
          throw new Error(
            `pre-delete: expected events > 0 for space ${scratch.spaceId}, got 0`,
          );
        }

        const ecCount = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.event_changes where space_id = $1`,
          [scratch.spaceId],
        );
        if (parseInt(ecCount.rows[0].count, 10) === 0) {
          throw new Error(
            `pre-delete: expected event_changes > 0 for space ${scratch.spaceId}, got 0`,
          );
        }

        const esCount = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.event_sources
           where event_id = any($1::uuid[])`,
          [preEventIds],
        );
        if (parseInt(esCount.rows[0].count, 10) === 0) {
          throw new Error(
            `pre-delete: expected event_sources > 0 for seeded events, got 0`,
          );
        }

        const pilCount = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.primary_intelligence_links
           where primary_intelligence_id = any($1::uuid[])`,
          [prePiIds.length > 0 ? prePiIds : ['00000000-0000-0000-0000-000000000000']],
        );
        if (parseInt(pilCount.rows[0].count, 10) === 0) {
          throw new Error(
            `pre-delete: expected primary_intelligence_links > 0 for seeded PI rows, got 0`,
          );
        }

        // Insert ONE trial_change_events row so the cascade assertion is non-vacuous.
        // The fixture seeds exactly 1 trial; pick its id.
        // trial_change_events.space_id -> spaces(id) ON DELETE CASCADE, so the
        // row is swept when the space is deleted.
        const trialRes = await pg.query<{ id: string }>(
          `select id from public.trials where space_id = $1 limit 1`,
          [scratch.spaceId],
        );
        if (trialRes.rows.length > 0) {
          const trialId = trialRes.rows[0].id;
          await pg.query(
            `insert into public.trial_change_events
               (trial_id, space_id, event_type, source, payload, occurred_at)
             values ($1, $2, 'status_change', 'system', '{}', now())`,
            [trialId, scratch.spaceId],
          );
        }

        const tceCount = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.trial_change_events
           where space_id = $1`,
          [scratch.spaceId],
        );
        if (parseInt(tceCount.rows[0].count, 10) === 0) {
          throw new Error(
            `pre-delete: expected trial_change_events >= 1 for space ${scratch.spaceId}, got 0`,
          );
        }
      } finally {
        await pg.end();
      }

      // ---- DELETE via platform_admin (bypasses the archive gate) ----
      await expectOk(
        await as(p, 'platform_admin').rpc('permanently_delete_space', {
          p_space_id: scratch.spaceId,
        }),
      );

      // ---- POST-DELETE: assert all event-family rows are gone ----
      const pgCheck = new PgClient({ connectionString: SUPABASE_DB_URL });
      try {
        await pgCheck.connect();

        // events: space_id FK cascades via explicitly deleting events before the space.
        const postEvt = await pgCheck.query<{ count: string }>(
          `select count(*)::text as count from public.events where space_id = $1`,
          [scratch.spaceId],
        );
        if (postEvt.rows[0].count !== '0') {
          throw new Error(
            `post-delete: events not cleaned: ${postEvt.rows[0].count} row(s) remain for space ${scratch.spaceId}`,
          );
        }

        // event_changes: space_id -> spaces ON DELETE CASCADE.
        const postEc = await pgCheck.query<{ count: string }>(
          `select count(*)::text as count from public.event_changes where space_id = $1`,
          [scratch.spaceId],
        );
        if (postEc.rows[0].count !== '0') {
          throw new Error(
            `post-delete: event_changes not cleaned: ${postEc.rows[0].count} row(s) remain for space ${scratch.spaceId}`,
          );
        }

        // event_sources: event_id -> events ON DELETE CASCADE. Query by captured ids.
        if (preEventIds.length > 0) {
          const postEs = await pgCheck.query<{ count: string }>(
            `select count(*)::text as count from public.event_sources
             where event_id = any($1::uuid[])`,
            [preEventIds],
          );
          if (postEs.rows[0].count !== '0') {
            throw new Error(
              `post-delete: event_sources not cleaned: ${postEs.rows[0].count} row(s) remain for pre-delete event ids`,
            );
          }
        }

        // primary_intelligence_links: cascades via PI -> anchor -> space.
        if (prePiIds.length > 0) {
          const postPil = await pgCheck.query<{ count: string }>(
            `select count(*)::text as count from public.primary_intelligence_links
             where primary_intelligence_id = any($1::uuid[])`,
            [prePiIds],
          );
          if (postPil.rows[0].count !== '0') {
            throw new Error(
              `post-delete: primary_intelligence_links not cleaned: ${postPil.rows[0].count} row(s) remain`,
            );
          }
        }

        // trial_change_events: space_id -> spaces ON DELETE CASCADE.
        const postTce = await pgCheck.query<{ count: string }>(
          `select count(*)::text as count from public.trial_change_events
           where space_id = $1`,
          [scratch.spaceId],
        );
        if (postTce.rows[0].count !== '0') {
          throw new Error(
            `post-delete: trial_change_events not cleaned: ${postTce.rows[0].count} row(s) remain for space ${scratch.spaceId}`,
          );
        }
      } finally {
        await pgCheck.end();
      }

      // ---- AUDIT: space.deleted row with resource_id = spaceId ----
      // audit_events.space_id is SET NULL on space delete; query by resource_id.
      const { data: auditRows, error: auditErr } = await svc
        .from('audit_events')
        .select('action, resource_id, source')
        .eq('action', 'space.deleted')
        .eq('resource_id', scratch.spaceId)
        .limit(1);
      if (auditErr) {
        throw new Error(`query space.deleted audit row: ${auditErr.message}`);
      }
      if (!auditRows || auditRows.length === 0) {
        throw new Error(
          `expected a space.deleted audit row with resource_id=${scratch.spaceId}, found none`,
        );
      }
      const auditRow = auditRows[0] as Record<string, unknown>;
      if (auditRow['source'] !== 'rpc') {
        throw new Error(`expected audit source='rpc', got '${auditRow['source']}'`);
      }

      // cleanup is a no-op (space already deleted); call it so the pattern stays consistent.
      await scratch.cleanup().catch(() => { /* space already gone -- idempotent */ });
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// Test 2: entity delete (_cleanup_polymorphic_refs) removes anchored events
// ---------------------------------------------------------------------------

describe('entity delete via _cleanup_polymorphic_refs removes anchored events', () => {
  it(
    'trial delete removes its anchored events and event_sources; sibling events survive',
    async () => {
      const scratch = await createScratchSpace(p);

      await expectOk(
        await as(p, 'tenant_owner').rpc('seed_events_model_qa', {
          p_space_id: scratch.spaceId,
        }),
      );

      const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
      try {
        await pg.connect();

        // Pick the fixture trial (seed_events_model_qa inserts exactly 1 trial).
        const trialRes = await pg.query<{ id: string }>(
          `select id from public.trials where space_id = $1 limit 1`,
          [scratch.spaceId],
        );
        if (trialRes.rows.length === 0) {
          throw new Error(
            `expected a seeded trial in scratch space ${scratch.spaceId}, found none`,
          );
        }
        const trialId = trialRes.rows[0].id;

        // Capture event ids anchored to the trial.
        const anchoredRes = await pg.query<{ id: string }>(
          `select id from public.events where anchor_type = 'trial' and anchor_id = $1`,
          [trialId],
        );
        const trialEventIds = anchoredRes.rows.map((r) => r.id);
        if (trialEventIds.length === 0) {
          throw new Error(
            `expected trial-anchored events in the fixture, found none for trial ${trialId}`,
          );
        }

        // Total events in the space before the delete (denominator for sibling check).
        const totalRes = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.events where space_id = $1`,
          [scratch.spaceId],
        );
        const totalBefore = parseInt(totalRes.rows[0].count, 10);
        if (totalBefore <= trialEventIds.length) {
          throw new Error(
            `expected more events in space than those anchored to the trial alone ` +
              `(total=${totalBefore}, trial-anchored=${trialEventIds.length})`,
          );
        }

        // Delete the trial. trial_assets cascades ON DELETE CASCADE so no FK blocks
        // the raw delete. _cleanup_polymorphic_refs fires AFTER DELETE and removes
        // events with anchor_type='trial' and anchor_id=trialId; event_sources
        // cascade from those event deletes.
        await pg.query(`delete from public.trials where id = $1`, [trialId]);

        // Post-delete: the trial's anchored events must be gone.
        const postEvt = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.events where id = any($1::uuid[])`,
          [trialEventIds],
        );
        if (postEvt.rows[0].count !== '0') {
          throw new Error(
            `entity delete: ${postEvt.rows[0].count} trial-anchored event(s) remain after trial delete`,
          );
        }

        // Post-delete: event_sources for those events must be gone.
        const postEs = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.event_sources
           where event_id = any($1::uuid[])`,
          [trialEventIds],
        );
        if (postEs.rows[0].count !== '0') {
          throw new Error(
            `entity delete: ${postEs.rows[0].count} event_sources remain for deleted trial events`,
          );
        }

        // Post-delete: sibling events (asset- or company-anchored) must survive.
        // The fixture seeds 4 asset-anchored + 2 company-anchored events (6 total).
        const siblingRes = await pg.query<{ count: string }>(
          `select count(*)::text as count from public.events
           where space_id = $1 and not (anchor_type = 'trial' and anchor_id = $2)`,
          [scratch.spaceId, trialId],
        );
        if (parseInt(siblingRes.rows[0].count, 10) === 0) {
          throw new Error(
            `entity delete: expected sibling (non-trial-anchored) events to survive, found 0`,
          );
        }
      } finally {
        await pg.end();
      }

      await scratch.cleanup();
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// Test 3: redact_user preserves event authorship + audit recorded
// ---------------------------------------------------------------------------

describe('redact_user preserves event authorship and records compliance audit', () => {
  let scratchUserId: string;
  let scratchSpaceCleanup: (() => Promise<void>) | undefined;

  afterAll(async () => {
    // Order: space first (cascade removes the event so created_by FK no longer
    // blocks auth.users delete), then audit / user_redactions cleanup, then user.
    if (scratchSpaceCleanup) {
      await scratchSpaceCleanup().catch((err: unknown) =>
        // eslint-disable-next-line no-console
        console.error('redact afterAll: space cleanup error:', err),
      );
    }

    if (!scratchUserId) return;

    const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
    try {
      await pg.connect();
      await pg.query(
        `delete from public.audit_events
         where (action = 'compliance.user_pii_redacted' and resource_id = $1)
            or actor_user_id = $1`,
        [scratchUserId],
      );
      // user_redactions FK to auth.users is ON DELETE CASCADE, but delete the
      // row explicitly so the auth user delete is unambiguous.
      await pg.query(`delete from public.user_redactions where user_id = $1`, [scratchUserId]);
    } finally {
      await pg.end();
    }

    // auth.users row still exists (redact_user mangles it, not deletes it).
    await svc.auth.admin.deleteUser(scratchUserId).catch((err: unknown) =>
      // eslint-disable-next-line no-console
      console.error('redact afterAll: deleteUser error:', err),
    );
  });

  it(
    'redact_user preserves created_by on events and records compliance.user_pii_redacted',
    async () => {
      // 1. Throwaway auth user. @cleanup.test suffix avoids the demo-tenant
      //    auto-join trigger (mirrors the @clint.local pattern in rpc-redaction).
      const scratchEmail =
        `redact-authorship-${Date.now()}-${randomUUID().slice(0, 8)}@cleanup.test`;
      const created = await createAuthUser(svc, { email: scratchEmail });
      scratchUserId = created.id;

      // 2. Scratch space under the personas tenant.
      const scratch = await createScratchSpace(p);
      scratchSpaceCleanup = scratch.cleanup;

      // 3. Insert ONE event authored by the scratch user via pg.
      //    Set request.jwt.claim.sub so auth.uid() (used by trg_events_set_created_by)
      //    resolves to scratchUserId. Supply created_by directly as well.
      const pg = new PgClient({ connectionString: SUPABASE_DB_URL });
      let scratchEventId: string;
      try {
        await pg.connect();

        const etRes = await pg.query<{ id: string }>(
          `select id from public.event_types where space_id is null limit 1`,
        );
        if (etRes.rows.length === 0) {
          throw new Error('redact test: no global event_type available in seed');
        }
        const eventTypeId = etRes.rows[0].id;

        await pg.query(`select set_config('request.jwt.claim.sub', $1, true)`, [scratchUserId]);

        const evtRes = await pg.query<{ id: string }>(
          `insert into public.events
             (space_id, event_type_id, title, event_date, anchor_type, created_by)
           values ($1, $2, $3, current_date, 'space', $4)
           returning id`,
          [
            scratch.spaceId,
            eventTypeId,
            'Authorship preservation test event',
            scratchUserId,
          ],
        );
        scratchEventId = evtRes.rows[0].id;
      } finally {
        await pg.end();
      }

      // 4. Redact the scratch user as platform_admin.
      await expectOk(
        await as(p, 'platform_admin').rpc('redact_user', { p_user_id: scratchUserId }),
      );

      // 5. Assert: created_by on the event STILL equals scratchUserId.
      //    redact_user wipes memberships + mangles auth.users but PRESERVES authorship.
      const pgCheck = new PgClient({ connectionString: SUPABASE_DB_URL });
      try {
        await pgCheck.connect();

        const { rows: evtRows } = await pgCheck.query<{ created_by: string }>(
          `select created_by from public.events where id = $1`,
          [scratchEventId],
        );
        if (evtRows.length === 0) {
          throw new Error(`event ${scratchEventId} not found post-redaction`);
        }
        if (evtRows[0].created_by !== scratchUserId) {
          throw new Error(
            `expected created_by=${scratchUserId} (preserved), got ${evtRows[0].created_by}`,
          );
        }
      } finally {
        await pgCheck.end();
      }

      // 6. Assert: compliance.user_pii_redacted audit row with resource_id = scratchUserId.
      const { data: auditRows, error: auditErr } = await svc
        .from('audit_events')
        .select('action, resource_id, source')
        .eq('action', 'compliance.user_pii_redacted')
        .eq('resource_id', scratchUserId)
        .order('occurred_at', { ascending: false })
        .limit(1);
      if (auditErr) {
        throw new Error(`query compliance.user_pii_redacted: ${auditErr.message}`);
      }
      if (!auditRows || auditRows.length === 0) {
        throw new Error(
          `expected a compliance.user_pii_redacted audit row with resource_id=${scratchUserId}, found none`,
        );
      }
      const auditRow = auditRows[0] as Record<string, unknown>;
      if (auditRow['source'] !== 'rpc') {
        throw new Error(`expected audit source='rpc', got '${auditRow['source']}'`);
      }
    },
    60_000,
  );
});
