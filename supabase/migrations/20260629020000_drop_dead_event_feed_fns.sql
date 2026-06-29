-- Drop three Stage-1-cutover functions that read the dropped event_links / event_threads
-- tables and are therefore unreachable dead cruft. The event-links / threads feature
-- returns rebuilt in Stage 3.

drop function if exists public.get_event_detail(uuid);
drop function if exists public.get_event_thread(uuid);
drop function if exists public.update_event_links(uuid, uuid[]);

notify pgrst, 'reload schema';
