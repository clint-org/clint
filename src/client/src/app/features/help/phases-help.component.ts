import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { PHASE_DESCRIPTORS } from '../../core/models/phase-colors';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';

@Component({
  selector: 'app-phases-help',
  standalone: true,
  imports: [ManagePageShellComponent],
  template: `
    <app-manage-page-shell>
      <div class="max-w-6xl">
        <header class="mb-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Help</p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Phase bars and what each color means
          </h1>
          <p class="mt-1 max-w-xl text-sm text-slate-500">
            Phase bars are the timeline backdrop. Color encodes the development phase so the eye can
            scan a portfolio and identify where pivotal (P3) and launched assets sit. Bars recede so
            events stay the visual foreground.
          </p>
        </header>

        <div class="lg:grid lg:grid-cols-2 lg:items-start lg:gap-10">
          <section class="mb-8 lg:mb-0">
            <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Phase progression
            </h2>
            <div class="border border-slate-200 bg-white">
              @for (phase of phases(); track phase.key) {
                <div
                  class="grid grid-cols-[14rem_1fr] items-start gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0"
                >
                  <div class="flex items-center gap-2.5">
                    <span
                      class="inline-block h-3 w-8 shrink-0 rounded-sm"
                      [style.background-color]="phase.color"
                      aria-hidden="true"
                    ></span>
                    <span class="text-sm font-semibold text-slate-900">{{ phase.label }}</span>
                    <span class="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400">{{
                      phase.shortLabel
                    }}</span>
                  </div>
                  <div class="text-sm text-slate-600">{{ phase.description }}</div>
                </div>
              }
            </div>
          </section>

          <div>
        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            How to read the bars
          </h2>
          <div class="border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
            <ul class="space-y-2 list-disc pl-5">
              <li>
                A bar runs from the trial's earliest <span class="font-medium">Trial Start</span>
                event to its latest <span class="font-medium">Trial End</span> event (the
                <span class="font-medium">Primary Completion Date</span> event stands in when there
                is no Trial End). The bar has no dates of its own, so the events are the bar: correct
                a date on the event and the bar follows.
              </li>
              <li>
                Color and label come from the trial's phase, not its events. A trial with no Trial
                Start or Trial End event has no span, so no bar renders.
              </li>
              <li>
                Color intensity rises through PH 1 → PH 2 → PH 3 so the pivotal phase is the most
                prominent.
              </li>
              <li>P4 and APPROVED shift to the violet family to mark the regulatory transition.</li>
              <li>LAUNCHED uses the brand teal, the strongest commercial state and hero color.</li>
              <li>
                Observational arms use amber so they sit visually apart from interventional
                progression.
              </li>
            </ul>
          </div>
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Where the phase value comes from
          </h2>
          <div class="border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
            <p>
              Phase values for trials with a registered NCT are managed by ct.gov: the product
              mirrors what ct.gov reports on every sync. For trials without an NCT, or for fields
              ct.gov leaves blank, analysts can set them on the trial edit dialog. On sync, ct.gov
              values overwrite previous analyst values and the change appears in the activity feed.
            </p>
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
          </div>
        </div>
      </div>
    </app-manage-page-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhasesHelpComponent {
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
        q: 'Why are APPROVED and LAUNCHED separate?',
        a: `Regulatory approval and commercial launch are different competitive events. APPROVED marks the regulatory clearance; LAUNCHED marks revenue exposure. Distinct colors let ${subject} spot assets that are approved-but-not-launched at a glance.`,
      },
      {
        q: 'What does PRECLIN mean for a competitor analysis?',
        a: 'Preclinical assets are early signals. They appear muted because each one is a weak signal on its own, but they matter in aggregate. A cluster of preclinical activity in one area is itself worth watching.',
      },
      {
        q: 'Why don\'t I see the preclinical phase in my space?',
        a: 'Preclinical is hard to track and is hidden by default. It is a per-space setting: a space owner can enable "Track preclinical phase" in the space settings to surface preclinical trials and assets across the landscape, timeline, and trial list. While it is off, preclinical records are excluded everywhere and the phase is not offered when adding or editing a trial.',
      },
      {
        q: 'Can the colors change per tenant?',
        a: 'No. Phase colors are fixed and stay the same across every workspace and space, so a color always means the same phase no matter whose space you are looking at.',
      },
    ];
  });
}
