import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { MarkerType } from '../../core/models/marker.model';
import { MarkerTypeService } from '../../core/services/marker-type.service';
import { BrandContextService } from '../../core/services/brand-context.service';
import { CircleIconComponent } from '../../shared/components/svg-icons/circle-icon.component';
import { DiamondIconComponent } from '../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../shared/components/svg-icons/flag-icon.component';
import { SquareIconComponent } from '../../shared/components/svg-icons/square-icon.component';
import { HexagonIconComponent } from '../../shared/components/svg-icons/hexagon-icon.component';
import { TriangleIconComponent } from '../../shared/components/svg-icons/triangle-icon.component';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { LoaderComponent } from '../../shared/components/loader/loader.component';

interface MarkerGroup {
  label: string;
  order: number;
  types: MarkerType[];
}

// Plain-language definitions for the shared system event types, keyed by name.
// Custom event types added for a space have no entry and render without a
// definition line. These are the pre-installed types seeded for every space.
const MARKER_DEFINITIONS: Record<string, string> = {
  'Topline Data':
    'First headline results from a trial: the high-level numbers, such as whether it hit its primary endpoint, released before the full dataset.',
  'Interim Data':
    'Results from a planned look at the data partway through a trial, before it has finished.',
  'Full Data': 'The complete trial results, usually presented at a medical congress or published.',
  'Primary Completion Date (PCD)':
    'The date a trial finishes collecting data on its primary endpoint. Often when a topline readout is expected.',
  'Trial Start': 'The trial begins: first patient enrolled or dosed.',
  'Trial End': 'The trial completes: all data collected and the study closed.',
  'Regulatory Filing':
    'The sponsor files a marketing application with a regulator, such as an FDA NDA or BLA, or an EMA MAA.',
  Submission:
    'A regulatory submission to an agency, used for filings that are not a standard new-drug application.',
  Acceptance: 'The regulator accepts the application for review, which starts the review clock.',
  Approval: 'The regulator approves the drug for marketing.',
  Launch: 'The drug becomes commercially available: first sales.',
  'LOE Date':
    'Loss of exclusivity: the date market protection ends, through patent expiry or loss of exclusivity.',
  'Generic Entry Date': 'The date a generic or biosimilar competitor enters the market.',
  Distribution:
    'A commercial availability or distribution milestone: a supply, channel, or market-access step once the drug is on the market.',
  'Leadership Change':
    'A change in a company\'s executive leadership, such as a new CEO or head of R&D.',
  Financial:
    'A material financial event, such as an earnings report, a capital raise, or a guidance change.',
  Strategic:
    'A strategic corporate move, such as M&A, an in- or out-licensing deal, a partnership, or a restructuring.',
};

@Component({
  selector: 'app-markers-help',
  standalone: true,
  imports: [
    ManagePageShellComponent,
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
    HexagonIconComponent,
    LoaderComponent,
  ],
  template: `
    <app-manage-page-shell>
      <div class="max-w-6xl">
        <header class="mb-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Help</p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Event glyphs and what they mean
          </h1>
          <p class="mt-1 max-w-xl text-sm text-slate-500">
            Events render as glyphs on the timeline. Read each glyph by its shape (event family),
            color (editorial role), inner mark (variant of that shape), and fill style (actual or
            projected). The list shows the event types set up for this space.
          </p>
        </header>

        <div class="lg:grid lg:grid-cols-2 lg:items-start lg:gap-10">
          <section class="mb-8 lg:mb-0">
            <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Event types in this space
            </h2>
            @if (loading()) {
              <app-loader [size]="20" label="Loading event types" />
            } @else if (groupedMarkerTypes().length === 0) {
              <p class="text-sm text-slate-500">No event types configured.</p>
            } @else {
              <div class="border border-slate-200 bg-white">
                @for (group of groupedMarkerTypes(); track group.label) {
                  <div class="border-b border-slate-100 px-5 py-4 last:border-b-0">
                    <p
                      class="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                    >
                      {{ group.label }}
                    </p>
                    <ul class="space-y-1.5">
                      @for (mt of group.types; track mt.id) {
                        <li class="flex items-start gap-3 text-sm text-slate-700">
                          <span class="mt-px shrink-0">
                            @if (mt.shape === 'dashed-line') {
                              <svg width="14" height="14" aria-hidden="true">
                                <line
                                  x1="7"
                                  y1="2"
                                  x2="7"
                                  y2="12"
                                  [attr.stroke]="mt.color"
                                  stroke-width="1.5"
                                  stroke-dasharray="3,2"
                                  stroke-linecap="round"
                                />
                              </svg>
                            } @else {
                              <svg width="14" height="14" aria-hidden="true">
                                @switch (mt.shape) {
                                  @case ('circle') {
                                    <g
                                      app-circle-icon
                                      [size]="14"
                                      [color]="mt.color"
                                      fillStyle="filled"
                                      [innerMark]="mt.inner_mark"
                                    />
                                  }
                                  @case ('diamond') {
                                    <g
                                      app-diamond-icon
                                      [size]="14"
                                      [color]="mt.color"
                                      fillStyle="filled"
                                      [innerMark]="mt.inner_mark"
                                    />
                                  }
                                  @case ('flag') {
                                    <g
                                      app-flag-icon
                                      [size]="14"
                                      [color]="mt.color"
                                      fillStyle="filled"
                                    />
                                  }
                                  @case ('triangle') {
                                    <g
                                      app-triangle-icon
                                      [size]="14"
                                      [color]="mt.color"
                                      fillStyle="filled"
                                    />
                                  }
                                  @case ('square') {
                                    <g
                                      app-square-icon
                                      [size]="14"
                                      [color]="mt.color"
                                      fillStyle="filled"
                                      [innerMark]="mt.inner_mark"
                                    />
                                  }
                                  @case ('hexagon') {
                                    <g
                                      app-hexagon-icon
                                      [size]="14"
                                      [color]="mt.color"
                                      fillStyle="filled"
                                      [innerMark]="mt.inner_mark"
                                    />
                                  }
                                }
                              </svg>
                            }
                          </span>
                          <div class="min-w-0">
                            <div class="flex flex-wrap items-center gap-2">
                              <span class="font-medium text-slate-900">{{ mt.name }}</span>
                              <span class="text-xs uppercase tracking-wide text-slate-400">
                                {{ mt.shape
                                }}{{ mt.inner_mark !== 'none' ? ' / ' + mt.inner_mark : '' }}
                              </span>
                            </div>
                            @if (definitionFor(mt.name); as def) {
                              <p class="mt-0.5 text-xs leading-snug text-slate-500">{{ def }}</p>
                            }
                          </div>
                        </li>
                      }
                    </ul>
                  </div>
                }
              </div>
            }
          </section>

          <div>
            <section class="mb-8">
              <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Editorial color rule
              </h2>
              <div class="border border-slate-200 bg-white">
                @for (rule of colorRules; track rule.label) {
                  <div
                    class="grid grid-cols-[8rem_1fr] gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0"
                  >
                    <div class="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span
                        class="inline-block h-3 w-3 rounded-full"
                        [style.background-color]="rule.color"
                        aria-hidden="true"
                      ></span>
                      {{ rule.label }}
                    </div>
                    <div class="text-sm text-slate-600">{{ rule.description }}</div>
                  </div>
                }
              </div>
              <p class="mt-2 text-xs text-slate-500">
                The allocation rule: <span class="font-medium text-slate-700">color</span> is the
                editorial family, <span class="font-medium text-slate-700">shape</span> is that
                family's signature glyph, and the
                <span class="font-medium text-slate-700">inner mark</span> is the specific type
                within it. So a rose hexagon is a corporate event, and its inner mark says which one.
                Teal is reserved for the brand and phase bars and is never an event color.
              </p>
              <p class="mt-2 text-xs text-slate-500">
                These color roles apply to the system categories. Custom categories added for this
                space use analyst-chosen colors and carry no fixed color convention.
              </p>
            </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Projection convention
          </h2>
          <div class="border border-slate-200 bg-white px-5 py-4">
            <div class="flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-700">
              <div class="flex items-center gap-2">
                <svg width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" fill="#64748b" />
                </svg>
                <span><span class="font-semibold text-slate-900">Filled:</span> actual</span>
              </div>
              <div class="flex items-center gap-2">
                <svg width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" fill="none" stroke="#64748b" stroke-width="1.4" />
                </svg>
                <span><span class="font-semibold text-slate-900">Outline:</span> projected</span>
              </div>
              <div class="flex items-center gap-2">
                <svg width="20" height="14" aria-hidden="true">
                  <circle cx="10" cy="7" r="5" fill="#64748b" opacity="0.3" />
                  <line x1="0" y1="7" x2="20" y2="7" stroke="#64748b" stroke-width="1.5" />
                </svg>
                <span
                  ><span class="font-semibold text-slate-900">Strikethrough (NLE):</span> no longer
                  expected</span
                >
              </div>
            </div>
            <p class="mt-4 border-t border-slate-100 pt-4 text-sm text-slate-600">
              Fill is not typed by hand. ct.gov events follow ct.gov's flag: a reported date is
              actual (filled), an anticipated date is projected (outline). Analyst events derive it
              from the date itself, so a date today or in the past is actual and a future date is
              projected. The event form's projection control can override this, but editing
              the trial's Trial Start or Trial End date afterwards re-derives it from the new date
              (see the projection question below).
            </p>
          </div>
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Where system events come from
          </h2>
          <div class="space-y-3 border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600">
            <p>
              System event types are the shared types every space starts with, grouped into the
              system categories shown above. Most events are placed by {{ analystActor() }} from a
              cited source. Three are populated automatically.
            </p>
            <p>
              <span class="font-semibold text-slate-900">ct.gov-sourced.</span> For any trial with a
              registered NCT, the product mirrors ct.gov on every sync and writes three Clinical
              Trial events:
              <span class="font-medium text-slate-800">Trial Start</span>,
              <span class="font-medium text-slate-800">Primary Completion Date (PCD)</span>, and
              <span class="font-medium text-slate-800">Trial End</span>. A date ct.gov reports as
              actual is drawn filled; a date it reports as anticipated is drawn outline (projected).
              These events stay live: when ct.gov moves a date, the event moves with it on the next
              sync, so they cannot be edited by hand while the NCT is set.
            </p>
            <p>
              <span class="font-semibold text-slate-900">They define the phase bar.</span> A trial's
              phase bar runs from its earliest Trial Start event to its latest Trial End event (the
              PCD event stands in when there is no Trial End). The bar has no dates of its own, so
              these events are the bar.
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
export class MarkersHelpComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly markerTypeService = inject(MarkerTypeService);
  private readonly brand = inject(BrandContextService);

  protected readonly markerTypes = signal<MarkerType[]>([]);
  protected readonly loading = signal(true);

  // Editorial actor label. With an agency: the agency name (singular noun);
  // without: "the analyst" so the prose still reads naturally.
  protected readonly analystActor = computed(() => this.brand.agency()?.name ?? 'the analyst');
  // Plural-people slot ("X and executives scan..."). Companies take a singular
  // noun here; the fallback is the plural "analysts".
  protected readonly analystSubject = computed(() => this.brand.agency()?.name ?? 'analysts');

  protected readonly groupedMarkerTypes = computed<MarkerGroup[]>(() => {
    const types = this.markerTypes().filter((t) => t.display_order > 0);
    const groupMap = new Map<string, MarkerGroup>();
    for (const t of types) {
      const cat = t.marker_categories;
      const label = cat?.name ?? 'Other';
      const order = cat?.display_order ?? 999;
      let group = groupMap.get(label);
      if (!group) {
        group = { label, order, types: [] };
        groupMap.set(label, group);
      }
      group.types.push(t);
    }
    return Array.from(groupMap.values()).sort((a, b) => a.order - b.order);
  });

  protected readonly colorRules = [
    {
      label: 'Green',
      color: '#16a34a',
      description: 'Data readouts. Topline, interim, full.',
    },
    {
      label: 'Slate',
      color: '#475569',
      description: 'Trial milestones. Start, end, primary completion date.',
    },
    {
      label: 'Orange',
      color: '#f97316',
      description: 'Regulatory events. Filings, submissions, acceptances.',
    },
    {
      label: 'Blue',
      color: '#3b82f6',
      description: 'Approval decision.',
    },
    {
      label: 'Violet',
      color: '#7c3aed',
      description: 'Commercial launch and availability. Launch, distribution.',
    },
    {
      label: 'Amber',
      color: '#d97706',
      description: 'Loss of exclusivity. LOE and generic entry dates.',
    },
    {
      label: 'Rose',
      color: '#be123c',
      description: 'Corporate. Leadership, financial, and strategic company events.',
    },
  ];

  protected readonly faq = computed(() => {
    const actor = this.analystActor();
    return [
      {
        q: 'Why are some glyphs outline instead of filled?',
        a: `Events that already happened are filled. Projected events are outline, ${actor}'s call on a date still to come. Same shape and color, only the fill changes.`,
      },
      {
        q: 'Why did a glyph switch between filled and outline after I changed a date?',
        a: 'Fill marks whether an event is actual or projected. For analyst events it is derived from the date: today or past is actual (filled), future is projected (outline). The trial edit dialog re-derives it every time you change a Trial Start or Trial End date, so a projection you set by hand in the event form is overwritten on the next date edit there (your custom title is kept). To hold a projection, set both the date and projection in the event form and avoid re-editing that date from the trial dialog. ct.gov-owned dates are exempt: they always follow ct.gov.',
      },
      {
        q: 'What does a glyph with a strike-through line mean?',
        a: `NLE: no longer expected. The event was projected, but ${actor} no longer expects it to happen (asset shelved, indication dropped, sponsor change). The event stays so the earlier call is still visible.`,
      },
      {
        q: 'Why can\'t I edit the Trial Start or Trial End on a trial with an NCT?',
        a: 'Those events (and the PCD) are owned by ct.gov whenever a trial has a registered NCT, so they refresh on every sync and direct edits to them are blocked. Removing the NCT releases them to manual ownership. Trials without an NCT are owned by the analyst from the start.',
      },
      {
        q: 'How do I tell two glyphs of the same shape apart?',
        a: 'The inner mark tells you which variant. Circles: dot = topline, dash = interim, plain = full data. Diamonds: dot = filing, plain = submission, check = acceptance. Squares: x = LOE, plain = generic entry. Rose hexagons (corporate): plain = leadership change, dot = financial, dash = strategic. A violet hexagon is commercial distribution.',
      },
      {
        q: 'Can I add a custom event type?',
        a: 'Yes. Space owners and editors can add custom event types from Settings > Taxonomies (Event Types tab). The list above shows the shared system types plus any custom ones added for this space.',
      },
      {
        q: 'Can I add my own event categories?',
        a: 'Yes. Space owners and editors can add categories from Settings > Taxonomies (Event Categories tab), then file custom event types under them. New categories appear as their own group in this legend.',
      },
    ];
  });

  async ngOnInit(): Promise<void> {
    const spaceId = this.route.snapshot.paramMap.get('spaceId') ?? undefined;
    try {
      const types = await this.markerTypeService.list(spaceId);
      this.markerTypes.set(types);
    } catch {
      this.markerTypes.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected definitionFor(name: string): string | undefined {
    return MARKER_DEFINITIONS[name];
  }
}
