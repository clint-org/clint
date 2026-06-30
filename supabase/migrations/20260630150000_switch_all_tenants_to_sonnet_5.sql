-- Stopgap: add Claude Sonnet 5 to the model catalog and switch every tenant to it.
--
-- Context: the super-admin "AI Spend Limits" dropdown is fed only by active rows in
-- ai_model_pricing, and nothing syncs newly released models into that catalog, so
-- claude-sonnet-5 never appeared. Tenants also pin an exact model version (no
-- latest-in-family tracking). This migration is the temporary "switch everyone to
-- Sonnet 5 now" bump while the durable fix (live Models API sync + refresh/upgrade
-- buttons) is built. Tracked under #180 -- this does NOT resolve that issue.
--
-- Scope: ALL tenants are moved to Sonnet 5, including any previously on Opus 4.8 or
-- Haiku 4.5 (an intentional, explicitly-approved blanket bump). Existing models stay
-- active and selectable, so an admin can move a tenant back via the dialog.

-- 1. Add Sonnet 5 to the pricing catalog. $3 / $15 per MTok standard pricing
--    (300 / 1500 cents), matching Sonnet 4.6's sticker. Idempotent. released_on is
--    approximate (mid-2026) and only affects newest-active ordering in ai_resolve_model().
insert into public.ai_model_pricing
  (model_id, display_name, family, input_cents_per_mtok, output_cents_per_mtok, status, released_on)
values
  ('claude-sonnet-5', 'Claude Sonnet 5', 'sonnet', 300, 1500, 'active', '2026-06-01')
on conflict (model_id) do update
  set display_name          = excluded.display_name,
      family                = excluded.family,
      input_cents_per_mtok  = excluded.input_cents_per_mtok,
      output_cents_per_mtok = excluded.output_cents_per_mtok,
      status                = 'active';

-- 2. Switch every tenant's configured model to Sonnet 5.
update public.ai_config
   set ai_model = 'claude-sonnet-5'
 where ai_model is distinct from 'claude-sonnet-5';

-- 3. New tenants default to Sonnet 5.
alter table public.ai_config alter column ai_model set default 'claude-sonnet-5';

-- 4. Smoke: Sonnet 5 is active in the catalog and no tenant remains on another model.
--    Pure SQL (no access-guarded RPCs), so it passes both `db reset` (empty) and
--    `db push` against populated remote.
do $$
begin
  if not exists (
    select 1 from public.ai_model_pricing
     where model_id = 'claude-sonnet-5' and status = 'active'
  ) then
    raise exception 'claude-sonnet-5 missing or inactive in ai_model_pricing';
  end if;

  if exists (
    select 1 from public.ai_config where ai_model is distinct from 'claude-sonnet-5'
  ) then
    raise exception 'ai_config rows not switched to claude-sonnet-5';
  end if;
end $$;
