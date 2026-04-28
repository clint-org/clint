import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { environment } from '../../../environments/environment';

/**
 * Placeholder marketing landing shown to unauthenticated visitors hitting the
 * apex domain (BrandContext.kind() === 'default'). The "Find your workspace"
 * form redirects to the chosen subdomain's /login when an apexDomain is
 * configured, or routes within the same host with a ?workspace= hint in dev.
 *
 * This is a placeholder -- a polished marketing site, signup, and demo-request
 * funnels are out of scope for the whitelabel rollout.
 */
@Component({
  selector: 'app-marketing-landing',
  standalone: true,
  imports: [ButtonModule, InputTextModule, RouterLink],
  template: `
    <div class="min-h-screen bg-slate-50">
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div class="text-sm font-semibold tracking-wider text-slate-900">CLINT</div>
          <a routerLink="/login" class="text-sm text-slate-600 hover:text-slate-900">Sign in</a>
        </div>
      </header>

      <main class="mx-auto max-w-3xl px-6 py-20">
        <h1 class="text-4xl font-semibold tracking-tight text-slate-900">
          Clinical trial intelligence for pharma BD teams
        </h1>
        <p class="mt-4 text-lg text-slate-600">
          A whitelabeled competitive landscape platform for consulting partners and the pharma clients they serve.
        </p>

        <div class="mt-12 border border-slate-200 bg-white p-6">
          <h2 class="text-sm font-semibold tracking-wide text-slate-900 uppercase">Find your workspace</h2>
          <p class="mt-1 text-xs text-slate-500">Enter your workspace subdomain to sign in.</p>
          <form class="mt-4 flex gap-2" (submit)="goToWorkspace($event)">
            <div class="flex flex-1 items-stretch border border-slate-300 bg-white">
              <input
                pInputText
                type="text"
                [value]="subdomain()"
                (input)="onInput($event)"
                placeholder="your-workspace"
                class="flex-1 border-0 bg-transparent px-3 py-2 text-sm focus:outline-none"
                aria-label="Workspace subdomain"
              />
              <span class="border-l border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                .{{ apexDisplay }}
              </span>
            </div>
            <p-button label="Go" [disabled]="!subdomain()" type="submit" />
          </form>
          @if (errorMessage()) {
            <p class="mt-3 text-xs text-red-700" role="alert">{{ errorMessage() }}</p>
          }
        </div>

        <p class="mt-12 text-xs text-slate-500">
          Are you a consulting partner? <a routerLink="/login" class="underline">Sign in to your agency portal.</a>
        </p>
      </main>
    </div>
  `,
})
export class MarketingLandingComponent {
  private readonly router = inject(Router);

  readonly subdomain = signal<string>('');
  readonly errorMessage = signal<string | null>(null);

  protected readonly apexDisplay = environment.apexDomain || 'yourproduct.com';

  onInput(e: Event) {
    const v = (e.target as HTMLInputElement).value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    this.subdomain.set(v);
    this.errorMessage.set(null);
  }

  goToWorkspace(e: Event) {
    e.preventDefault();
    const sub = this.subdomain().trim();
    if (!sub || !/^[a-z][a-z0-9-]{1,62}$/.test(sub)) {
      this.errorMessage.set(
        'Subdomain must be lowercase letters, numbers, or hyphens, and start with a letter.'
      );
      return;
    }
    if (environment.apexDomain) {
      // Production: redirect to the actual subdomain.
      const url = `${window.location.protocol}//${sub}.${environment.apexDomain}/login`;
      window.location.href = url;
    } else {
      // Dev: route within the same host with a query param so login can show a hint.
      this.router.navigate(['/login'], { queryParams: { workspace: sub } });
    }
  }
}
