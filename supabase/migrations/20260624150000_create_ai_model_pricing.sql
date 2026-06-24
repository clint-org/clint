-- migration: 20260624150000_create_ai_model_pricing
-- purpose: model catalog + pricing, the single source of truth for which models
--          the platform admin can choose and what each costs. Cost is computed
--          from this table (tokens x per-model rate), so the worker no longer
--          carries a hardcoded, model-specific formula. New model releases are a
--          seed row; retirements set status='deprecated' + superseded_by, which
--          keeps historical cost computable while dropping the model from the
--          chooser.

create table public.ai_model_pricing (
  model_id               text primary key,
  display_name           text not null,
  family                 text not null check (family in ('opus', 'sonnet', 'haiku', 'fable')),
  -- pricing in cents per million tokens (e.g. $3/Mtok input = 300)
  input_cents_per_mtok   numeric(12,4) not null check (input_cents_per_mtok >= 0),
  output_cents_per_mtok  numeric(12,4) not null check (output_cents_per_mtok >= 0),
  status                 text not null default 'active' check (status in ('active', 'deprecated', 'retired')),
  released_on            date,
  superseded_by          text references public.ai_model_pricing(model_id),
  notes                  text,
  updated_by             uuid references auth.users(id),
  updated_at             timestamptz not null default now()
);

comment on table public.ai_model_pricing is
  'Model catalog + per-model pricing (cents per million tokens). Drives the platform-admin model chooser and server-side cost computation. Add a row when a model ships; set status/superseded_by when one retires.';

alter table public.ai_model_pricing enable row level security;

-- Pricing is public information; any authenticated user may read the catalog
-- (the chooser and cost displays use it). Writes are platform-admin only.
create policy "anyone authenticated can read ai_model_pricing"
  on public.ai_model_pricing for select to authenticated
  using (true);

create policy "platform admin can insert ai_model_pricing"
  on public.ai_model_pricing for insert to authenticated
  with check ((select public.is_platform_admin()));

create policy "platform admin can update ai_model_pricing"
  on public.ai_model_pricing for update to authenticated
  using ((select public.is_platform_admin()))
  with check ((select public.is_platform_admin()));

create policy "platform admin can delete ai_model_pricing"
  on public.ai_model_pricing for delete to authenticated
  using ((select public.is_platform_admin()));

grant select on public.ai_model_pricing to authenticated;

-- Seed the current catalog (cents per Mtok). Sonnet stays the default model.
insert into public.ai_model_pricing
  (model_id, display_name, family, input_cents_per_mtok, output_cents_per_mtok, status, released_on)
values
  ('claude-opus-4-8',   'Claude Opus 4.8',   'opus',   500, 2500, 'active', '2026-01-01'),
  ('claude-sonnet-4-6', 'Claude Sonnet 4.6', 'sonnet', 300, 1500, 'active', '2025-11-01'),
  ('claude-haiku-4-5',  'Claude Haiku 4.5',  'haiku',  100,  500, 'active', '2025-10-01')
on conflict (model_id) do nothing;

-- Cost helper: cents for a given model + token counts. Returns null when the
-- model is absent from the catalog so callers can apply their own fallback.
create or replace function public.ai_estimate_cost_cents(
  p_model             text,
  p_prompt_tokens     int,
  p_completion_tokens int
) returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select round(
           coalesce(p_prompt_tokens, 0)::numeric     / 1000000 * mp.input_cents_per_mtok
         + coalesce(p_completion_tokens, 0)::numeric  / 1000000 * mp.output_cents_per_mtok,
         4)
    from public.ai_model_pricing mp
   where mp.model_id = p_model;
$$;

comment on function public.ai_estimate_cost_cents(text, int, int) is
  'Cents for a model + token counts using ai_model_pricing. Null if the model is not in the catalog.';

-- Model resolver: returns the requested model when it is an active catalog
-- model, otherwise the platform default (sonnet if active, else any active
-- model). Guarantees ai_call_open never stamps an unknown/retired model.
create or replace function public.ai_resolve_model(p_requested text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select model_id from public.ai_model_pricing
      where model_id = p_requested and status = 'active'),
    (select model_id from public.ai_model_pricing
      where model_id = 'claude-sonnet-4-6' and status = 'active'),
    (select model_id from public.ai_model_pricing
      where status = 'active' order by released_on desc nulls last, model_id limit 1)
  );
$$;

comment on function public.ai_resolve_model(text) is
  'Resolves a requested model to an active catalog model, falling back to the default. Never returns a retired/unknown model.';

-- smoke test
do $$
declare
  v_cost numeric;
begin
  -- Sonnet: 100 prompt + 50 completion tokens
  --   100/1e6 * 300  + 50/1e6 * 1500 = 0.03 + 0.075 = 0.105 cents
  v_cost := public.ai_estimate_cost_cents('claude-sonnet-4-6', 100, 50);
  assert v_cost = 0.1050,
    format('expected 0.1050 cents for sonnet 100/50, got %s', v_cost);

  -- Opus is pricier than Sonnet for the same tokens
  assert public.ai_estimate_cost_cents('claude-opus-4-8', 100, 50)
       > public.ai_estimate_cost_cents('claude-sonnet-4-6', 100, 50),
    'opus should cost more than sonnet for equal tokens';

  -- Unknown model -> null
  assert public.ai_estimate_cost_cents('not-a-model', 100, 50) is null,
    'unknown model should return null cost';

  -- Resolver: known active passes through; unknown falls back to sonnet
  assert public.ai_resolve_model('claude-opus-4-8') = 'claude-opus-4-8',
    'resolver should pass through an active model';
  assert public.ai_resolve_model('not-a-model') = 'claude-sonnet-4-6',
    'resolver should fall back to sonnet for unknown model';

  raise notice 'smoke: ai_model_pricing + helpers OK';
end$$;

notify pgrst, 'reload schema';
