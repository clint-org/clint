import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';

@Component({
  selector: 'app-auth-callback',
  standalone: true,
  template: `
    <div class="flex min-h-screen items-center justify-center bg-gray-50">
      <div class="text-center">
        <svg
          class="mx-auto h-8 w-8 animate-spin text-blue-600"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
        </svg>
        <p class="mt-4 text-gray-600">Completing sign in...</p>
      </div>
    </div>
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly supabaseService = inject(SupabaseService);

  async ngOnInit() {
    const { data } = await this.supabaseService.client.auth.getSession();

    if (data.session) {
      await this.router.navigate(['/']);
    } else {
      await this.router.navigate(['/login']);
    }
  }
}
