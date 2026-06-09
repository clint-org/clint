import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PublicFooterComponent } from '../../shared/components/public-footer.component';
import { TERMS_SECTIONS, LAST_UPDATED, PLATFORM_OPERATOR } from '../../core/models/legal-content';

@Component({
  selector: 'app-terms-of-service',
  standalone: true,
  imports: [RouterLink, PublicFooterComponent],
  template: `
    <div class="flex min-h-screen flex-col bg-slate-50">
      <main class="flex-1">
        <div class="mx-auto max-w-3xl px-6 py-14">
          <a routerLink="/" class="text-xs text-brand-700 hover:underline">Back to home</a>
          <h1 class="mt-4 text-2xl font-semibold tracking-tight text-slate-900">Terms of Service</h1>
          <p class="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-slate-400">
            {{ operator }} &middot; Last updated {{ lastUpdated }}
          </p>
          @for (section of sections; track section.heading) {
            <section class="mt-8">
              <h2 class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-700">
                {{ section.heading }}
              </h2>
              @for (para of section.body; track para) {
                <p class="mt-3 text-sm leading-relaxed text-slate-600">{{ para }}</p>
              }
            </section>
          }
        </div>
      </main>
      <app-public-footer />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermsOfServiceComponent {
  protected readonly sections = TERMS_SECTIONS;
  protected readonly lastUpdated = LAST_UPDATED;
  protected readonly operator = PLATFORM_OPERATOR;
}
