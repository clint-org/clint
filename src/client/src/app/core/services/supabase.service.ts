import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';
import { createCookieStorage } from '../util/cookie-session-storage';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly supabase: SupabaseClient;

  readonly currentUser = signal<User | null>(null);
  readonly session = signal<Session | null>(null);

  private sessionReady: Promise<void>;

  constructor() {
    const authConfig = this.buildAuthConfig();
    this.supabase = createClient(
      environment.supabaseUrl,
      environment.supabaseAnonKey,
      authConfig ? { auth: authConfig } : undefined
    );

    this.sessionReady = this.supabase.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      this.currentUser.set(data.session?.user ?? null);
    });

    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.currentUser.set(session?.user ?? null);
    });
  }

  /**
   * Returns Supabase auth config with a cookie-storage adapter when:
   *   - `environment.apexDomain` is configured (non-empty), AND
   *   - the current host is on that apex (e.g. `tenant.yourproduct.com` for apex `yourproduct.com`).
   *
   * Otherwise returns `undefined` so Supabase JS uses its default localStorage path.
   * This preserves existing behavior in dev (`localhost`) and on custom tenant domains
   * that don't share the apex.
   */
  private buildAuthConfig() {
    const apex = environment.apexDomain;
    if (!apex) return undefined;
    const host = window.location.host;
    const onApex = host === apex || host.endsWith('.' + apex);
    if (!onApex) return undefined;
    return {
      storage: createCookieStorage({
        domain: '.' + apex,
        secure: window.location.protocol === 'https:',
        sameSite: 'lax' as const,
        path: '/',
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
      storageKey: 'sb-auth',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
    };
  }

  waitForSession(): Promise<void> {
    return this.sessionReady;
  }

  get client(): SupabaseClient {
    return this.supabase;
  }

  signInWithGoogle() {
    return this.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
  }

  signOut() {
    return this.supabase.auth.signOut();
  }
}
