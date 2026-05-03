-- migration: 20260502120100_trials_polling_columns
-- purpose: add polling watermark columns to public.trials so the ct.gov
--   worker can track ingest progress per trial:
--   latest_ctgov_version (highest snapshot version ingested) and
--   last_polled_at (timestamp of the last successful poll).
-- also adds a partial index that powers the "least recently polled first"
--   queue used by the worker, restricted to trials that have a ct.gov
--   identifier to poll.

alter table public.trials
  add column latest_ctgov_version int,
  add column last_polled_at       timestamptz;

create index idx_trials_polling_queue
  on public.trials (last_polled_at nulls first)
  where identifier is not null;

comment on column public.trials.latest_ctgov_version is
  'Highest CT.gov version we have ingested for this trial. Compared against snapshot rows.';
comment on column public.trials.last_polled_at is
  'Timestamp of the last successful Worker poll attempt for this trial. NULL means never polled; sorts first in the queue.';
