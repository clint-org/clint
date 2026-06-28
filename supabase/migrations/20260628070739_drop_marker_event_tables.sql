-- Greenfield cutover: no data to preserve. Remove the old two-table model and
-- everything that depends on it. The unified events schema replaces it.
drop table if exists public.marker_assignments cascade;
drop table if exists public.marker_changes     cascade;
drop table if exists public.markers            cascade;
drop table if exists public.marker_types       cascade;
drop table if exists public.marker_categories  cascade;
drop table if exists public.event_links        cascade;
drop table if exists public.event_sources      cascade;
drop table if exists public.events             cascade;
drop table if exists public.event_threads      cascade;
drop table if exists public.event_categories   cascade;

-- Drop functions that may survive the table cascade by signature.
drop function if exists public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text, text, text, boolean) cascade;
drop function if exists public.get_marker_history(uuid) cascade;

notify pgrst, 'reload schema';
