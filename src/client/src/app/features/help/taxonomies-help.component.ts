import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { IndicationService } from '../../core/services/indication.service';
import { MechanismOfActionService } from '../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../core/services/route-of-administration.service';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { LoaderComponent } from '../../shared/components/loader/loader.component';
import { toVocabRows, type VocabRow } from './taxonomies-help.utils';

@Component({
  selector: 'app-taxonomies-help',
  imports: [ManagePageShellComponent, LoaderComponent, RouterLink],
  template: `
    <app-manage-page-shell>
      <div class="max-w-3xl">
        <header class="mb-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Help</p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Taxonomies and how they organize the landscape
          </h1>
          <p class="mt-1 max-w-xl text-sm text-slate-500">
            Taxonomies are the controlled vocabularies {{ analystSubject() }} use to tag assets and
            trials and to drive the landscape filters: therapeutic area / indication, mechanism of
            action, and route of administration. The tables below show the vocabulary set up for
            this space.
          </p>
        </header>

        @if (loading()) {
          <app-loader [size]="20" label="Loading taxonomies" />
        } @else {
          @for (group of groups(); track group.heading) {
            <section class="mb-8">
              <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                {{ group.heading }}
              </h2>
              @if (group.rows.length === 0) {
                <p class="text-sm text-slate-500">{{ group.empty }}</p>
              } @else {
                <div class="border border-slate-200 bg-white">
                  @for (row of group.rows; track row.name) {
                    <div
                      class="grid grid-cols-[12rem_1fr] gap-4 border-b border-slate-100 px-5 py-3 last:border-b-0"
                    >
                      <div class="text-sm font-medium text-slate-900">{{ row.name }}</div>
                      <div class="text-sm text-slate-600">{{ row.detail }}</div>
                    </div>
                  }
                </div>
              }
            </section>
          }
        }

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            How these are used
          </h2>
          <p class="text-sm text-slate-600">
            These vocabularies populate the landscape filter bar. Filtering by mechanism of action,
            route of administration, or therapeutic area narrows every chart to the assets and
            trials tagged with that value.
          </p>
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

        <a
          [routerLink]="backLink()"
          class="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
        >
          <i class="fa-solid fa-arrow-left text-[10px]" aria-hidden="true"></i>
          Back to timeline
        </a>
      </div>
    </app-manage-page-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TaxonomiesHelpComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly indicationService = inject(IndicationService);
  private readonly moaService = inject(MechanismOfActionService);
  private readonly roaService = inject(RouteOfAdministrationService);
  private readonly brand = inject(BrandContextService);

  protected readonly loading = signal(true);
  private readonly tenantId = signal('');
  private readonly spaceId = signal('');
  private readonly indicationRows = signal<VocabRow[]>([]);
  private readonly moaRows = signal<VocabRow[]>([]);
  private readonly roaRows = signal<VocabRow[]>([]);

  protected readonly backLink = computed(() => {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return ['/'];
    return ['/t', tid, 's', sid, 'timeline'];
  });

  protected readonly analystActor = computed(() => this.brand.agency()?.name ?? 'the analyst');
  protected readonly analystSubject = computed(() => this.brand.agency()?.name ?? 'analysts');

  protected readonly groups = computed(() => [
    {
      heading: 'Therapeutic areas / Indications',
      rows: this.indicationRows(),
      empty: 'No indications configured for this space yet.',
    },
    {
      heading: 'Mechanisms of action (MoA)',
      rows: this.moaRows(),
      empty: 'No mechanisms of action configured for this space yet.',
    },
    {
      heading: 'Routes of administration (RoA)',
      rows: this.roaRows(),
      empty: 'No routes of administration configured for this space yet.',
    },
  ]);

  protected readonly faq = computed(() => {
    const actor = this.analystActor();
    return [
      {
        q: 'Where do these values come from?',
        a: `Taxonomies are curated per space. ${actor} maintains them from Settings > Taxonomies; the landscape filters read the same lists.`,
      },
      {
        q: 'Can I edit a taxonomy?',
        a: 'Editors and owners manage taxonomies from Settings > Taxonomies. If you do not see that option, your role does not include editing them.',
      },
    ];
  });

  async ngOnInit(): Promise<void> {
    let snap = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      if (!snap.parent) break;
      snap = snap.parent;
    }
    const spaceId = this.spaceId();
    try {
      const [inds, moas, roas] = await Promise.all([
        this.indicationService.list(spaceId),
        this.moaService.list(spaceId),
        this.roaService.list(spaceId),
      ]);
      this.indicationRows.set(toVocabRows(inds, (r) => r.abbreviation ?? null));
      this.moaRows.set(toVocabRows(moas, (r) => r.description ?? null));
      this.roaRows.set(toVocabRows(roas, (r) => r.abbreviation ?? null));
    } catch {
      this.indicationRows.set([]);
      this.moaRows.set([]);
      this.roaRows.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
