import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { ClintLogoComponent } from '../../shared/components/clint-logo.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ClintLogoComponent],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50">
      <div class="w-full max-w-sm border border-slate-200 bg-white">
        <div class="h-0.5 bg-teal-500"></div>
        <div class="px-8 py-10">
          <div class="flex justify-center">
            <app-clint-logo [size]="48" />
          </div>
          <h1 class="mt-2 text-center text-lg font-semibold tracking-tight text-slate-900">
            Clinical trial intelligence
          </h1>
          <p class="mt-1 text-center text-xs text-slate-500">
            Sign in with your Google account to continue.
          </p>

          @if (error()) {
            <div
              class="mt-6 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              role="alert"
            >
              {{ error() }}
            </div>
          }

          <button
            (click)="signInWithGoogle()"
            [disabled]="loading()"
            class="mt-8 flex w-full items-center justify-center gap-3 border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-teal-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label="Sign in with Google"
          >
            @if (loading()) {
              <svg
                class="h-5 w-5 animate-spin text-slate-500"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  class="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  stroke-width="4"
                ></circle>
                <path
                  class="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                ></path>
              </svg>
              <span>Signing in...</span>
            } @else {
              <svg class="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              <span>Sign in with Google</span>
            }
          </button>
        </div>
      </div>
    </div>
  `,
})
export class LoginComponent implements OnInit {
  private readonly supabaseService = inject(SupabaseService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  async ngOnInit() {
    await this.supabaseService.waitForSession();
    if (this.supabaseService.session()) {
      this.router.navigate(['/']);
    }
  }

  async signInWithGoogle() {
    this.loading.set(true);
    this.error.set(null);

    const { error } = await this.supabaseService.signInWithGoogle();

    if (error) {
      this.error.set(error.message);
      this.loading.set(false);
    }
  }
}
