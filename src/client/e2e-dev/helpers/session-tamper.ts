/**
 * Build TAMPERED sb-auth-dev cookies for browser-layer security specs by
 * mutating the value produced by sessionCookie() (helpers/auth-cookie.ts). This
 * keeps the cookie name / domain / encoding identical to a real session cookie
 * and only corrupts the payload, so the test exercises the app's real read path
 * (createCookieStorage.getItem -> decodeURIComponent -> supabase-js JSON.parse).
 */
import type { Cookie } from '@playwright/test';
import { sessionCookie } from './auth-cookie';
import { userFor, type RoleName, type ScratchWorld } from './scratch-world';

/**
 * A sb-auth-dev cookie whose encoded JSON payload is truncated, so the storage
 * adapter's JSON.parse throws and supabase-js resolves NO session. The cookie
 * name/domain/path/secure flags stay valid so the browser still sends it.
 */
export function corruptedSessionCookie(world: ScratchWorld, role: RoleName): Cookie {
  const good = sessionCookie(userFor(world, role).session);
  // Halve the encoded value -> invalid percent-encoding / truncated JSON.
  return { ...good, value: good.value.slice(0, Math.floor(good.value.length / 2)) };
}

/**
 * A sb-auth-dev cookie carrying a structurally-valid but EXPIRED session with a
 * bogus refresh token: supabase-js sees expires_at in the past, attempts a
 * refresh, the refresh fails, and the session resolves to null.
 */
export function expiredSessionCookie(world: ScratchWorld, role: RoleName): Cookie {
  const real = userFor(world, role).session;
  const expired = {
    ...real,
    expires_at: 1, // 1970 -> already expired
    expires_in: -3600,
    refresh_token: 'pwreg-invalid-refresh-token',
  };
  const good = sessionCookie(real);
  return { ...good, value: encodeURIComponent(JSON.stringify(expired)) };
}
