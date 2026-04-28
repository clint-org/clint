-- migration: 20260428041000_whitelabel_rls_retired_hostnames
-- purpose: rls for retired_hostnames. only platform admins can read; nobody
--   can insert/update/delete via the api (writes happen via the retirement
--   triggers, which run security definer).

create policy "platform admins can read retired hostnames"
on public.retired_hostnames for select to authenticated
using ( public.is_platform_admin() );

-- no insert/update/delete policies; trigger writes via security definer bypass rls.
