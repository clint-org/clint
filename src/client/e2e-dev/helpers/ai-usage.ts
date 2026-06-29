/**
 * Helpers for the AI cost / token accounting area.
 *
 * ai_calls is RLS-gated to agency members / platform admin (create_ai_calls
 * migration), so a role-user apiAs SELECT returns nothing. We therefore read it
 * through the write-capable pooler (the suite's only secret), which connects as a
 * privileged role and bypasses RLS -- the same connection scratch-world uses.
 *
 * Cost is computed SERVER-SIDE in ai_call_close from the row's model + tokens via
 * public.ai_estimate_cost_cents (migration 20260624150000):
 *   round(prompt_tokens/1e6 * input_cents_per_mtok
 *       + completion_tokens/1e6 * output_cents_per_mtok, 4)   -- cents, numeric(10,4)
 *
 * AI enablement lives in helpers/ai-config.ts (enableAi(world, model)); this file
 * only triggers calls and reads back the accounting rows.
 */
import { Client as PgClient } from 'pg';
import { userFor, type RoleName, type ScratchWorld } from './scratch-world';
import { requirePoolerUrl } from './dev-env';

export interface AiCallRow {
  id: string;
  tenant_id: string;
  space_id: string;
  model: string;
  outcome: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  /** numeric(10,4); node-postgres returns numeric as a string (e.g. "1.7500"). */
  cost_estimate_cents: string | null;
}

async function withPg<T>(fn: (pg: PgClient) => Promise<T>): Promise<T> {
  const pg = new PgClient({ connectionString: requirePoolerUrl() });
  await pg.connect();
  try {
    return await fn(pg);
  } finally {
    await pg.end();
  }
}

/**
 * POST a text source to the deployed worker's extract endpoint as a role. The
 * worker authenticates via the Bearer token (CORS is irrelevant to this server
 * -> server fetch). Mirrors import-page.component.ts:502. Returns status + parsed
 * body; on success body.ai_call_id is the opened (and already-closed) call.
 */
export async function triggerSourceExtract(
  world: ScratchWorld,
  role: RoleName,
  sourceText: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const token = userFor(world, role).session.access_token;
  const res = await fetch(`${world.baseURL}/api/source/extract`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      space_id: world.spaceId,
      source_kind: 'text',
      source_text: sourceText,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

const AI_CALL_COLS =
  'id, tenant_id, space_id, model, outcome, prompt_tokens, completion_tokens, ' +
  'cost_estimate_cents::text as cost_estimate_cents';

/** Read one ai_calls row by id via the pooler (bypasses agency-only RLS). */
export async function selectAiCall(aiCallId: string): Promise<AiCallRow | null> {
  return withPg(async (pg) => {
    const r = await pg.query(`select ${AI_CALL_COLS} from public.ai_calls where id = $1`, [
      aiCallId,
    ]);
    return (r.rows[0] as AiCallRow) ?? null;
  });
}

/** All ai_calls for a space, newest first (for rollup cross-checks). */
export async function selectAiCallsForSpace(spaceId: string): Promise<AiCallRow[]> {
  return withPg(async (pg) => {
    const r = await pg.query(
      `select ${AI_CALL_COLS} from public.ai_calls
        where space_id = $1 order by created_at desc`,
      [spaceId]
    );
    return r.rows as AiCallRow[];
  });
}

/** Catalog price for a model (cents per Mtok), or null if absent. */
export async function modelPricing(
  model: string
): Promise<{ input: number; output: number } | null> {
  return withPg(async (pg) => {
    const r = await pg.query(
      `select input_cents_per_mtok::float8 as input,
              output_cents_per_mtok::float8 as output
         from public.ai_model_pricing where model_id = $1`,
      [model]
    );
    const row = r.rows[0] as { input: number; output: number } | undefined;
    return row ?? null;
  });
}

/** Authoritative cost: call the same function ai_call_close used. */
export async function dbEstimateCostCents(
  model: string,
  promptTokens: number,
  completionTokens: number
): Promise<number> {
  return withPg(async (pg) => {
    const r = await pg.query(`select public.ai_estimate_cost_cents($1, $2, $3)::text as cost`, [
      model,
      promptTokens,
      completionTokens,
    ]);
    return Number((r.rows[0] as { cost: string }).cost);
  });
}

/**
 * Recompute the cost the way ai_estimate_cost_cents does, in JS, to prove we
 * understand input/output token pricing. round(.,4) == round-half-up for the
 * positive values here.
 */
export function expectedCostCents(
  promptTokens: number,
  completionTokens: number,
  pricing: { input: number; output: number }
): number {
  const raw =
    (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
  return Math.round(raw * 10_000) / 10_000;
}
