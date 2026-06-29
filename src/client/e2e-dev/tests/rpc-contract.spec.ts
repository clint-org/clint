/**
 * @contract -- client<->DB RPC signature contract (whole client surface).
 *
 * Catches the class of bug where the Angular client's named-arg `.rpc(name, {...})`
 * payload diverges from the DEPLOYED Postgres function signature. PostgREST resolves a
 * named-arg overload only when EVERY no-default (required) param is supplied AND no
 * unknown param is sent; any divergence yields a runtime PGRST202 "could not find the
 * function" that the UI swallows into a generic "Could not save". The in-migration
 * smokes call these RPCs POSITIONALLY (passing dropped/vestigial params), so they never
 * exercise the client's named-arg path -- the exact gap that shipped update_event's
 * missing `p_source_url` to dev broken.
 *
 * This test is deterministic (pooler-only, no browser). It introspects every deployed
 * function once, then for each RPC the client calls asserts:
 *     required(fn) ⊆ clientArgs ⊆ params(fn)
 * against the args the client actually sends (RPC_CONTRACTS, generated from
 * origin/develop client source -- see fixtures/rpc-contracts.ts).
 *
 * KNOWN_DIVERGENCES is an allowlist of live client<->DB defects already being tracked.
 * The test is GREEN while the only violations are known ones, and RED the moment a NEW
 * divergence appears (a migration adds a required param, drops a still-called fn, or the
 * client renames an arg). When a known divergence is fixed, the test logs that it can be
 * removed from the allowlist.
 */
import { test, expect } from '../fixtures';
import { Client as PgClient } from 'pg';
import { requirePoolerUrl } from '../helpers/dev-env';
import { RPC_CONTRACTS } from '../fixtures/rpc-contracts';

/**
 * Live client<->DB divergences already known + tracked (so the suite is green on them
 * but red on anything new). Remove an entry once the fix deploys to dev.
 */
const KNOWN_DIVERGENCES: { key: string; note: string }[] = [
  // RESOLVED 2026-06-29: update_event:missing-required:p_source_url -- the DB session dropped
  // p_source_url from update_event (now 16 args, no p_source_url), matching UpdateEventArgs.
  {
    key: 'update_event_links:not-found',
    note: 'update_event_links dropped by 20260629020000_drop_dead_event_feed_fns but still called by EventService.updateLinks() -> PGRST202 when adding an event link. Fix: restore the RPC or remove the client call.',
  },
  {
    key: 'get_marker_history:not-found',
    note: 'get_marker_history dropped by 20260628070739_drop_marker_event_tables but still called by change-event.service.ts (legacy marker-detail-content.component). Fix: confirm the marker-detail path is dead and remove the call, or repoint to the event-history RPC.',
  },
];

interface Overload {
  params: string[];
  required: string[];
}

async function introspect(pg: PgClient): Promise<Map<string, Overload[]>> {
  const r = await pg.query(
    // proargmodes is "char"[]; cast to text[] so node-pg returns a real array of
    // single-char strings (otherwise it arrives as the literal "{i,o,...}" string and
    // the IN/OUT filter mis-indexes, mis-reading TABLE columns as IN params).
    `select p.proname                          as name,
            p.pronargs - p.pronargdefaults     as required_count,
            p.proargnames                      as names,
            p.proargmodes::text[]              as modes
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`
  );
  const map = new Map<string, Overload[]>();
  for (const row of r.rows) {
    const names: string[] = row.names ?? [];
    const modes: string[] | null = row.modes;
    // Keep IN / INOUT params only (drop OUT / TABLE columns) when modes is present.
    const inNames = modes ? names.filter((_, i) => modes[i] === 'i' || modes[i] === 'b') : names;
    const required = inNames.slice(0, row.required_count as number);
    const list = map.get(row.name) ?? [];
    list.push({ params: inNames, required });
    map.set(row.name, list);
  }
  return map;
}

/** Pick the overload the client most likely targets: prefer one whose params cover
 *  every always-sent arg, else the max-overlap overload. */
function bestOverload(overloads: Overload[], sends: string[]): Overload {
  let best = overloads[0];
  let bestScore = -1;
  for (const o of overloads) {
    const pset = new Set(o.params);
    const covers = sends.every((a) => pset.has(a)) ? 1000 : 0;
    const overlap = sends.filter((a) => pset.has(a)).length;
    const score = covers + overlap;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best;
}

test.describe('@contract client<->DB RPC signatures', () => {
  test('every client .rpc() call resolves against the deployed signature', async () => {
    const pg = new PgClient({ connectionString: requirePoolerUrl() });
    await pg.connect();
    let sigs: Map<string, Overload[]>;
    try {
      sigs = await introspect(pg);
    } finally {
      await pg.end();
    }

    const violations: { key: string; detail: string }[] = [];

    for (const c of RPC_CONTRACTS) {
      const overloads = sigs.get(c.rpc);
      if (!overloads || overloads.length === 0) {
        violations.push({
          key: `${c.rpc}:not-found`,
          detail: `${c.rpc}: not found on deployed dev, but the client calls it (${c.source}) -> PGRST202.`,
        });
        continue;
      }
      const clientArgs = new Set([...c.sends, ...(c.sometimes ?? [])]);
      const o = bestOverload(overloads, c.sends);
      const pset = new Set(o.params);

      for (const reqd of o.required.filter((p) => !clientArgs.has(p))) {
        violations.push({
          key: `${c.rpc}:missing-required:${reqd}`,
          detail: `${c.rpc}: client OMITS required param '${reqd}' (${c.source}) -> PGRST202. Send it client-side, or give it a DEFAULT / drop it DB-side.`,
        });
      }
      for (const unknown of [...clientArgs].filter((p) => !pset.has(p))) {
        violations.push({
          key: `${c.rpc}:unknown-param:${unknown}`,
          detail: `${c.rpc}: client sends param '${unknown}' that the deployed function does not declare (${c.source}) -> PGRST202.`,
        });
      }
    }

    const known = new Set(KNOWN_DIVERGENCES.map((k) => k.key));
    const fresh = violations.filter((v) => !known.has(v.key));
    const seen = new Set(violations.map((v) => v.key));
    const resolved = KNOWN_DIVERGENCES.filter((k) => !seen.has(k.key));

    // Visibility: always report the current state of the known divergences.
    if (violations.length) {
      console.log(
        `[@contract] ${violations.length} client<->DB divergence(s):\n` +
          violations.map((v) => '  - ' + v.detail).join('\n')
      );
    }
    if (resolved.length) {
      console.log(
        `[@contract] ${resolved.length} KNOWN divergence(s) now RESOLVED -- remove from KNOWN_DIVERGENCES:\n` +
          resolved.map((r) => '  - ' + r.key).join('\n')
      );
    }

    // The gate: NO NEW divergences beyond the tracked allowlist.
    expect(
      fresh.map((v) => v.detail),
      `NEW client<->DB RPC divergence(s) not in KNOWN_DIVERGENCES. Each is a runtime ` +
        `PGRST202 the UI hides. Fix the client/DB shape, or (if intentional+tracked) add the key to KNOWN_DIVERGENCES.`
    ).toEqual([]);
  });
});
