import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Checkbox } from 'primeng/checkbox';

import { Company } from '../../core/models/company.model';
import { buildLandscapeRead, fromCompanies } from './competitive-read/index';
import { CompetitiveReadStripComponent } from './competitive-read/competitive-read-strip.component';
import { computeTimelineStats } from './timeline-stats';
import { LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-timeline-insight-strip',
  imports: [Checkbox, FormsModule, CompetitiveReadStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-start gap-5 bg-white border-b border-slate-200 px-4 py-2 flex-shrink-0"
      role="region"
      aria-label="Timeline summary"
    >
      @if (!columnsOnly()) {
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <span
            class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
            >SUMMARY</span
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
          <span
            class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
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
              <span class="text-[11px] text-slate-500">catalysts (90d)</span>
            </div>
          </div>
        </div>

        <div class="w-px self-stretch bg-slate-200"></div>
      }

      <div class="flex flex-col gap-1 flex-shrink-0">
        <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
          >COLUMNS</span
        >
        <div class="flex gap-2.5 pt-px">
          <div
            class="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none"
          >
            <p-checkbox
              [ngModel]="state.showMoaColumn()"
              (ngModelChange)="state.showMoaColumn.set($event)"
              [binary]="true"
              inputId="strip-col-moa"
              size="small"
            />
            <label for="strip-col-moa" class="cursor-pointer">MOA</label>
          </div>
          <div
            class="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none"
          >
            <p-checkbox
              [ngModel]="state.showRoaColumn()"
              (ngModelChange)="state.showRoaColumn.set($event)"
              [binary]="true"
              inputId="strip-col-roa"
              size="small"
            />
            <label for="strip-col-roa" class="cursor-pointer">ROA</label>
          </div>
          <div
            class="flex items-center gap-1 text-[11px] text-slate-500 cursor-pointer select-none"
          >
            <p-checkbox
              [ngModel]="state.showNotesColumn()"
              (ngModelChange)="state.showNotesColumn.set($event)"
              [binary]="true"
              inputId="strip-col-notes"
              size="small"
            />
            <label for="strip-col-notes" class="cursor-pointer">Notes</label>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class TimelineInsightStripComponent {
  protected readonly state = inject(LandscapeStateService);

  readonly companies = input.required<Company[]>();
  readonly columnsOnly = input<boolean>(false);

  protected readonly read = computed(() =>
    buildLandscapeRead({
      view: 'timeline',
      groupBy: 'company',
      stats: fromCompanies(this.companies()),
    })
  );
  protected readonly stats = computed(() => computeTimelineStats(this.companies()));
}
