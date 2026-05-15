import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { SupabaseService } from '../../core/services/supabase.service';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ClintLogoComponent } from '../../shared/components/clint-logo.component';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ClintLogoComponent, NgOptimizedImage],
  template: `
    <div class="flex min-h-screen items-center justify-center bg-slate-50">
      <div class="w-full max-w-sm border border-slate-200 bg-white">
        <div class="h-0.5 bg-brand-500"></div>
        <div class="px-8 py-10">
          <!--
            Tenant hosts provisioned by an agency lead with the tenant
            (workspace) identity at top -- that's who the user signs in
            to -- and credit the agency at the bottom in a small "delivered
            by" footer with their logo. The workspace is the foreground;
            the provider is the provenance. Tenants without an agency,
            agencies, super-admin, and the default host all use the
            simpler "Sign in to {appName}" layout.
          -->
          @if (kind() === 'tenant' && agency()) {
            <div class="flex justify-center">
              @if (logoUrl()) {
                <img
                  [ngSrc]="logoUrl()!"
                  [alt]="appName() + ' logo'"
                  width="192"
                  height="48"
                  priority
                  class="h-12 w-auto object-contain"
                />
              } @else {
                <app-clint-logo [size]="48" />
              }
            </div>
            <h1 class="mt-3 text-center text-lg font-semibold tracking-tight text-slate-900">
              Sign in to the {{ appName() }} workspace
            </h1>
            <p class="mt-1 text-center text-xs text-slate-500">Choose a sign-in method below.</p>
          } @else {
            <div class="flex justify-center">
              @if (logoUrl()) {
                <img
                  [ngSrc]="logoUrl()!"
                  [alt]="appName() + ' logo'"
                  width="192"
                  height="48"
                  priority
                  class="h-12 w-auto object-contain"
                />
              } @else {
                <app-clint-logo [size]="48" />
              }
            </div>
            <h1 class="mt-2 text-center text-lg font-semibold tracking-tight text-slate-900">
              Sign in to {{ appName() }}
            </h1>
            @if (workspaceHint()) {
              <p class="mt-1 text-center text-xs text-slate-500">
                Signing in to <span class="font-medium text-slate-700">{{ workspaceHint() }}</span>
              </p>
            } @else {
              <p class="mt-1 text-center text-xs text-slate-500">Choose a sign-in method below.</p>
            }
          }

          @if (error()) {
            <div
              class="mt-6 border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700"
              role="alert"
            >
              {{ error() }}
            </div>
          }

          <div class="mt-8 flex flex-col gap-3">
            @for (provider of authProviders(); track provider) {
              @switch (provider) {
                @case ('google') {
                  <button
                    (click)="signIn('google')"
                    [disabled]="loading()"
                    class="flex w-full items-center justify-center gap-3 border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Sign in with Google"
                  >
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
                    <span>{{
                      loading() === 'google' ? 'Signing in...' : 'Sign in with Google'
                    }}</span>
                  </button>
                }
                @case ('microsoft') {
                  <button
                    (click)="signIn('microsoft')"
                    [disabled]="loading()"
                    class="flex w-full items-center justify-center gap-3 border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:border-brand-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Sign in with Microsoft"
                  >
                    <svg class="h-5 w-5" viewBox="0 0 23 23" aria-hidden="true">
                      <rect x="1" y="1" width="10" height="10" fill="#F35325" />
                      <rect x="12" y="1" width="10" height="10" fill="#81BC06" />
                      <rect x="1" y="12" width="10" height="10" fill="#05A6F0" />
                      <rect x="12" y="12" width="10" height="10" fill="#FFBA08" />
                    </svg>
                    <span>{{
                      loading() === 'microsoft' ? 'Signing in...' : 'Sign in with Microsoft'
                    }}</span>
                  </button>
                }
              }
            }
          </div>

          @if (hasSelfJoin()) {
            <p class="mt-4 text-center text-xs leading-relaxed text-slate-500">
              Sign in with your work email. If you don't have an account yet, one is created
              automatically.
            </p>
          }
        </div>

        <!--
          Agency attribution footer -- shown only on tenant hosts that
          were provisioned by an agency. Establishes "delivered by" without
          competing with the workspace identity above.
        -->
        @if (kind() === 'tenant' && agency(); as ag) {
          <div
            class="flex flex-col items-center gap-2 border-t border-slate-200 px-8 py-5 bg-slate-50/60"
          >
            <p class="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              Competitive intelligence by
            </p>
            @if (ag.logo_url) {
              <img
                [ngSrc]="ag.logo_url"
                [alt]="ag.name + ' logo'"
                width="140"
                height="28"
                class="h-7 w-auto max-w-[140px] object-contain"
              />
            } @else {
              <span class="text-sm font-semibold tracking-tight text-slate-700">{{ ag.name }}</span>
            }
          </div>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent implements OnInit {
  private readonly supabaseService = inject(SupabaseService);
  private readonly brand = inject(BrandContextService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal<'google' | 'microsoft' | null>(null);
  readonly error = signal<string | null>(null);
  /** Sanitized `?workspace=` value -- only set when host is the apex (kind === 'default'). */
  readonly workspaceParam = signal<string | null>(null);

  protected readonly logoUrl = this.brand.logoUrl;
  protected readonly appName = this.brand.appDisplayName;
  protected readonly authProviders = this.brand.authProviders;
  protected readonly hasSelfJoin = this.brand.hasSelfJoin;
  protected readonly kind = this.brand.kind;
  protected readonly agency = this.brand.agency;

  /** Display string for the workspace hint (e.g. `acme.yourproduct.com`). */
  protected readonly workspaceHint = computed(() => {
    const sub = this.workspaceParam();
    if (!sub) return null;
    const apex = environment.apexDomain || 'yourproduct.com';
    return `${sub}.${apex}`;
  });

  async ngOnInit() {
    // Surface a self-join failure stashed by the auth-callback flow. The
    // RPC returns a single generic message for every failure mode (allowlist
    // mismatch, suspended tenant, missing tenant, etc.) to prevent
    // enumeration -- so we just display whatever was stored.
    try {
      const stored = sessionStorage.getItem('login_error');
      if (stored) {
        this.error.set(stored);
        sessionStorage.removeItem('login_error');
      }
    } catch {
      // sessionStorage unavailable; nothing to surface.
    }

    // Workspace hint: only meaningful on the apex host (default brand). On
    // tenant/agency/super-admin hosts the host already implies the workspace,
    // so an inbound `?workspace=` param is ignored to avoid a misleading hint.
    if (this.brand.kind() === 'default') {
      const raw = this.route.snapshot.queryParamMap.get('workspace');
      if (raw) {
        const sanitized = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
        if (/^[a-z][a-z0-9-]{1,62}$/.test(sanitized)) {
          this.workspaceParam.set(sanitized);
        }
      }
    }

    await this.supabaseService.waitForSession();
    if (this.supabaseService.session()) {
      this.router.navigate(['/']);
    }
  }

  async signIn(provider: 'google' | 'microsoft') {
    this.loading.set(provider);
    this.error.set(null);
    const { error } =
      provider === 'google'
        ? await this.supabaseService.signInWithGoogle()
        : await this.supabaseService.signInWithMicrosoft();
    if (error) {
      this.error.set(error.message);
      this.loading.set(null);
    }
  }
}
