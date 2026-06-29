-- WS1 materials durability: distinguish intentionally-fileless materials
-- (seed/demo/playground) from genuine danglers so the weekly reconcile job
-- stops flagging hundreds of seed rows. See
-- docs/superpowers/specs/2026-06-28-materials-sample-reconciliation-design.md.
--
-- The live upload path writes the canonical key <space>/<material>/<file> with
-- no prefix. Only seed and playground inserts use a 'materials/' prefix, so the
-- prefix is a reliable marker: a before-insert trigger flags such rows as
-- samples and strips the prefix; a one-time backfill fixes existing rows.

alter table public.materials
  add column if not exists is_sample boolean not null default false;

comment on column public.materials.is_sample is
  'True for intentionally-fileless materials (seed/demo/playground) that have no '
  'backing R2 object. Set automatically by normalize_sample_material() when '
  'file_path carries the legacy materials/ prefix, or explicitly by a seed. '
  'Excluded from the reconcile dangling check.';

-- One-time backfill: flag and normalize existing seed rows.
update public.materials
set is_sample = true,
    file_path = regexp_replace(file_path, '^materials/', '')
where file_path like 'materials/%';

-- Normalizing trigger: a materials/-prefixed insert is a sample; flag it and
-- strip the prefix to the canonical key. A seed wanting a sample without the
-- prefix should set is_sample = true explicitly.
create or replace function public.normalize_sample_material()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.file_path like 'materials/%' then
    new.is_sample := true;
    new.file_path := regexp_replace(new.file_path, '^materials/', '');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_materials_normalize_sample on public.materials;
create trigger trg_materials_normalize_sample
  before insert on public.materials
  for each row execute function public.normalize_sample_material();

-- In-migration smoke: assert backfill and trigger behavior. The do-blocks raise
-- and abort the migration on any violation, so a clean apply is the pass signal.
do $$
declare
  v_remaining int;
  v_agency uuid := gen_random_uuid();
  v_tenant uuid := gen_random_uuid();
  v_space uuid := gen_random_uuid();
  v_user uuid := gen_random_uuid();
  v_sub text := 's' || substr(replace(v_agency::text, '-', ''), 1, 12);
  v_tsub text := 't' || substr(replace(v_tenant::text, '-', ''), 1, 12);
  v_prefixed_id uuid;
  v_plain_id uuid;
  v_is_sample boolean;
  v_path text;
begin
  -- backfill left no prefixed paths behind
  select count(*) into v_remaining
  from public.materials where file_path like 'materials/%';
  if v_remaining <> 0 then
    raise exception 'smoke: % materials still carry a materials/ prefix', v_remaining;
  end if;

  -- bootstrap a synthetic agency -> tenant -> space -> user so the materials
  -- FKs (space_id -> spaces, uploaded_by -> auth.users) hold. Mirrors the
  -- r2-cutover invariant test. Unique slugs/subdomains avoid collisions.
  insert into auth.users (id, email)
    values (v_user, 'is-sample-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'is-sample smoke', v_sub, v_sub, 'X', 'x@invalid.local');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'T', v_tsub, v_tsub, 'X');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'S', v_user);

  -- trigger flags + strips a prefixed insert
  insert into public.materials (space_id, uploaded_by, file_path, file_name,
    file_size_bytes, mime_type, material_type, title)
  values (v_space, v_user, 'materials/' || v_space::text || '/m1/x.pdf', 'x.pdf',
    1, 'application/pdf', 'briefing', 'S')
  returning id, is_sample, file_path into v_prefixed_id, v_is_sample, v_path;
  if not v_is_sample then
    raise exception 'smoke: prefixed insert was not flagged is_sample';
  end if;
  if v_path <> v_space::text || '/m1/x.pdf' then
    raise exception 'smoke: prefix not stripped, got %', v_path;
  end if;

  -- a no-prefix insert is untouched
  insert into public.materials (space_id, uploaded_by, file_path, file_name,
    file_size_bytes, mime_type, material_type, title)
  values (v_space, v_user, v_space::text || '/m2/y.pdf', 'y.pdf',
    1, 'application/pdf', 'briefing', 'P')
  returning id, is_sample, file_path into v_plain_id, v_is_sample, v_path;
  if v_is_sample then
    raise exception 'smoke: no-prefix insert was wrongly flagged is_sample';
  end if;
  if v_path <> v_space::text || '/m2/y.pdf' then
    raise exception 'smoke: no-prefix path was altered, got %', v_path;
  end if;

  -- cleanup in reverse FK order
  delete from public.materials where id in (v_prefixed_id, v_plain_id);
  delete from public.spaces where id = v_space;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_user;
end;
$$;
