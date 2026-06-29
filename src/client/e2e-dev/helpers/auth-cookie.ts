/**
 * Build the Playwright cookie that injects a Supabase session into the dev app.
 *
 * The app stores the session under `sb-auth-dev` as the raw JSON string passed
 * through encodeURIComponent (see createCookieStorage in
 * src/app/core/util/cookie-session-storage.ts: it decodeURIComponent's on read).
 * A typical session is ~2.3KB encoded -> single cookie (the app only chunks on
 * WRITE above 3000 bytes; its READ path returns any single non-chunked value).
 */

import type { Session } from '@supabase/supabase-js';
import type { Cookie } from '@playwright/test';
import { DEV_APEX, DEV_AUTH_COOKIE_KEY } from './dev-env';

export function sessionCookie(session: Session): Cookie {
  return {
    name: DEV_AUTH_COOKIE_KEY,
    value: encodeURIComponent(JSON.stringify(session)),
    domain: '.' + DEV_APEX,
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: true,
    sameSite: 'Lax',
  };
}
