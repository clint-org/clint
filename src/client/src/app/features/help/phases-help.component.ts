import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { PHASE_DESCRIPTORS } from '../../core/models/phase-colors';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';

@Component({
  selector: 'app-phases-help',
  standalone: true,
  imports: [RouterLink, ManagePageShellComponent],
  template: `
    <app-manage-page-shell>
      <div class="max-w-3xl">
        <header class="mb-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Help</p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Phase bars and what each color means
          </h1>
          <p class="mt-1 max-w-xl text-sm text-slate-500">
            Phase bars are the timeline backdrop. Color encodes the development phase so the eye can
            scan a portfolio and identify where pivotal (P3) and launched assets sit. Bars recede so
            markers stay the visual foreground.
          </p>
        </header>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Phase progression
          </h2>
          <div class="border border-slate-200 bg-white">
            @for (phase of phases(); track phase.key) {
              <div
                class="grid grid-cols-[8rem_5rem_1fr] items-start gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0"
              >
                <div class="flex items-center gap-3">
                  <span
                    class="inline-block h-3 w-8 rounded-sm"
                    [style.background-color]="phase.color"
                    aria-hidden="true"
                  ></span>
                  <span class="text-sm font-semibold text-slate-900">{{ phase.label }}</span>
                </div>
                <code class="text-xs font-mono text-slate-500">{{ phase.key }}</code>
                <div class="text-sm text-slate-600">{{ phase.description }}</div>
              </div>
            }
          </div>
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            How to read the bars
          </h2>
          <div class="border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
            <ul class="space-y-2 list-disc pl-5">
              <li>Bars span the start and end dates of each phase.</li>
              <li>
                Color intensity rises through P1 → P2 → P3 so the pivotal phase is the most
                prominent.
              </li>
              <li>P4 and APPROVED shift to the violet family to mark the regulatory transition.</li>
              <li>LAUNCHED uses the brand teal -- the strongest commercial state, hero color.</li>
              <li>
                Observational arms use amber so they sit visually apart from interventional
                progression.
              </li>
            </ul>
          </div>
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Common questions
          </h2>
          <div class="space-y-5">
            @for (entry of faq(); track entry.q) {
              <div>
                <p class="text-sm font-semibold text-slate-900">{{ entry.q }}</p>
                <p class="mt-1 text-sm text-slate-600">{{ entry.a }}</p>
              </div>
            }
          </div>
        </section>

        <p class="mt-8 text-xs text-slate-400">
          <a [routerLink]="backLink()" class="text-brand-700 hover:underline">Back</a>
        </p>
      </div>
    </app-manage-page-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhasesHelpComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly brand = inject(BrandContextService);

  // Plural-people slot. Companies take a singular noun, so the agency name
  // slots in directly; without an agency we fall back to "analysts".
  private readonly analystSubject = computed(() => this.brand.agency()?.name ?? 'analysts');

  // Phase descriptors are a global const used by both the timeline phase bar
  // and this help page. Swap "analysts" inside the rendered descriptions so
  // the help page reads with the agency name without mutating the source const.
  protected readonly phases = computed(() => {
    const subject = this.analystSubject();
    return PHASE_DESCRIPTORS.map((p) => ({
      ...p,
      description: p.description.replace(/\banalysts\b/g, subject),
    }));
  });

  protected readonly faq = computed(() => {
    const subject = this.analystSubject();
    return [
      {
        q: 'Why is P3 the brightest color?',
        a: 'Pivotal trials decide the commercial and partnership narrative. The hero color cues the eye to the assets in or near pivotal readout. Earlier phases stay muted so they recede into context.',
      },
      {
        q: 'Why are APPROVED and LAUNCHED separate?',
        a: `Regulatory approval and commercial launch are different competitive events. APPROVED marks the regulatory clearance; LAUNCHED marks revenue exposure. Distinct colors let ${subject} spot assets that are approved-but-not-launched at a glance.`,
      },
      {
        q: 'What does PRECLIN mean for a competitor read?',
        a: 'Preclinical assets are early-signal indicators. They appear muted because they are weak signals individually but matter in aggregate -- a cluster of preclinical activity in an area is itself a competitive datum.',
      },
      {
        q: 'Can the colors change per tenant?',
        a: 'No. Phase colors are a global semantic and stay consistent across all tenants and engagements so anyone moving between spaces reads the same signal the same way.',
      },
    ];
  });

  protected backLink(): string[] {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    return tenantId ? ['/t', tenantId, 'spaces'] : ['/'];
  }
}
