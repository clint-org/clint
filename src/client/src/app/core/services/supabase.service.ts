import { Injectable, signal } from '@angular/core';
import { createClient, SupabaseClient, Session, User } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  private readonly supabase: SupabaseClient;

  readonly currentUser = signal<User | null>(null);
  readonly session = signal<Session | null>(null);

  private sessionReady: Promise<void>;

  constructor() {
    this.supabase = createClient(environment.supabaseUrl, environment.supabaseAnonKey);

    this.sessionReady = this.supabase.auth.getSession().then(({ data }) => {
      this.session.set(data.session);
      this.currentUser.set(data.session?.user ?? null);
    });

    this.supabase.auth.onAuthStateChange((_event, session) => {
      this.session.set(session);
      this.currentUser.set(session?.user ?? null);
    });
  }

  waitForSession(): Promise<void> {
    return this.sessionReady;
  }

  get client(): SupabaseClient {
    return this.supabase;
  }

  signInWithGoogle() {
    return this.supabase.auth.signInWithOAuth({ provider: 'google' });
  }

  signOut() {
    return this.supabase.auth.signOut();
  }
}
