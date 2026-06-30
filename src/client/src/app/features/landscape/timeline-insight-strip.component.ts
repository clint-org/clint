import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { Company } from '../../core/models/company.model';
import { buildLandscapeRead, fromCompanies } from './competitive-read/index';
import { CompetitiveReadStripComponent } from './competitive-read/competitive-read-strip.component';
import { computeTimelineStats } from './timeline-stats';

@Component({
  selector: 'app-timeline-insight-strip',
  imports: [CompetitiveReadStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-start gap-5 bg-white border-b border-slate-200 px-4 py-2 flex-shrink-0"
      role="region"
      aria-label="Timeline at a glance"
    >
      <div class="flex flex-col gap-1 flex-1 min-w-0">
        <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
          >AT A GLANCE</span
        >
        @if (read().text) {
          <app-competitive-read-strip
            class="text-xs text-slate-600 leading-relaxed"
            [read]="read()"
          />
        }
      </div>

      <div class="w-px self-stretch bg-slate-200"></div>

      <div class="flex flex-col gap-1 flex-shrink-0">
        <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
          >STATS</span
        >
        <div class="flex gap-3">
          <div class="flex items-baseline gap-1 whitespace-nowrap">
            <span class="font-mono text-sm font-semibold text-slate-800">{{
              stats().companyCount
            }}</span>
            <span class="text-[11px] text-slate-500">{{
              stats().companyCount === 1 ? 'company' : 'companies'
            }}</span>
          </div>
          <div class="flex items-baseline gap-1 whitespace-nowrap">
            <span class="font-mono text-sm font-semibold text-slate-800">{{
              stats().assetCount
            }}</span>
            <span class="text-[11px] text-slate-500">{{
              stats().assetCount === 1 ? 'asset' : 'assets'
            }}</span>
          </div>
          <div class="flex items-baseline gap-1 whitespace-nowrap">
            <span class="font-mono text-sm font-semibold text-slate-800">{{
              stats().trialCount
            }}</span>
            <span class="text-[11px] text-slate-500">{{
              stats().trialCount === 1 ? 'trial' : 'trials'
            }}</span>
          </div>
          <div class="flex items-baseline gap-1 whitespace-nowrap">
            <span
              class="font-mono text-sm font-semibold"
              [class.text-amber-800]="stats().catalystCount90d > 0"
              [class.bg-amber-50]="stats().catalystCount90d > 0"
              [class.px-1.5]="stats().catalystCount90d > 0"
              [class.rounded]="stats().catalystCount90d > 0"
              [class.text-slate-800]="stats().catalystCount90d === 0"
              >{{ stats().catalystCount90d }}</span
            >
            <span class="text-[11px] text-slate-500">events (90d)</span>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class TimelineInsightStripComponent {
  readonly companies = input.required<Company[]>();

  protected readonly read = computed(() =>
    buildLandscapeRead({
      view: 'timeline',
      groupBy: 'company',
      stats: fromCompanies(this.companies()),
    })
  );
  protected readonly stats = computed(() => computeTimelineStats(this.companies()));
}
