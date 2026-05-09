-- migration: 20260509120300_advisor_sweep_pg_trgm_to_extensions
-- purpose: clear the `extension_in_public` warning (Splinter rule 0014).
--   Supabase's other extensions (pg_net, pgcrypto, pg_stat_statements,
--   uuid-ossp) already live in the `extensions` schema; pg_trgm was the
--   one outlier in `public`. moving it brings the project in line with
--   Supabase's recommended layout and removes the advisor warning.
--
-- compatibility:
--   - the 7 GIN indexes that use `gin_trgm_ops` keep working: an index
--     stores the operator-class OID, not its qualified name, and OIDs are
--     stable across schema moves.
--   - exactly one user function (`public.search_palette`) calls the
--     pg_trgm `similarity()` function. its current `search_path = public`
--     would no longer resolve `similarity` after the move, so we extend
--     it to `public, extensions`. body bytes are untouched.
--   - role search paths and other security-definer functions in the repo
--     do not reference pg_trgm, so no other adjustments are needed.

alter extension pg_trgm set schema extensions;

-- Keep search_palette working: similarity() now lives in extensions.
-- ALTER FUNCTION ... SET search_path is enough; no body change required.
alter function public.search_palette(uuid, text, text, integer)
  set search_path = public, extensions;
