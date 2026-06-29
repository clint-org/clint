create table public.events (
  id                 uuid primary key default gen_random_uuid(),
  space_id           uuid not null references public.spaces (id) on delete cascade,
  event_type_id      uuid not null references public.event_types (id),
  title              text not null,
  description        text,
  source_url         text,
  event_date         date not null,
  date_precision     text not null default 'exact' check (date_precision in ('exact','month','quarter','half','year')),
  end_date           date,
  end_date_precision text not null default 'exact' check (end_date_precision in ('exact','month','quarter','half','year')),
  is_ongoing         boolean not null default false check (not (is_ongoing and end_date is not null)),
  projection         text not null default 'actual' check (projection in ('forecasted','company','primary','actual')),
  is_projected       boolean generated always as (projection <> 'actual') stored,
  significance        text check (significance in ('high','low')),
  visibility          text check (visibility in ('pinned','hidden')),
  anchor_type         text not null check (anchor_type in ('space','company','asset','trial')),
  anchor_id           uuid,
  no_longer_expected  boolean not null default false,
  metadata            jsonb,
  source_doc_id       uuid references public.source_documents (id) on delete set null,
  created_by          uuid not null references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id),
  constraint events_anchor_id_required check (anchor_type = 'space' or anchor_id is not null)
);
create index idx_events_space_id on public.events (space_id);
create index idx_events_event_type_id on public.events (event_type_id);
create index idx_events_event_date on public.events (event_date);
create index idx_events_anchor on public.events (anchor_type, anchor_id);

alter table public.events enable row level security;
create policy "events: select" on public.events for select to authenticated
  using (public.has_space_access(space_id));
create policy "events: insert" on public.events for insert to authenticated
  with check (public.has_space_access(space_id, array['owner','editor']));
create policy "events: update" on public.events for update to authenticated
  using (public.has_space_access(space_id, array['owner','editor']))
  with check (public.has_space_access(space_id, array['owner','editor']));
create policy "events: delete" on public.events for delete to authenticated
  using (public.has_space_access(space_id, array['owner','editor']));

create trigger trg_events_set_created_by  before insert on public.events
  for each row execute function public._set_created_by();
create trigger trg_events_set_updated_audit before update on public.events
  for each row execute function public._set_updated_audit();
