import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50">
      <div class="text-center">
        <div
          class="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-teal-200 border-t-teal-600"
          role="status"
          aria-label="Completing sign in"
        ></div>
        <p class="mt-4 text-slate-600">Completing sign in...</p>
      </div>
    </div>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly supabaseService = inject(SupabaseService);

  async ngOnInit() {
    // Wait for Supabase to process the OAuth tokens from the URL hash
    const { data, error } = await this.supabaseService.client.auth.getSession();

    if (error || !data.session) {
      // If no session yet, listen for the auth state change (token exchange)
      const { data: { subscription } } = this.supabaseService.client.auth.onAuthStateChange((event, session) => {
        subscription.unsubscribe();
        if (session) {
          this.router.navigate(['/']);
        } else {
          this.router.navigate(['/login']);
        }
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        subscription.unsubscribe();
        if (!this.supabaseService.session()) {
          this.router.navigate(['/login']);
        }
      }, 5000);
    } else {
      await this.router.navigate(['/']);
    }
  }
}
