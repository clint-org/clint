-- migration: 20260503020000_get_marker_history_security_definer
-- purpose: convert public.get_marker_history(uuid) to SECURITY DEFINER.
--   The original definition in 20260502120800_change_feed_surface_rpcs.sql
--   declared the function SECURITY INVOKER, but its body joins auth.users
--   to project the author email -- and the `authenticated` role has no
--   SELECT grant on auth.users. Every real call from the marker-detail
--   panel therefore raised `permission denied for table users`, which the
--   frontend swallowed and rendered as "No history recorded."
--
--   The smoke test in the original migration exercised the function as the
--   `postgres` superuser (bypassing the grant), so the regression never
--   surfaced in CI.
--
--   Switching to SECURITY DEFINER is safe because the function already gates
--   on `public.has_space_access(v_space_id)` before returning any rows;
--   non-members get errcode 42501 and the marker never leaks. This mirrors
--   how `get_activity_feed` and `get_trial_activity` (sister RPCs in the
--   same migration) handle the same access pattern.

create or replace function public.get_marker_history(p_marker_id uuid)
returns setof jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id
    from public.marker_changes
   where marker_id = p_marker_id
   limit 1;

  if v_space_id is null then
    return;
  end if;

  if not public.has_space_access(v_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select jsonb_build_object(
      'id',                mc.id,
      'marker_id',         mc.marker_id,
      'change_type',       mc.change_type,
      'old_values',        mc.old_values,
      'new_values',        mc.new_values,
      'changed_at',        mc.changed_at,
      'changed_by_email',  u.email
    )
      from public.marker_changes mc
      left join auth.users u on u.id = mc.changed_by
     where mc.marker_id = p_marker_id
     order by mc.changed_at desc, mc.id desc;
end;
$function$;

revoke execute on function public.get_marker_history(uuid) from public;
grant  execute on function public.get_marker_history(uuid) to authenticated;

comment on function public.get_marker_history(uuid) is
  'Full marker_changes audit log for one marker, joined to author email. Survives marker deletion (marker_id is not FK-protected). SECURITY DEFINER (auth.users join requires elevated perms); access is gated on has_space_access -- 42501 raised for non-members.';

-- =============================================================================
-- Static smoke: confirm the function is now SECURITY DEFINER (prosecdef = t).
-- A runtime test would need scratch fixtures; the failure mode here is
-- mechanical (declaration attribute), so the static check is sufficient.
-- =============================================================================
do $$
declare
  v_secdef boolean;
begin
  select p.prosecdef into v_secdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_marker_history';

  if v_secdef is null then
    raise exception 'get_marker_history smoke FAIL: function not found';
  end if;
  if not v_secdef then
    raise exception 'get_marker_history smoke FAIL: still SECURITY INVOKER';
  end if;
  raise notice 'get_marker_history SECURITY DEFINER smoke test: PASS';
end $$;
