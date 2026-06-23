import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { environment } from '../../../environments/environment';
import { PublicFooterComponent } from '../../shared/components/public-footer.component';
import { SupabaseService } from '../../core/services/supabase.service';
import { isExistingWorkspace } from './workspace-finder';
import { CLINT_MARK_POINTS, CLINT_MARK_VIEWBOX } from '../../shared/components/clint-mark';

@Component({
  selector: 'app-marketing-landing',
  standalone: true,
  imports: [ButtonModule, InputTextModule, RouterLink, PublicFooterComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <header
        class="sticky top-0 z-50 border-b border-slate-200 bg-slate-50/85 backdrop-blur supports-[backdrop-filter]:bg-slate-50/75"
      >
        <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4 sm:px-10">
          <div class="flex items-center gap-2.5">
            <svg [attr.viewBox]="markViewBox" fill="none" class="h-6 w-6" aria-hidden="true">
              <polyline
                [attr.points]="mark.outer"
                stroke="#cbd5e1"
                stroke-width="4"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                [attr.points]="mark.middle"
                stroke="#94a3b8"
                stroke-width="5.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <polyline
                [attr.points]="mark.inner"
                stroke="var(--p-primary-700, #0f766e)"
                stroke-width="7.5"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class="font-mono text-sm font-semibold uppercase tracking-[0.22em] text-slate-900"
              >Clint</span
            >
          </div>
          <a routerLink="/login" class="text-sm font-medium text-slate-700 hover:text-brand-700"
            >Sign in</a
          >
        </div>
      </header>

      <main class="flex flex-1 items-center justify-center px-6 py-16">
        <div class="flex w-full max-w-[560px] flex-col items-center text-center">
          <p class="font-mono text-xs font-semibold uppercase tracking-[0.18em] text-brand-700">
            Competitive intelligence for pharma
          </p>
          <h1
            class="mt-5 text-balance text-[2.5rem] font-bold leading-[1.08] tracking-[-0.02em] text-slate-900 sm:text-[2.875rem]"
          >
            Every competitor, trial, and catalyst in one living view.
          </h1>
          <p class="mt-5 max-w-[42ch] text-[17px] leading-relaxed text-slate-600">
            Clint assembles the whole competitive landscape, and keeps it current, for the teams who
            make the investment, licensing, and partnership calls.
          </p>

          <div
            class="mt-9 w-full max-w-[480px] rounded-md border border-slate-200 bg-white p-6 text-left shadow-sm"
          >
            <h2 class="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-900">
              Find your workspace
            </h2>
            <p class="mt-1 text-[13.5px] text-slate-500">
              Enter your workspace subdomain to sign in.
            </p>
            <form
              class="mt-4 flex flex-col gap-2.5 sm:flex-row sm:gap-0"
              (submit)="goToWorkspace($event)"
            >
              <div
                class="flex flex-1 items-stretch overflow-hidden rounded border border-slate-300 bg-white sm:rounded-r-none sm:border-r-0"
              >
                <input
                  pInputText
                  type="text"
                  [value]="subdomain()"
                  (input)="onInput($event)"
                  placeholder="your-workspace"
                  class="h-12 min-w-0 flex-1 border-0 bg-transparent px-3.5 text-sm focus:outline-none"
                  aria-label="Workspace subdomain"
                />
                <span
                  class="flex items-center border-l border-slate-200 bg-slate-50 px-3 font-mono text-[13px] text-slate-500"
                >
                  .{{ apexDisplay }}
                </span>
              </div>
              <p-button
                label="Open workspace"
                styleClass="h-12 w-full justify-center sm:w-auto sm:rounded-l-none"
                [disabled]="!subdomain() || checking()"
                [loading]="checking()"
                type="submit"
              />
            </form>
            @if (errorMessage()) {
              <p class="mt-3 text-xs text-red-700" role="alert">{{ errorMessage() }}</p>
            }
            <p class="mt-5 text-sm text-slate-500">
              Are you a consulting partner?
              <a
                routerLink="/login"
                class="text-slate-700 underline underline-offset-2 hover:text-brand-700"
                >Sign in to your agency portal.</a
              >
            </p>
          </div>
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
  protected readonly mark = CLINT_MARK_POINTS;
  protected readonly markViewBox = CLINT_MARK_VIEWBOX;

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
