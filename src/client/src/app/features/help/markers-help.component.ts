import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { MarkerType } from '../../core/models/marker.model';
import { MarkerTypeService } from '../../core/services/marker-type.service';
import { CircleIconComponent } from '../../shared/components/svg-icons/circle-icon.component';
import { DiamondIconComponent } from '../../shared/components/svg-icons/diamond-icon.component';
import { FlagIconComponent } from '../../shared/components/svg-icons/flag-icon.component';
import { SquareIconComponent } from '../../shared/components/svg-icons/square-icon.component';
import { TriangleIconComponent } from '../../shared/components/svg-icons/triangle-icon.component';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';

interface MarkerGroup {
  label: string;
  order: number;
  types: MarkerType[];
}

@Component({
  selector: 'app-markers-help',
  standalone: true,
  imports: [
    RouterLink,
    ManagePageShellComponent,
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
  ],
  template: `
    <app-manage-page-shell>
      <div class="max-w-3xl">
        <header class="mb-6">
          <p class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Help</p>
          <h1 class="mt-1 text-lg font-semibold tracking-tight text-slate-900">
            Markers and what they mean
          </h1>
          <p class="mt-1 max-w-xl text-sm text-slate-500">
            Markers are the events analysts and executives scan for on the timeline. Shape encodes
            the event type, color encodes the editorial role of the event, and inner marks
            distinguish actual versus projected occurrences. This list reflects the marker types
            configured for this space.
          </p>
        </header>

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
                <span
                  ><span class="font-semibold text-slate-900">Filled</span> -- actual /
                  occurred</span
                >
              </div>
              <div class="flex items-center gap-2">
                <svg width="14" height="14" aria-hidden="true">
                  <circle cx="7" cy="7" r="5" fill="none" stroke="#64748b" stroke-width="1.4" />
                </svg>
                <span
                  ><span class="font-semibold text-slate-900">Outline</span> -- projected /
                  expected</span
                >
              </div>
              <div class="flex items-center gap-2">
                <svg width="20" height="14" aria-hidden="true">
                  <circle cx="10" cy="7" r="5" fill="#64748b" opacity="0.3" />
                  <line x1="0" y1="7" x2="20" y2="7" stroke="#64748b" stroke-width="1.5" />
                </svg>
                <span
                  ><span class="font-semibold text-slate-900">Strikethrough (NLE)</span> -- no
                  longer expected</span
                >
              </div>
            </div>
          </div>
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Marker types in this space
          </h2>
          @if (loading()) {
            <p class="text-sm text-slate-500">Loading marker types...</p>
          } @else if (groupedMarkerTypes().length === 0) {
            <p class="text-sm text-slate-500">No marker types configured.</p>
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
                      <li class="flex items-center gap-3 text-sm text-slate-700">
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
                            }
                          </svg>
                        }
                        <span class="font-medium text-slate-900">{{ mt.name }}</span>
                        <span class="text-xs uppercase tracking-wide text-slate-400">
                          {{ mt.shape }}{{ mt.inner_mark !== 'none' ? ' / ' + mt.inner_mark : '' }}
                        </span>
                      </li>
                    }
                  </ul>
                </div>
              }
            </div>
          }
        </section>

        <section class="mb-8">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Common questions
          </h2>
          <div class="space-y-5">
            @for (entry of faq; track entry.q) {
              <div>
                <p class="text-sm font-semibold text-slate-900">{{ entry.q }}</p>
                <p class="mt-1 text-sm text-slate-600">{{ entry.a }}</p>
              </div>
            }
          </div>
        </section>

        <p class="mt-8 text-xs text-slate-400">
          <a [routerLink]="backLink()" class="text-brand-700 hover:underline">Back to timeline</a>
        </p>
      </div>
    </app-manage-page-shell>
  `,
})
export class MarkersHelpComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly markerTypeService = inject(MarkerTypeService);

  protected readonly markerTypes = signal<MarkerType[]>([]);
  protected readonly loading = signal(true);

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
      description: 'Data events. Readouts, interim results, primary endpoint reports.',
    },
    {
      label: 'Red',
      color: '#dc2626',
      description: 'Regulatory events. FDA actions, label changes, holds, rejections.',
    },
    {
      label: 'Blue',
      color: '#2563eb',
      description: 'Approval and launch milestones. Where commercial timing is decided.',
    },
    {
      label: 'Orange',
      color: '#ea580c',
      description: 'Change or status shifts. Strategic pivots, program reprioritizations.',
    },
  ];

  protected readonly faq = [
    {
      q: 'Why are some markers outline instead of filled?',
      a: 'Filled markers are events that have actually happened. Outline markers are events the analyst projects will happen. The same shape and color are used so the event type stays recognizable, only the certainty changes.',
    },
    {
      q: 'What does a marker with a strike-through line mean?',
      a: 'NLE -- no longer expected. The event was previously projected but the analyst now believes it will not occur (program shelved, indication dropped, sponsor change). The marker stays on the timeline so the prior expectation is auditable.',
    },
    {
      q: 'Why does the same event type sometimes appear in different colors?',
      a: 'Color encodes editorial role, not event identity. A readout-related event with regulatory implications can sit in the regulatory family. The color tells you why the event matters for the competitive read; the shape tells you what it is.',
    },
    {
      q: 'Can I add a custom marker type?',
      a: 'Yes -- space owners can add space-specific marker types from Manage > Marker Types. The list above includes both shared system markers and any custom markers configured for this space.',
    },
  ];

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

  protected backLink(): string[] {
    const tenantId = this.route.snapshot.paramMap.get('tenantId');
    const spaceId = this.route.snapshot.paramMap.get('spaceId');
    if (tenantId && spaceId) {
      return ['/t', tenantId, 's', spaceId, 'timeline'];
    }
    if (tenantId) {
      return ['/t', tenantId, 'spaces'];
    }
    return ['/'];
  }
}
