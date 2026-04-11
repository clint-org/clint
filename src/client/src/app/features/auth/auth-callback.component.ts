import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div class="text-center">
        @if (error()) {
          <i class="fa-solid fa-circle-exclamation mb-3 text-2xl text-red-500"></i>
          <p class="text-sm font-medium text-slate-900">{{ error() }}</p>
          <a
            routerLink="/login"
            class="mt-3 inline-block text-xs text-teal-700 hover:text-teal-800 hover:underline"
          >
            Return to sign in
          </a>
        } @else {
          <div
            class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-teal-200 border-t-teal-600"
            role="status"
            aria-label="Completing sign in"
          ></div>
          <p class="mt-4 text-xs uppercase tracking-wider text-slate-400">Completing sign in</p>
        }
      </div>
    </div>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  error = signal<string | null>(null);

  ngOnInit() {
    // Supabase JS client auto-processes the hash fragment tokens.
    // We just need to wait for onAuthStateChange to fire.
    const {
      data: { subscription },
    } = this.supabase.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        subscription.unsubscribe();
        this.router.navigate(['/']);
      } else if (event === 'SIGNED_OUT') {
        subscription.unsubscribe();
        this.router.navigate(['/login']);
      }
    });

    // Fallback: if already signed in (session exists), redirect immediately
    setTimeout(async () => {
      const { data } = await this.supabase.client.auth.getSession();
      if (data.session) {
        subscription.unsubscribe();
        this.router.navigate(['/']);
      }
    }, 500);

    // Timeout: if nothing happens after 8 seconds, show error
    setTimeout(() => {
      subscription.unsubscribe();
      if (!this.supabase.session()) {
        this.error.set('Sign in timed out. Please try again.');
      }
    }, 8000);
  }
}
