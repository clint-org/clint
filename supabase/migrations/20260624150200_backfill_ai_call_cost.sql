-- migration: 20260624150200_backfill_ai_call_cost
-- purpose: one-time correction of historical ai_calls cost. The old worker stored
--          dollars in a cents field (100x too low). Recompute from the recorded
--          token counts x the model's catalog price where possible; for rows
--          without token counts (or an off-catalog model) apply the x100
--          correction to the legacy value. Best-effort: it makes historical
--          dollar *estimates* sane. Going forward cost is computed at close time.

-- Rows with token counts and a catalog model: recompute exactly.
update public.ai_calls c
   set cost_estimate_cents = public.ai_estimate_cost_cents(c.model, c.prompt_tokens, c.completion_tokens)
 where (coalesce(c.prompt_tokens, 0) + coalesce(c.completion_tokens, 0)) > 0
   and public.ai_estimate_cost_cents(c.model, c.prompt_tokens, c.completion_tokens) is not null;

-- Rows we cannot recompute (no tokens, or unknown model) but that carry the
-- legacy 100x-low value: scale it up so historical totals are no longer ~$0.
update public.ai_calls c
   set cost_estimate_cents = c.cost_estimate_cents * 100
 where (coalesce(c.prompt_tokens, 0) + coalesce(c.completion_tokens, 0)) = 0
   and c.cost_estimate_cents is not null
   and c.cost_estimate_cents > 0;

do $$
begin
  raise notice 'backfill: ai_calls cost recomputed from token counts + catalog pricing';
end$$;
