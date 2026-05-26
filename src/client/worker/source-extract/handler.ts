import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../index';
import { callRpc, type SupabaseConfig } from '../supabase';
import { jwtSubject } from '../auth';
import { cleanHtml } from './html-cleaner';
import { buildPrompt, estimateTokens } from './prompt-builder';
import { validateExtraction } from './response-validator';
import { enrichWithCtgov } from './ctgov-enrichment';
import { computeFuzzyAlternates } from './fuzzy-alternates';
import type { ExtractRequest, ExtractResponse, InventorySnapshot, DroppedEntity } from './types';

const MAX_SOURCE_BYTES = 500_000;
const LLM_TIMEOUT_MS = 60_000;
const FETCH_TIMEOUT_MS = 10_000;

export async function handleSourceExtract(
  request: Request,
  env: Env,
  cors: Record<string, string>
): Promise<Response> {
  const start = Date.now();
  const auth = request.headers.get('Authorization');
  if (!auth) {
    return jsonError(401, 'unauthenticated', cors);
  }

  const cfg: SupabaseConfig = { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY };

  let body: ExtractRequest;
  try {
    body = (await request.json()) as ExtractRequest;
  } catch {
    return jsonError(400, 'invalid_json', cors);
  }

  if (!body.space_id) return jsonError(400, 'space_id_required', cors);
  if (body.source_kind !== 'url' && body.source_kind !== 'text') {
    return jsonError(400, 'invalid_source_kind', cors);
  }

  let hasAccess: boolean;
  try {
    hasAccess = await callRpc<boolean>(cfg, auth, 'has_space_access', {
      p_space_id: body.space_id,
    });
  } catch {
    return jsonError(403, 'forbidden', cors);
  }
  if (!hasAccess) return jsonError(403, 'forbidden', cors);

  let sourceText: string;
  let sourceUrl: string | null = null;
  let sourceTitle: string | null = null;
  let fetchOutcome: 'success' | 'failed' | 'paste' = 'paste';

  if (body.source_kind === 'url') {
    if (!body.source_url) return jsonError(400, 'source_url_required', cors);
    sourceUrl = body.source_url;

    let fetchResult: Response;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      fetchResult = await fetch(body.source_url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'ClintBot/1.0 (pharma CI tool)' },
      });
      clearTimeout(timeout);
    } catch {
      return jsonErrorWithCode(
        422,
        'fetch_timeout',
        "Couldn't reach the source URL. The site may be slow or blocking us. Paste the article text instead.",
        cors
      );
    }

    if (fetchResult.status === 403 || fetchResult.status === 429) {
      return jsonErrorWithCode(
        422,
        'fetch_blocked',
        `${new URL(body.source_url).hostname} blocked our fetch. Paste the text instead.`,
        cors
      );
    }
    if (fetchResult.status === 404) {
      return jsonErrorWithCode(422, 'fetch_notfound', 'Page not found.', cors);
    }
    if (!fetchResult.ok) {
      return jsonErrorWithCode(
        422,
        'fetch_failed',
        `Source returned HTTP ${fetchResult.status}. Paste the text instead.`,
        cors
      );
    }

    const contentType = fetchResult.headers.get('Content-Type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return jsonErrorWithCode(
        422,
        'fetch_unsupported',
        'Only HTML pages are supported. Paste the text instead.',
        cors
      );
    }

    const rawHtml = await fetchResult.text();
    const cleaned = cleanHtml(rawHtml);

    if (cleaned.paywall_detected) {
      return jsonErrorWithCode(
        422,
        'fetch_paywall',
        'Article appears to be behind a paywall. Paste the text instead.',
        cors
      );
    }

    sourceText = cleaned.text;
    fetchOutcome = 'success';

    const titleMatch = rawHtml.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) sourceTitle = titleMatch[1].trim();
  } else {
    if (!body.source_text) return jsonError(400, 'source_text_required', cors);
    sourceText = body.source_text;
  }

  if (sourceText.length > MAX_SOURCE_BYTES) {
    return jsonErrorWithCode(
      422,
      'fetch_too_large',
      'Source text exceeds the 500KB limit. Trim to the relevant sections and try again.',
      cors
    );
  }

  const textHash = await sha256(sourceText);

  const tenantId = await fetchTenantId(cfg, auth, body.space_id);
  if (!tenantId) return jsonError(403, 'forbidden', cors);

  const userId = jwtSubject(auth);
  if (!userId) return jsonError(401, 'unauthenticated', cors);

  const aiCallId = await callRpc<string>(cfg, null, 'ai_call_open', {
    p_secret: env.EXTRACT_SOURCE_WORKER_SECRET,
    p_tenant_id: tenantId,
    p_space_id: body.space_id,
    p_user_id: userId,
    p_model: 'claude-sonnet-4-6',
    p_feature: 'source_extract',
    p_input_hash: textHash,
  });

  const preflight = await callRpc<{
    allowed: boolean;
    reason: string | null;
    remaining_today_cents: number;
    remaining_rate_min: number;
  }>(cfg, null, 'ai_call_preflight', {
    p_secret: env.EXTRACT_SOURCE_WORKER_SECRET,
    p_tenant_id: tenantId,
    p_user_id: userId,
  });

  if (!preflight.allowed) {
    await closeAiCall(
      cfg,
      env,
      aiCallId,
      preflight.reason === 'daily_cost_cap' ? 'cost_capped' : 'rate_limited',
      Date.now() - start,
      null,
      null,
      preflight.reason
    );
    const msg =
      preflight.reason === 'daily_cost_cap'
        ? 'Daily AI quota reached. Resets at midnight UTC.'
        : preflight.reason === 'ai_disabled'
          ? 'AI features are not enabled for this organization.'
          : 'Too many imports in a short window. Try again shortly.';
    return jsonErrorWithCode(429, preflight.reason ?? 'rate_limited', msg, cors);
  }

  const inventory = await callRpc<InventorySnapshot>(cfg, auth, 'get_space_inventory_snapshot', {
    p_space_id: body.space_id,
  });

  const prompt = buildPrompt(sourceText, inventory);
  const totalTokens = estimateTokens(prompt.system + prompt.user);
  if (totalTokens > 190_000) {
    await closeAiCall(
      cfg,
      env,
      aiCallId,
      'fetch_failed',
      Date.now() - start,
      null,
      null,
      'source_too_large_for_context'
    );
    return jsonErrorWithCode(
      422,
      'source_too_large',
      'Source text is too large for the AI context window. Trim to the relevant sections.',
      cors
    );
  }

  let rawOutput: string;
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

    const response = await client.messages.create(
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 8192,
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
      },
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    promptTokens = response.usage?.input_tokens ?? 0;
    completionTokens = response.usage?.output_tokens ?? 0;

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      await closeAiCall(
        cfg,
        env,
        aiCallId,
        'parse_failed',
        Date.now() - start,
        promptTokens,
        completionTokens,
        'no_text_block'
      );
      return jsonErrorWithCode(
        500,
        'parse_failed',
        "Couldn't read the AI response. Try again.",
        cors
      );
    }
    rawOutput = textBlock.text;
  } catch (e) {
    const isAbort = e instanceof Error && e.name === 'AbortError';
    const outcome = isAbort ? 'timeout' : 'parse_failed';
    const msg = isAbort
      ? 'Extraction timed out. Try again or use a shorter source.'
      : "Couldn't read the AI response. Try again.";
    await closeAiCall(
      cfg,
      env,
      aiCallId,
      outcome,
      Date.now() - start,
      promptTokens,
      completionTokens,
      String(e)
    );
    return jsonErrorWithCode(500, outcome, msg, cors);
  }

  const validation = validateExtraction(rawOutput, inventory, sourceText);
  if (!validation.ok) {
    await closeAiCall(
      cfg,
      env,
      aiCallId,
      'parse_failed',
      Date.now() - start,
      promptTokens,
      completionTokens,
      validation.reason,
      { raw_output: rawOutput.substring(0, 5000) }
    );
    return jsonErrorWithCode(
      500,
      'parse_failed',
      "Couldn't read the AI response. Try again.",
      cors
    );
  }

  const proposals = validation.result;
  const dropped = validation.dropped;
  const warnings = [...validation.warnings];

  if (
    proposals.companies.length === 0 &&
    proposals.assets.length === 0 &&
    proposals.trials.length === 0 &&
    proposals.markers.length === 0 &&
    proposals.events.length === 0
  ) {
    await closeAiCall(
      cfg,
      env,
      aiCallId,
      'success',
      Date.now() - start,
      promptTokens,
      completionTokens,
      null,
      { proposals, dropped },
      warnings
    );
    return json(
      200,
      {
        ai_call_id: aiCallId,
        source_kind: body.source_kind,
        source_url: sourceUrl,
        source_text: sourceText,
        source_text_hash: textHash,
        source_title: sourceTitle ?? proposals.source_title,
        source_date: proposals.source_date,
        source_summary: proposals.source_summary,
        proposals,
        dropped,
        fuzzy_alternates: {},
        ctgov_candidates: {},
        inventory_snapshot_hash: inventory.hash,
        warnings: [...warnings, 'empty_extraction'],
        resolved_names: {},
        resolved_identifiers: {},
      } satisfies ExtractResponse,
      cors
    );
  }

  const companyNames = proposals.companies.map((c) => {
    const m = c.match;
    return m.kind === 'new'
      ? m.name
      : (inventory.companies.find((ic) => ic.id === m.id)?.name ?? '');
  });
  const assetNames = proposals.assets.map((a) => {
    const m = a.match;
    return m.kind === 'new' ? m.name : (inventory.assets.find((ia) => ia.id === m.id)?.name ?? '');
  });

  const [ctgovResult, fuzzyAlternates] = await Promise.all([
    enrichWithCtgov(proposals, companyNames, assetNames, { timeout: 8000 }),
    Promise.resolve(
      computeFuzzyAlternates(
        [
          ...proposals.companies.flatMap((c, i) =>
            c.match.kind === 'new'
              ? [{ type: 'company' as const, index: i, name: c.match.name }]
              : []
          ),
          ...proposals.assets.flatMap((a, i) =>
            a.match.kind === 'new' ? [{ type: 'asset' as const, index: i, name: a.match.name }] : []
          ),
          ...proposals.trials.flatMap((t, i) =>
            t.match.kind === 'new' ? [{ type: 'trial' as const, index: i, name: t.match.name }] : []
          ),
        ],
        inventory
      )
    ),
  ]);

  warnings.push(...ctgovResult.warnings);

  const resolvedNames: Record<string, string> = {};
  companyNames.forEach((n, i) => {
    resolvedNames[`companies_${i}`] = n;
  });
  assetNames.forEach((n, i) => {
    resolvedNames[`assets_${i}`] = n;
  });
  proposals.trials.forEach((t, i) => {
    const m = t.match;
    resolvedNames[`trials_${i}`] =
      m.kind === 'new' ? m.name : (inventory.trials.find((it) => it.id === m.id)?.name ?? t.name);
  });

  const resolvedIdentifiers: Record<string, string> = {};
  proposals.trials.forEach((t, i) => {
    if (t.match.kind === 'existing') {
      const invTrial = inventory.trials.find((it) => it.id === t.match.id);
      if (invTrial?.identifier) {
        resolvedIdentifiers[`trials_${i}`] = invTrial.identifier;
      }
    }
  });

  const costCents = (promptTokens * 3 + completionTokens * 15) / 1_000_000;

  await closeAiCall(
    cfg,
    env,
    aiCallId,
    'success',
    Date.now() - start,
    promptTokens,
    completionTokens,
    null,
    { proposals, dropped },
    warnings,
    costCents
  );

  const response: ExtractResponse = {
    ai_call_id: aiCallId,
    source_kind: body.source_kind,
    source_url: sourceUrl,
    source_text: sourceText,
    source_text_hash: textHash,
    source_title: sourceTitle ?? proposals.source_title,
    source_date: proposals.source_date,
    source_summary: proposals.source_summary,
    proposals,
    dropped,
    fuzzy_alternates: fuzzyAlternates,
    ctgov_candidates: ctgovResult.candidates,
    inventory_snapshot_hash: inventory.hash,
    warnings,
    resolved_names: resolvedNames,
    resolved_identifiers: resolvedIdentifiers,
  };

  return json(200, response, cors);
}

async function closeAiCall(
  cfg: SupabaseConfig,
  env: Env,
  aiCallId: string,
  outcome: string,
  durationMs: number,
  promptTokens: number | null,
  completionTokens: number | null,
  errorMessage: string | null,
  output?: unknown,
  warnings?: string[],
  costCents?: number
): Promise<void> {
  try {
    await callRpc(cfg, null, 'ai_call_close', {
      p_secret: env.EXTRACT_SOURCE_WORKER_SECRET,
      p_ai_call_id: aiCallId,
      p_outcome: outcome,
      p_prompt_tokens: promptTokens,
      p_completion_tokens: completionTokens,
      p_cost_cents: costCents ?? null,
      p_duration_ms: durationMs,
      p_output: output ?? null,
      p_warnings: warnings ?? null,
      p_error_code: errorMessage ? outcome : null,
      p_error_message: errorMessage,
    });
  } catch {
    console.error(`Failed to close ai_call ${aiCallId}`);
  }
}

async function fetchTenantId(
  cfg: SupabaseConfig,
  auth: string,
  spaceId: string
): Promise<string | null> {
  try {
    const url = `${cfg.url}/rest/v1/spaces?id=eq.${spaceId}&select=tenant_id&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: cfg.anonKey,
        Authorization: auth,
        Accept: 'application/json',
      },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as { tenant_id: string }[];
    return rows[0]?.tenant_id ?? null;
  } catch {
    return null;
  }
}

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(status: number, body: unknown, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

function jsonError(status: number, error: string, cors: Record<string, string>): Response {
  return json(status, { error }, cors);
}

function jsonErrorWithCode(
  status: number,
  code: string,
  message: string,
  cors: Record<string, string>
): Response {
  return json(status, { error: code, message }, cors);
}
