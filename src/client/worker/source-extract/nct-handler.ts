import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../index';
import { callRpc, type SupabaseConfig } from '../supabase';
import { jwtSubject } from '../auth';
import { createCtgovClient } from '../ctgov-sync/ctgov-client';
import { buildNctPrompt, type NctStudyRecord } from './nct-prompt-builder';
import { toStudyRecord, applyNctTrialNames } from './nct-study-record';
import { isLlmAbort, llmFailureMessage } from './call-outcome';
import { closeAiCall } from './ai-call-close';
import { chunkArray, mergeSubBatches, type SubBatchExtraction } from './nct-merge';
import { validateExtraction } from './response-validator';
import { computeFuzzyAlternates } from './fuzzy-alternates';
import { applyLogoEnrichment, resolveProposalNames } from './post-extract';
import { extractionTemperature } from './temperature';
import type { NctResolveRequest, ExtractResponse, InventorySnapshot } from './types';

const NCT_REGEX = /^NCT\d{8}$/i;
const MAX_NCTS = 50;
const CTGOV_FETCH_TIMEOUT_MS = 8_000;
// 90s headroom for Sonnet extractions; under Cloudflare's ~100s edge
// timeout so the CDN can't 524 before our own abort. Mirrors handler.ts.
const LLM_TIMEOUT_MS = 90_000;
// Sub-batch size for NCT resolution (#178). A single call over the whole batch
// grows with the number of trials and can exceed LLM_TIMEOUT_MS -- and Cloudflare's
// ~100s edge ceiling -- for a within-limit import. Splitting into <=10-study
// sub-calls keeps each comfortably under the timeout. Chosen so a full MAX_NCTS
// (50) import fans out to at most ceil(50/10) = 5 concurrent model calls, under
// Cloudflare's 6-simultaneous-outbound-connection cap. If MAX_NCTS grows past 60,
// raise CHUNK_SIZE in step to keep that fan-out <= 5.
const CHUNK_SIZE = 10;
// Public Brandfetch Logo Link client ID. Mirrors the Angular env so both
// frontend renders and worker enrichment present the same Referer/Origin
// to the CDN hotlink check.
const BRANDFETCH_CLIENT_ID = '1idkTE42LH-0X2u_ymo';

export async function handleNctResolve(
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

  let body: NctResolveRequest;
  try {
    body = (await request.json()) as NctResolveRequest;
  } catch {
    return jsonError(400, 'invalid_json', cors);
  }

  if (!body.space_id) return jsonError(400, 'space_id_required', cors);
  if (!Array.isArray(body.nct_ids)) return jsonError(400, 'no_valid_ncts', cors);

  const validIds = [
    ...new Set(
      body.nct_ids.map((id) => id.trim().toUpperCase()).filter((id) => NCT_REGEX.test(id))
    ),
  ];

  if (validIds.length === 0) {
    return jsonErrorWithCode(
      400,
      'no_valid_ncts',
      'No valid NCT IDs found. IDs should look like NCT01234567.',
      cors
    );
  }
  if (validIds.length > MAX_NCTS) {
    return jsonErrorWithCode(
      400,
      'too_many_ncts',
      'Maximum 50 NCT IDs per import. Please split into batches.',
      cors
    );
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

  const ctgov = createCtgovClient({ baseUrl: env.CTGOV_BASE_URL });
  const warnings: string[] = [];

  // Diagnostics: time the CT.gov fetch phase separately from the LLM call so a
  // TIMEOUT row can distinguish a slow fetch from a slow model (#162 follow-up).
  const ctgovStart = Date.now();
  const fetchResults = await Promise.allSettled(
    validIds.map(async (nctId) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), CTGOV_FETCH_TIMEOUT_MS);
      try {
        const study = await fetchStudyWithAbort(ctgov, nctId, controller.signal);
        clearTimeout(timeout);
        return { nctId, study };
      } catch (e) {
        clearTimeout(timeout);
        throw { nctId, error: e };
      }
    })
  );
  const ctgovMs = Date.now() - ctgovStart;

  const successfulStudies: { nctId: string; study: unknown }[] = [];
  for (const result of fetchResults) {
    if (result.status === 'fulfilled') {
      if (result.value.study !== null) {
        successfulStudies.push(result.value);
      } else {
        warnings.push(`nct_fetch_failed:${result.value.nctId}:not_found`);
      }
    } else {
      const rejection = result.reason as { nctId: string; error: unknown };
      const reason =
        rejection.error instanceof Error && rejection.error.name === 'AbortError'
          ? 'timeout'
          : 'http_error';
      warnings.push(`nct_fetch_failed:${rejection.nctId}:${reason}`);
    }
  }

  if (successfulStudies.length === 0) {
    return jsonErrorWithCode(
      502,
      'all_ncts_failed',
      'Could not reach ClinicalTrials.gov. Check your connection and try again.',
      cors
    );
  }

  const studyRecords: NctStudyRecord[] = successfulStudies.map(({ study }) => toStudyRecord(study));

  const tenantId = await fetchTenantId(cfg, auth, body.space_id);
  if (!tenantId) return jsonError(403, 'forbidden', cors);

  const userId = jwtSubject(auth);
  if (!userId) return jsonError(401, 'unauthenticated', cors);

  const sourceText = JSON.stringify(studyRecords);
  const textHash = await sha256(sourceText);

  const aiCallId = await callRpc<string>(cfg, null, 'ai_call_open', {
    p_secret: env.EXTRACT_SOURCE_WORKER_SECRET,
    p_tenant_id: tenantId,
    p_space_id: body.space_id,
    p_user_id: userId,
    p_model: 'claude-sonnet-4-6',
    p_feature: 'source_extract',
    p_input_hash: textHash,
    // Reproducibility capture: the requested NCT ids are enough to re-run.
    p_request: {
      kind: 'nct',
      input: { nct_ids: body.nct_ids },
    },
  });

  const preflight = await callRpc<{
    allowed: boolean;
    reason: string | null;
    model: string;
    remaining_today_tokens: number;
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
      preflight.reason === 'daily_token_cap' ? 'cost_capped' : 'rate_limited',
      Date.now() - start,
      null,
      null,
      preflight.reason
    );
    const msg =
      preflight.reason === 'daily_token_cap'
        ? 'Daily AI usage limit reached. It resets on a rolling 24-hour basis.'
        : preflight.reason === 'ai_disabled'
          ? 'AI features are not enabled for this organization.'
          : 'Too many imports in a short window. Try again shortly.';
    return jsonErrorWithCode(429, preflight.reason ?? 'rate_limited', msg, cors);
  }

  const inventory = await callRpc<InventorySnapshot>(cfg, auth, 'get_space_inventory_snapshot', {
    p_space_id: body.space_id,
  });

  // Representative full-batch prompt, captured into ai_calls.output at close for
  // replay/analysis. The request is issued as CHUNK_SIZE-study sub-calls below,
  // but this mirrors the single logical extraction the stored nct_ids reproduce.
  const prompt = buildNctPrompt(studyRecords, inventory);
  const promptText = `${prompt.system}\n\n${prompt.user}`;
  const temperature = extractionTemperature(preflight.model);
  const aiParams = { model: preflight.model, max_tokens: 8192, temperature };

  // Resolve the batch as concurrent CHUNK_SIZE-study sub-calls so no single model
  // call has to fit the whole batch inside LLM_TIMEOUT_MS / the ~100s edge ceiling
  // (#178). Each sub-call is validated independently against the SAME inventory;
  // mergeSubBatches then reconciles their index spaces into one proposal set.
  const llmStart = Date.now();
  const studyChunks = chunkArray(studyRecords, CHUNK_SIZE);
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const outcomes = await Promise.all(
    studyChunks.map((chunk) => resolveChunk(client, chunk, inventory, preflight.model, temperature))
  );

  const promptTokens = outcomes.reduce((sum, o) => sum + o.promptTokens, 0);
  const completionTokens = outcomes.reduce((sum, o) => sum + o.completionTokens, 0);
  const successes = outcomes.filter((o) => o.ok);
  const failures = outcomes.filter((o) => !o.ok);

  // Diagnostics captured on every close so the AI Usage row explains itself: how
  // many trials the model was asked to resolve, how long each phase took (CT.gov
  // fetch vs the model calls), and how the batch was chunked (#178 / #162).
  const diagnostics = () => ({
    trial_count: studyRecords.length,
    ctgov_ms: ctgovMs,
    llm_ms: Date.now() - llmStart,
    chunk_count: studyChunks.length,
    chunk_failures: failures.length,
  });

  if (successes.length === 0) {
    // Every sub-call failed. A 'timeout' when any was our abort timer, else
    // 'parse_failed' -- both constraint-valid terminal outcomes, never PENDING
    // (#162). The first failure's message names the threshold/batch/remedy.
    const anyAbort = failures.some((f) => f.aborted);
    await closeAiCall(
      cfg,
      env,
      aiCallId,
      anyAbort ? 'timeout' : 'parse_failed',
      Date.now() - start,
      promptTokens,
      completionTokens,
      failures[0]?.reason ?? 'nct_resolution_failed',
      { prompt: promptText, params: aiParams, diagnostics: diagnostics() }
    );
    return jsonErrorWithCode(
      502,
      'ai_resolution_failed',
      'We fetched your trial data but could not resolve companies and assets.',
      cors,
      { ctgov_data: studyRecords }
    );
  }

  const merged = mergeSubBatches(successes.map((o) => o.extraction!));
  const proposals = merged.result;
  const dropped = merged.dropped;
  warnings.push(...merged.warnings);
  // Partial success: some sub-batches resolved, others timed out or failed to
  // parse. Record each so the user (and the AI Usage row) know that a subset of
  // trials was skipped rather than silently dropped.
  for (const f of failures) {
    warnings.push(`nct_chunk_failed:${f.reason}`);
  }
  const rawOutput = successes.map((o) => o.rawOutput).join('\n---\n');

  // Name each NCT trial deterministically from its CT.gov record (acronym, else
  // brief title) rather than trusting the model's free-text choice. Keeps trial
  // names short and consistent (e.g. "SYNERGY-Outcomes" instead of the full
  // official title) and matches the press-release import path.
  applyNctTrialNames(proposals, studyRecords);

  const apex = env.ALLOWED_APEXES.split(',')[0].trim();
  await applyLogoEnrichment(proposals, 'nct-resolve', BRANDFETCH_CLIENT_ID, `https://${apex}/`);
  const { resolvedNames } = resolveProposalNames(proposals, inventory);

  // NCT trials are identified by NCT ID rather than name, so fuzzy
  // matching only applies to companies and assets here.
  const fuzzyAlternates = computeFuzzyAlternates(
    [
      ...proposals.companies.flatMap((c, i) =>
        c.match.kind === 'new' ? [{ type: 'company' as const, index: i, name: c.match.name }] : []
      ),
      ...proposals.assets.flatMap((a, i) =>
        a.match.kind === 'new' ? [{ type: 'asset' as const, index: i, name: a.match.name }] : []
      ),
    ],
    inventory
  );

  const resolvedIdentifiers: Record<string, string> = {};
  proposals.trials.forEach((t, i) => {
    if (t.match.kind === 'new') {
      const nctMatch = t.match.name.match(/^NCT\d{8}$/i);
      if (nctMatch) {
        resolvedIdentifiers[`trials_${i}`] = t.match.name.toUpperCase();
      }
    } else if (t.match.kind === 'existing') {
      const invTrial = inventory.trials.find((it) => it.id === t.match.id);
      if (invTrial?.identifier) {
        resolvedIdentifiers[`trials_${i}`] = invTrial.identifier;
      }
    }
  });

  // Cost is computed server-side in ai_call_close (tokens x the model's catalog
  // price), so the worker just reports the authoritative token counts.
  await closeAiCall(
    cfg,
    env,
    aiCallId,
    'success',
    Date.now() - start,
    promptTokens,
    completionTokens,
    null,
    { proposals, dropped, prompt: promptText, params: aiParams, raw: rawOutput, diagnostics: diagnostics() },
    warnings
  );

  const sourceTitle = `NCT batch import (${successfulStudies.length} trials)`;

  const response: ExtractResponse = {
    ai_call_id: aiCallId,
    source_kind: 'nct',
    source_url: null,
    source_text: sourceText,
    source_text_hash: textHash,
    source_title: sourceTitle,
    source_date: new Date().toISOString().slice(0, 10),
    source_summary: proposals.source_summary,
    proposals,
    dropped,
    fuzzy_alternates: fuzzyAlternates,
    ctgov_candidates: {},
    inventory_snapshot_hash: inventory.hash,
    warnings,
    resolved_names: resolvedNames,
    resolved_identifiers: resolvedIdentifiers,
  };

  return json(200, response, cors);
}

async function fetchStudyWithAbort(
  ctgov: { fetchStudy(nctId: string): Promise<unknown | null> },
  nctId: string,
  signal: AbortSignal
): Promise<unknown | null> {
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise<unknown | null>((resolve, reject) => {
    const onAbort = () => reject(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
    ctgov
      .fetchStudy(nctId)
      .then((result) => {
        signal.removeEventListener('abort', onAbort);
        resolve(result);
      })
      .catch((err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      });
  });
}

// Outcome of resolving one NCT sub-batch. resolveChunk never throws so a single
// slow/failed sub-call cannot reject the whole Promise.all: a failure is reported
// as `ok: false` with a human-readable reason and an `aborted` flag (true when the
// failure was our LLM_TIMEOUT_MS timer, which drives the batch-level 'timeout' vs
// 'parse_failed' outcome). Token counts are always reported for aggregation.
interface ChunkOutcome {
  ok: boolean;
  extraction?: SubBatchExtraction;
  rawOutput?: string;
  reason?: string;
  aborted?: boolean;
  promptTokens: number;
  completionTokens: number;
}

async function resolveChunk(
  client: Anthropic,
  chunkStudies: NctStudyRecord[],
  inventory: InventorySnapshot,
  model: string,
  temperature: number | undefined
): Promise<ChunkOutcome> {
  const prompt = buildNctPrompt(chunkStudies, inventory);
  let promptTokens = 0;
  let completionTokens = 0;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
    let response;
    try {
      response = await client.messages.create(
        {
          model,
          max_tokens: 8192,
          ...(temperature !== undefined ? { temperature } : {}),
          system: prompt.system,
          messages: [{ role: 'user', content: prompt.user }],
        },
        { signal: controller.signal }
      );
    } finally {
      clearTimeout(timeout);
    }

    promptTokens = response.usage?.input_tokens ?? 0;
    completionTokens = response.usage?.output_tokens ?? 0;

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { ok: false, reason: 'no_text_block', aborted: false, promptTokens, completionTokens };
    }

    const validation = validateExtraction(textBlock.text, inventory, '', {
      skipNameGrounding: true,
    });
    if (!validation.ok) {
      return {
        ok: false,
        reason: validation.reason,
        aborted: false,
        rawOutput: textBlock.text,
        promptTokens,
        completionTokens,
      };
    }

    return {
      ok: true,
      extraction: {
        result: validation.result,
        dropped: validation.dropped,
        warnings: validation.warnings,
        promptTokens,
        completionTokens,
      },
      rawOutput: textBlock.text,
      promptTokens,
      completionTokens,
    };
  } catch (e) {
    // Self-explanatory message on timeout (names the threshold, batch size, and
    // remedy) instead of the opaque SDK string "Request was aborted." (#162).
    return {
      ok: false,
      reason: llmFailureMessage(e, { timeoutMs: LLM_TIMEOUT_MS, trialCount: chunkStudies.length }),
      aborted: isLlmAbort(e),
      promptTokens,
      completionTokens,
    };
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
  cors: Record<string, string>,
  extra?: Record<string, unknown>
): Response {
  return json(status, { error: code, message, ...extra }, cors);
}
