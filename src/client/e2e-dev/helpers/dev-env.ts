/**
 * Environment + constants for the dev-targeted regression suite.
 *
 * The suite runs against the DEPLOYED dev stack (dev.clintapp.com), not local.
 * Only ONE secret is required: SUPABASE_DEV_DB_POOLER_URL (write-capable Postgres),
 * injected from Infisical (env dev, path /supabase). The Supabase URL and anon key
 * are public (they ship in src/environments/environment.dev.ts) and are mirrored
 * here with env overrides so the suite needs no service-role key or JWT secret.
 *
 * See docs/notes/dev-regression-suite.md for the run model and rationale.
 */

/** Public dev values (mirror src/environments/environment.dev.ts). */
export const DEV_SUPABASE_URL =
  process.env['DEV_SUPABASE_URL'] ?? 'https://aiawpfmiadyoulcambxs.supabase.co';
export const DEV_SUPABASE_ANON_KEY =
  process.env['DEV_SUPABASE_ANON_KEY'] ?? 'sb_publishable__TbUipHpkEbKiGkeI2hcjA_SFuaKASk';

/** Apex used for cross-subdomain cookie auth on dev. */
export const DEV_APEX = process.env['DEV_APEX'] ?? 'dev.clintapp.com';

/**
 * Auth cookie key for env 'dev' -- mirrors authStorageKey('dev') in
 * src/app/core/util/auth-storage-key.ts. The app reads this cookie because the
 * scratch host is `*.dev.clintapp.com` (apex cookie storage in supabase.service.ts).
 */
export const DEV_AUTH_COOKIE_KEY = `sb-auth-${'dev'}`;

/** Subdomain prefix for scratch entities (reserved-subdomain-safe). */
export const SCRATCH_PREFIX = 'pwreg';

/** Write-capable Postgres pooler URL (the only required secret). */
export function requirePoolerUrl(): string {
  const url = process.env['SUPABASE_DEV_DB_POOLER_URL'];
  if (!url) {
    throw new Error(
      'SUPABASE_DEV_DB_POOLER_URL is not set. Run the suite via e2e-dev/run.sh, ' +
        'which wraps the command in `infisical run --env dev --path /supabase`.'
    );
  }
  return url;
}
