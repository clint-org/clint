import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { environment } from '../../../environments/environment';
import { PublicFooterComponent } from '../../shared/components/public-footer.component';
import { SupabaseService } from '../../core/services/supabase.service';
import { isExistingWorkspace } from './workspace-finder';

@Component({
  selector: 'app-marketing-landing',
  standalone: true,
  imports: [ButtonModule, InputTextModule, RouterLink, PublicFooterComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div class="flex items-center gap-2.5">
            <svg viewBox="0 0 140 140" fill="none" class="h-6 w-6" aria-hidden="true">
              <polyline
                points="112,24 24,24 24,116 112,116"
                stroke="#cbd5e1"
                stroke-width="4"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                points="96,40 40,40 40,100 96,100"
                stroke="#94a3b8"
                stroke-width="5.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                points="80,56 56,56 56,84 80,84"
                stroke="var(--p-primary-700, #0f766e)"
                stroke-width="7.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="text-sm font-semibold tracking-[0.22em] text-slate-900">CLINT</span>
          </div>
          <a routerLink="/login" class="text-sm text-slate-600 hover:text-slate-900">Sign in</a>
        </div>
      </header>

      <main class="flex flex-1 items-center justify-center px-6 py-16">
        <div class="w-full max-w-md">
          <div class="flex flex-col items-center text-center">
            <svg viewBox="0 0 140 140" fill="none" class="h-14 w-14" aria-hidden="true">
              <polyline
                points="112,24 24,24 24,116 112,116"
                stroke="#cbd5e1"
                stroke-width="4"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                points="96,40 40,40 40,100 96,100"
                stroke="#94a3b8"
                stroke-width="5.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                points="80,56 56,56 56,84 80,84"
                stroke="var(--p-primary-700, #0f766e)"
                stroke-width="7.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <h1 class="mt-5 text-2xl font-semibold tracking-tight text-slate-900">Clint</h1>
            <p class="mt-2 font-mono text-xs uppercase tracking-[0.16em] text-brand-700">
              Competitive intelligence for pharma
            </p>
          </div>

          <div class="mt-12 border border-slate-200 bg-white p-6">
            <h2 class="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-slate-900">
              Find your workspace
            </h2>
            <p class="mt-1 text-xs text-slate-500">Enter your workspace subdomain to sign in.</p>
            <form class="mt-4 flex flex-col gap-2 sm:flex-row" (submit)="goToWorkspace($event)">
              <div class="flex flex-1 items-stretch border border-slate-300 bg-white">
                <input
                  pInputText
                  type="text"
                  [value]="subdomain()"
                  (input)="onInput($event)"
                  placeholder="your-workspace"
                  class="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm focus:outline-none"
                  aria-label="Workspace subdomain"
                />
                <span
                  class="border-l border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500"
                >
                  .{{ apexDisplay }}
                </span>
              </div>
              <p-button
                label="Go"
                styleClass="w-full sm:w-auto"
                [disabled]="!subdomain() || checking()"
                [loading]="checking()"
                type="submit"
              />
            </form>
            @if (errorMessage()) {
              <p class="mt-3 text-xs text-red-700" role="alert">{{ errorMessage() }}</p>
            }
          </div>

          <p class="mt-8 text-center text-xs text-slate-500">
            Are you a consulting partner?
            <a routerLink="/login" class="underline hover:text-slate-700"
              >Sign in to your agency portal.</a
            >
          </p>
        </div>
      </main>
      <app-public-footer />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarketingLandingComponent {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);

  readonly subdomain = signal<string>('');
  readonly errorMessage = signal<string | null>(null);
  readonly checking = signal<boolean>(false);

  protected readonly apexDisplay = environment.apexDomain || 'yourproduct.com';

  onInput(e: Event) {
    const v = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    this.subdomain.set(v);
    this.errorMessage.set(null);
  }

  async goToWorkspace(e: Event) {
    e.preventDefault();
    if (this.checking()) return;
    const sub = this.subdomain().trim();
    if (!sub || !/^[a-z][a-z0-9-]{1,62}$/.test(sub)) {
      this.errorMessage.set(
        'Subdomain must be lowercase letters, numbers, or hyphens, and start with a letter.'
      );
      return;
    }

    // Local dev (no apex) keeps the old behavior: there is no per-subdomain host
    // to verify against, so route to the shared login.
    if (!environment.apexDomain) {
      this.router.navigate(['/login'], { queryParams: { workspace: sub } });
      return;
    }

    const host = `${sub}.${environment.apexDomain}`;
    const target = `${window.location.protocol}//${host}/login`;
    this.errorMessage.set(null);
    this.checking.set(true);
    try {
      const { data, error } = await this.supabase.client.rpc('get_brand_by_host', {
        p_host: host,
      });
      if (error) throw error;
      if (isExistingWorkspace(data as { kind?: string } | null)) {
        window.location.href = target; // navigating away; leave the checking state set
        return;
      }
      this.errorMessage.set(
        `We couldn't find a workspace at ${host}. Check the spelling, or ask your administrator for the link.`
      );
      this.checking.set(false);
    } catch {
      // Fail open: if we can't verify the workspace (network/unexpected), fall
      // back to the redirect so a flaky lookup never blocks a real user.
      window.location.href = target;
    }
  }
}
