import { Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50">
      <div class="text-center">
        @if (error()) {
          <i class="fa-solid fa-circle-exclamation text-3xl text-red-400 mb-4"></i>
          <p class="mt-4 text-slate-700 font-medium">{{ error() }}</p>
          <a
            routerLink="/login"
            class="mt-4 inline-block text-sm text-teal-600 hover:text-teal-700 underline"
          >
            Return to login
          </a>
        } @else {
          <div
            class="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600"
            role="status"
            aria-label="Completing sign in"
          ></div>
          <p class="mt-4 text-slate-600">Completing sign in...</p>
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
