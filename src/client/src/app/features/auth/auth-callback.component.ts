import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SupabaseService } from '../../core/services/supabase.service';
import { BrandContextService } from '../../core/services/brand-context.service';
import { TenantService } from '../../core/services/tenant.service';

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
            class="mt-3 inline-block text-xs text-brand-700 hover:text-brand-800 hover:underline"
          >
            Return to sign in
          </a>
        } @else {
          <div
            class="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600"
            role="status"
            aria-label="Completing sign in"
          ></div>
          <p class="mt-4 text-xs uppercase tracking-wider text-slate-400">Completing sign in</p>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AuthCallbackComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  private readonly brand = inject(BrandContextService);
  private readonly tenantService = inject(TenantService);
  readonly error = signal<string | null>(null);

  ngOnInit() {
    // Supabase JS client auto-processes the hash fragment tokens.
    // We just need to wait for onAuthStateChange to fire.
    const {
      data: { subscription },
    } = this.supabase.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        subscription.unsubscribe();
        void this.redirectAfterSignIn();
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
        void this.redirectAfterSignIn();
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

  /**
   * Routes the user post-sign-in based on the host brand kind:
   *   - agency host       -> /admin
   *   - super-admin host  -> /super-admin
   *   - tenant host       -> /t/{tenantId}/spaces (brand.id is the tenant uuid)
   *     - if brand.has_self_join is true, attempt self_join_tenant first;
   *       on failure, surface a generic error on the login screen.
   *   - default host      -> /  (marketingLandingGuard takes over from there)
   */
  private async redirectAfterSignIn(): Promise<void> {
    const kind = this.brand.kind();
    const id = this.brand.brand().id;
    switch (kind) {
      case 'agency':
        this.router.navigate(['/admin']);
        return;
      case 'super-admin':
        this.router.navigate(['/super-admin']);
        return;
      case 'tenant':
        if (id) {
          if (this.brand.hasSelfJoin()) {
            // Try self-join. The RPC is idempotent (on conflict do nothing)
            // for users who are already a member, so no pre-check needed.
            // On failure, the RPC raises a generic error; surface it on the
            // login screen via sessionStorage and sign the user out so they
            // can re-attempt or contact the workspace owner.
            const subdomain = window.location.host.split('.')[0];
            try {
              await this.tenantService.selfJoinTenant(subdomain);
            } catch (e: unknown) {
              const msg =
                e instanceof Error ? e.message : 'self-join not available for this workspace';
              try {
                sessionStorage.setItem('login_error', msg);
              } catch {
                // sessionStorage not available; the login screen will just
                // not show a message.
              }
              await this.supabase.signOut();
              this.router.navigate(['/login']);
              return;
            }
          }
          this.router.navigate(['/t', id, 'spaces']);
          return;
        }
        this.router.navigate(['/']);
        return;
      case 'default':
      default:
        this.router.navigate(['/']);
        return;
    }
  }
}
