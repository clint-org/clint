# AI call request/response capture

Date: 2026-06-25
Status: approved (design), implementing

## Motivation

`ai_calls` logs every LLM call for cost/limit tracking, but it does not capture
enough to **reproduce or analyze** a call later. Today it stores model, tokens,
cost, outcome, `input_hash` (a hash, not the input), `output` (proposals on
success / first 5000 chars of raw text on failure), errors, warnings. Gaps:

1. Import mode is not recorded -- NCT and URL/text calls both use
   `feature = 'source_extract'`.
2. The actual input (NCT IDs / URL / pasted text) is not stored; for
   uncommitted extractions it is lost entirely (no `source_document` is created
   until commit).
3. The exact prompt sent to the model is not stored.
4. Raw output is truncated to 5000 chars and only kept on failure.

Goal: a platform admin (or the product team) can open any AI call -- committed
or not -- and see the whole picture, enough to replay it or analyze how to
improve the product. This must generalize to future AI tasks beyond import.

## Data model

Add one generic, extensible column to `public.ai_calls`:

- `request jsonb` -- the import-replay context known at open time:
  ```json
  {
    "kind":  "nct | url | text | <future task>",
    "input": { "nct_ids": ["NCT.."] } | { "url": "https://.." } | { "text": ".." }
  }
  ```
  Captured by the worker at `ai_call_open` (before the prompt is built), so it is
  present even for uncommitted extractions and is enough to re-run the import.

`output jsonb` (existing) is kept, but the worker now stores the **full,
untruncated** picture and the exact prompt/params, all of which are finalized
after the call is opened:
```json
{ "proposals": [..], "dropped": [..], "prompt": "<exact prompt>",
  "params": { "model": "claude-..", "max_tokens": 8192 }, "raw": "<full model text>" }
```
On failure it carries at least `{ prompt, params, raw }` (full text, no
5000-char cap) plus the error fields on the row. Together `request` + `output`
give the whole picture for replay/analysis.

`kind` is the single source of truth for "which import type"; it makes
`feature` redundant for mode but `feature` is left as-is for back-compat.

## RPC changes

- `ai_call_open(...)` gains `p_request jsonb default null`, inserted into
  `ai_calls.request`. The worker knows kind/input/prompt/params before calling
  the model, so it passes `p_request` at open time. The function is dropped and
  recreated (arg-list change) and ends with `notify pgrst, 'reload schema'`.
- `get_ai_usage_rollup` (space scope) adds `request` and `output` to each
  per-call row so the super-admin drill can show and copy them.

## Access / privacy

`ai_calls` RLS is unchanged: agency members of the space (who authored the
input) plus platform admins can read; the drill surface
(`get_ai_usage_rollup`) is platform-admin-only. Storing the input on `ai_calls`
does not widen exposure within a tenant (the same members already see their own
pasted source via `source_documents`), and RLS blocks cross-tenant reads. Full
content is retained (no truncation, no auto-purge) for debugging; revisit a
retention TTL if table size or sensitivity warrants it later.

## UI

The imports-drill expanded row (super-admin AI Usage) adds:

- **Mode** (`request.kind`) -- also answers "which import type".
- **Input** -- NCT IDs / URL / pasted text, with copy-to-clipboard.
- **Prompt** -- collapsible, copy.
- **Output** -- collapsible, copy.

alongside the existing model, tokens, created-entities, and failure log.

## Testing

- Integration: `ai_call_open` persists `p_request`; `get_ai_usage_rollup` space
  scope returns `request` + `output`.
- Worker: build verifies the request object is constructed and passed; full
  output stored (no truncation).
- Units/lint/build, advisor, features:check, runbook regen.
