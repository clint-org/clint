import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Checkbox } from 'primeng/checkbox';
import { Popover } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

import { Company } from '../../core/models/company.model';
import { buildLandscapeRead, fromCompanies } from './competitive-read/index';
import { CompetitiveReadStripComponent } from './competitive-read/competitive-read-strip.component';
import { computeTimelineStats } from './timeline-stats';
import { DetailLevel, GridDensity, LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-timeline-insight-strip',
  imports: [Checkbox, FormsModule, Popover, TooltipModule, CompetitiveReadStripComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-start gap-5 bg-white border-b border-slate-200 px-4 py-2 flex-shrink-0"
      role="region"
      aria-label="Timeline at a glance"
    >
      @if (!columnsOnly()) {
        <div class="flex flex-col gap-1 flex-1 min-w-0">
          <span
            class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
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

      <button
        type="button"
        class="ml-auto self-center flex items-center gap-1.5 rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 transition-colors hover:border-brand-400 hover:text-brand-700"
        (click)="displayPanel.toggle($event)"
        aria-label="Display settings"
        pTooltip="Display settings"
        tooltipPosition="top"
      >
        <i class="fa-solid fa-sliders text-[11px]"></i>
        Display
      </button>

      <p-popover #displayPanel>
        <div class="flex flex-col gap-4 p-1 min-w-[14rem]">
          <div class="flex flex-col gap-1.5">
            <span
              class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
              >COLUMNS</span
            >
            <div class="flex flex-col gap-2">
              <div
                class="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer select-none"
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
                class="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer select-none"
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
                class="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer select-none"
              >
                <p-checkbox
                  [ngModel]="state.showIndicationColumn()"
                  (ngModelChange)="state.showIndicationColumn.set($event)"
                  [binary]="true"
                  inputId="strip-col-indication"
                  size="small"
                />
                <label for="strip-col-indication" class="cursor-pointer">Indication</label>
              </div>
            </div>
          </div>

          <div class="h-px bg-slate-200"></div>

          <div class="flex flex-col gap-1.5">
            <span
              class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
              >DETAIL</span
            >
            <div class="flex items-center" role="group" aria-label="Detail level">
              @for (opt of detailOptions; track opt.value) {
                <button
                  type="button"
                  class="border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  [class.rounded-l]="$first"
                  [class.rounded-r]="$last"
                  [class.-ml-px]="!$first"
                  [class.border-brand-400]="state.detailLevel() === opt.value"
                  [class.bg-brand-50]="state.detailLevel() === opt.value"
                  [class.text-brand-700]="state.detailLevel() === opt.value"
                  [class.z-10]="state.detailLevel() === opt.value"
                  [class.border-slate-300]="state.detailLevel() !== opt.value"
                  [class.text-slate-500]="state.detailLevel() !== opt.value"
                  [attr.aria-pressed]="state.detailLevel() === opt.value"
                  [pTooltip]="opt.hint"
                  tooltipPosition="top"
                  (click)="state.detailLevel.set(opt.value)"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          </div>

          <div class="h-px bg-slate-200"></div>

          <div class="flex flex-col gap-1.5">
            <span
              class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500"
              >DENSITY</span
            >
            <div class="flex items-center" role="group" aria-label="Row density">
              @for (opt of densityOptions; track opt.value) {
                <button
                  type="button"
                  class="border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors"
                  [class.rounded-l]="$first"
                  [class.rounded-r]="$last"
                  [class.-ml-px]="!$first"
                  [class.border-brand-400]="state.density() === opt.value"
                  [class.bg-brand-50]="state.density() === opt.value"
                  [class.text-brand-700]="state.density() === opt.value"
                  [class.z-10]="state.density() === opt.value"
                  [class.border-slate-300]="state.density() !== opt.value"
                  [class.text-slate-500]="state.density() !== opt.value"
                  [attr.aria-pressed]="state.density() === opt.value"
                  (click)="state.density.set(opt.value)"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          </div>
        </div>
      </p-popover>
    </div>
  `,
})
export class TimelineInsightStripComponent {
  protected readonly state = inject(LandscapeStateService);

  readonly companies = input.required<Company[]>();
  readonly columnsOnly = input<boolean>(false);

  protected readonly densityOptions: { label: string; value: GridDensity }[] = [
    { label: 'Comfortable', value: 'comfortable' },
    { label: 'Compact', value: 'compact' },
  ];

  protected readonly detailOptions: { label: string; value: DetailLevel; hint: string }[] = [
    { label: 'Companies', value: 'companies', hint: 'Company bands only' },
    { label: 'Assets', value: 'assets', hint: 'Companies and their assets, no trials' },
    { label: 'Trials', value: 'trials', hint: 'Full detail down to trials' },
  ];

  protected readonly read = computed(() =>
    buildLandscapeRead({
      view: 'timeline',
      groupBy: 'company',
      stats: fromCompanies(this.companies()),
    })
  );
  protected readonly stats = computed(() => computeTimelineStats(this.companies()));
}
