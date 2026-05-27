-- migration: 20260525100300_add_source_doc_provenance
-- purpose: add source_doc_id FK on entity tables so every row created via
--          source-import carries provenance. nullable, ON DELETE SET NULL
--          so deleting a source document does not cascade-delete entity rows.

alter table public.companies
  add column if not exists source_doc_id uuid
  references public.source_documents(id) on delete set null;

alter table public.assets
  add column if not exists source_doc_id uuid
  references public.source_documents(id) on delete set null;

alter table public.trials
  add column if not exists source_doc_id uuid
  references public.source_documents(id) on delete set null;

alter table public.markers
  add column if not exists source_doc_id uuid
  references public.source_documents(id) on delete set null;

alter table public.events
  add column if not exists source_doc_id uuid
  references public.source_documents(id) on delete set null;

-- smoke test
do $$
begin
  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'companies' and column_name = 'source_doc_id'
  ), 'companies.source_doc_id missing';

  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'assets' and column_name = 'source_doc_id'
  ), 'assets.source_doc_id missing';

  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'trials' and column_name = 'source_doc_id'
  ), 'trials.source_doc_id missing';

  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'markers' and column_name = 'source_doc_id'
  ), 'markers.source_doc_id missing';

  assert exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'events' and column_name = 'source_doc_id'
  ), 'events.source_doc_id missing';

  raise notice 'smoke: source_doc_id provenance columns OK';
end$$;
