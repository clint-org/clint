/**
 * Enable AI features for a scratch world by flipping ai_config.ai_enabled=true.
 *
 * AI import is gated twice and both gates read ai_config.ai_enabled:
 *   - importGuard surfaces it via get_tenant_ai_status before /import loads
 *     (src/app/core/guards/import.guard.ts);
 *   - the extract worker calls ai_call_preflight, which returns ai_disabled when
 *     the row is missing or false
 *     (supabase/migrations/20260526100600_rpc_ai_call_preflight.sql).
 *
 * ai_config is keyed by tenant_id (PRIMARY KEY, 1:1 with tenants, ON DELETE
 * CASCADE), so we target world.tenantId, NOT world.spaceId. Because of the
 * cascade, the row is dropped automatically when world.cleanup() deletes the
 * tenant; no teardown is added here. We set a very high token cap and generous
 * per-user rate limits so ai_call_preflight never trips during a test run, plus
 * the model id the row (and the real Claude call) will use.
 *
 * Pooler-only, mirroring helpers/scratch-world.ts: the write-capable Postgres URL
 * (requirePoolerUrl()) is the single secret -- no service-role key, no JWT secret.
 */
import { Client as PgClient } from 'pg';
import { requirePoolerUrl } from './dev-env';
import type { ScratchWorld } from './scratch-world';

/**
 * Flip ai_config.ai_enabled=true for the world's tenant and stamp the model +
 * generous caps. Returns the configured model id (the ai-usage cost specs need
 * it to compute the expected cost). Call first in any AI-dependent test.
 */
export async function enableAi(world: ScratchWorld, model = 'claude-sonnet-4-6'): Promise<string> {
  const pg = new PgClient({ connectionString: requirePoolerUrl() });
  await pg.connect();
  try {
    await pg.query(
      `insert into public.ai_config
         (tenant_id, ai_enabled, ai_model, daily_token_cap,
          per_user_rate_per_min, per_user_rate_per_hour)
       values ($1, true, $2, 1000000000, 120, 2000)
       on conflict (tenant_id) do update
         set ai_enabled = true,
             ai_model = excluded.ai_model,
             daily_token_cap = excluded.daily_token_cap,
             per_user_rate_per_min = excluded.per_user_rate_per_min,
             per_user_rate_per_hour = excluded.per_user_rate_per_hour`,
      [world.tenantId, model]
    );
  } finally {
    await pg.end();
  }
  return model;
}
