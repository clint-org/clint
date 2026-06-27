-- Custom marker categories are now created/renamed/reordered/deleted directly via
-- PostgREST from the manage surface (marker-category.service + inline create in the
-- marker-type form), mirroring marker_types. RLS already restricts writes to space
-- owners/editors, but the authenticated role also needs table-level write grants;
-- previously only select was granted because there was no write path.
grant insert, update, delete on public.marker_categories to authenticated;
