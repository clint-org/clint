-- 20260528120200_idx_events_markers_created_at.sql
-- Back the events feed date-range filter (now on created_at::date for events
-- and markers) with composite indexes that match its actual access pattern:
-- always scope by space_id first, then by created_at descending. Restores the
-- selectivity that idx_events_event_date / idx_markers_event_date provided
-- before 20260528120100_events_feed_sort_by_feed_ts.sql shifted the filter.

create index if not exists idx_events_space_created_at
  on public.events (space_id, created_at desc);

create index if not exists idx_markers_space_created_at
  on public.markers (space_id, created_at desc);
