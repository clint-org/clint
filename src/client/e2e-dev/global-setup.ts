/**
 * Preflight for the dev regression suite. Fails fast with an actionable message
 * if the one required secret is missing or the dev stack is unreachable, so a
 * forgotten `infisical run` wrapper does not surface as a confusing mid-test error.
 */
import { Client as PgClient } from 'pg';
import { DEV_SUPABASE_ANON_KEY, DEV_SUPABASE_URL, requirePoolerUrl } from './helpers/dev-env';

export default async function globalSetup(): Promise<void> {
  const pooler = requirePoolerUrl(); // throws with guidance if unset

  const pg = new PgClient({ connectionString: pooler });
  await pg.connect();
  try {
    await pg.query('select 1');
    const { rows } = await pg.query("select to_regclass('public.events') as events");
    if (!rows[0].events) {
      throw new Error('dev schema check failed: public.events not found');
    }
  } finally {
    await pg.end();
  }

  // GoTrue reachability (public settings endpoint; requires the anon apikey).
  const res = await fetch(`${DEV_SUPABASE_URL}/auth/v1/settings`, {
    headers: { apikey: DEV_SUPABASE_ANON_KEY },
  }).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(`dev GoTrue not reachable at ${DEV_SUPABASE_URL}/auth/v1/settings`);
  }

  // eslint-disable-next-line no-console
  console.log('[dev-e2e] preflight OK: pooler + dev schema + GoTrue reachable');
}
