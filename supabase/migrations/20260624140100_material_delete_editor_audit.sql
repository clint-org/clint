-- migration: 20260624140100_material_delete_editor_audit
-- purpose: let any space editor/owner delete a material (not just the
--   uploader), and audit the delete.
--
-- Before this migration delete_material rejected non-uploaders
-- (uploaded_by <> auth.uid()) and recorded no audit event. The materials
-- DELETE RLS policy was likewise uploader-only. Materials are shared
-- engagement artifacts: any editor/owner on the space should be able to
-- remove one, and the removal should leave an audit trail.
--
-- delete_material is NOT marked @audit:tier1 -- material delete is not in
-- the Tier-1 governance set (provisioning / branding / access / membership /
-- invites / custom domains / space lifecycle / platform-admin grants). It is
-- audited for content-history visibility, mirroring the GUC + scope-resolution
-- pattern from 20260510001300_audit_instrument_invites.sql.

-- =============================================================================
-- delete_material: drop the uploader-only gate, keep owner/editor access,
-- audit the delete. Based on the current (r2-queue) definition in
-- 20260521120000_r2_pending_deletes_queue.sql; the AFTER DELETE trigger that
-- enqueues r2_pending_deletes is unaffected.
-- =============================================================================

create or replace function public.delete_material(
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       record;
  v_tenant_id uuid;
  v_agency_id uuid;
  v_actor_role text;
begin
  select m.id, m.space_id, m.uploaded_by, m.title, m.material_type
    into v_row
  from public.materials m
  where m.id = p_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  -- Any editor/owner on the containing space may delete (uploader identity
  -- no longer matters). has_space_access requires an explicit space_members
  -- row at owner/editor -- there is no implicit agency/tenant cascade.
  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Resolve audit scope: space -> tenant -> agency.
  select s.tenant_id, t.agency_id
    into v_tenant_id, v_agency_id
  from public.spaces s
  join public.tenants t on t.id = s.tenant_id
  where s.id = v_row.space_id;

  -- Actor's space role for the audit trail. In practice the gate above
  -- guarantees an owner/editor space_members row; the coalesce is a
  -- defensive fallback only.
  select role into v_actor_role
  from public.space_members
  where space_id = v_row.space_id and user_id = auth.uid();
  v_actor_role := coalesce(v_actor_role, 'space_member');

  delete from public.materials where id = p_id;

  perform set_config('audit.actor_role', v_actor_role, true);
  perform set_config('audit.rpc_name', 'delete_material', true);
  perform public.record_audit_event(
    'material.deleted', 'rpc', 'material', v_row.id,
    v_agency_id, v_tenant_id, v_row.space_id,
    jsonb_build_object(
      'title', v_row.title,
      'material_type', v_row.material_type,
      'uploaded_by', v_row.uploaded_by
    )
  );

  -- the AFTER DELETE trigger _enqueue_r2_delete_on_materials enqueues
  -- the file_path into public.r2_pending_deletes; the cloudflare worker
  -- removes the object asynchronously.
  return jsonb_build_object(
    'material_id', v_row.id
  );
end;
$$;

revoke execute on function public.delete_material(uuid) from public, anon;
grant  execute on function public.delete_material(uuid) to authenticated;

comment on function public.delete_material(uuid) is
  'Hard-deletes a material row. Any space editor/owner may delete -- the '
  'uploader-only gate was dropped. Writes a '
  '''material.deleted'' audit event with space/tenant/agency scope. The '
  'AFTER DELETE trigger enqueues the file into public.r2_pending_deletes for '
  'the cloudflare worker. Return shape is { material_id }.';

-- =============================================================================
-- RLS: relax the materials DELETE policy to any editor/owner (defense in
-- depth; the RPC is the sanctioned path but the table policy should agree).
-- =============================================================================

drop policy if exists "materials delete" on public.materials;
create policy "materials delete"
on public.materials for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

notify pgrst, 'reload schema';
