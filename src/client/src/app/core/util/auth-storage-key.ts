import type { EnvName } from '../../../environments/environment.type';

/**
 * Cookie storage key for the Supabase auth session, scoped per environment.
 *
 * Production keeps the legacy `sb-auth` key: it is the established
 * cross-subdomain SSO cookie (shared across every `*.clintapp.com` tenant) and
 * renaming it would sign every production user out for no benefit.
 *
 * Non-production environments get an env-suffixed key. The production cookie is
 * written with `Domain=.clintapp.com`, so the browser also sends it to child
 * subdomains like `dev.clintapp.com`. Without a distinct key, the dev client
 * would read that production-issued token and loop trying to refresh it against
 * a different Supabase project (the auth retry storm). A scoped key means the
 * dev client only ever reads a cookie it owns.
 */
export function authStorageKey(envName: EnvName): string {
  return envName === 'production' ? 'sb-auth' : `sb-auth-${envName}`;
}
