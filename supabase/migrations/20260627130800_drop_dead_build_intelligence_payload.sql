-- migration: drop the dead 1-param build_intelligence_payload(uuid) overload.
--
-- This overload (defined in 20260524120500) references columns that the anchor
-- migrations removed from public.primary_intelligence (entity_type, entity_id,
-- body_md, published_at), so it would raise 42703 if it were ever called. The
-- 5-param form was already dropped in 20260627130400; this leftover 1-param form
-- was only mapped in the feature manifest to satisfy features:check.
--
-- Caller audit (live state, before this migration):
--   select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.prokind = 'f'
--     and pg_get_functiondef(p.oid) ilike '%build_intelligence_payload%'
--     and p.proname <> 'build_intelligence_payload';
-- -> list_intelligence_for_entity, build_intelligence_payload_for_row; both call
--    build_intelligence_payload_for_row(uuid), NOT the bare 1-param form. No
--    other function references the dropped name. Safe to drop.

drop function if exists public.build_intelligence_payload(uuid);
