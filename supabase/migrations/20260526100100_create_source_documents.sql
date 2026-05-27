-- migration: 20260525100100_create_source_documents
-- purpose: one row per imported source document (URL fetch or pasted text).
--          scoped by space_id. text_hash enables duplicate detection.
--          agency-only visibility; tenant-side users see only the resulting
--          clean rows on the timeline.

create table public.source_documents (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid not null references public.spaces(id) on delete cascade,
  source_kind     text not null check (source_kind in ('url', 'text')),
  source_url      text,
  source_title    text,
  source_text     text not null,
  text_hash       text not null,
  fetched_at      timestamptz not null default now(),
  fetch_outcome   text not null check (fetch_outcome in ('success', 'failed', 'paste')),
  fetch_error     text,
  created_by      uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),

  constraint source_documents_text_length check (length(source_text) <= 500000)
);

create index idx_source_documents_space_created
  on public.source_documents (space_id, created_at desc);

create index idx_source_documents_space_text_hash
  on public.source_documents (space_id, text_hash);

alter table public.source_documents enable row level security;

create policy "agency members or platform admin can read source_documents"
  on public.source_documents for select to authenticated
  using (
    public.is_agency_member_of_space(space_id)
    or public.is_platform_admin()
  );

create policy "agency space owner can delete source_documents"
  on public.source_documents for delete to authenticated
  using (
    public.is_agency_member_of_space(space_id)
    and public.has_space_access(space_id, array['owner'])
  );

-- smoke test
do $$
begin
  assert exists (
    select 1 from information_schema.check_constraints
     where constraint_name = 'source_documents_text_length'
  ), 'text length constraint missing';

  raise notice 'smoke: source_documents table OK';
end$$;
