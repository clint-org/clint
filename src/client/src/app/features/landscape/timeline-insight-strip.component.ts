import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Checkbox } from 'primeng/checkbox';

import { Company } from '../../core/models/company.model';
import { buildCompetitiveRead, computeTimelineStats } from './competitive-read';
import { LandscapeStateService } from './landscape-state.service';

@Component({
  selector: 'app-timeline-insight-strip',
  imports: [Checkbox, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex items-start gap-5 bg-white border-b border-slate-200 px-4 py-2 flex-shrink-0"
      role="region"
      aria-label="Timeline summary"
    >
      <div class="flex flex-col gap-1 flex-1 min-w-0">
        <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"
          >READ</span
        >
        @if (read().text; as text) {
          <span
            class="text-xs text-slate-600 leading-relaxed read-content"
            [innerHTML]="text"
          ></span>
        }
      </div>

      <div class="w-px self-stretch bg-slate-200"></div>

      <div class="flex flex-col gap-1 flex-shrink-0">
        <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"
          >STATS</span
        >
        <div class="flex gap-3">
          <div class="flex items-baseline gap-1 whitespace-nowrap">
            <span class="font-mono text-sm font-semibold text-slate-800">{{
              stats().companyCount
            }}</span>
            <span class="text-[11px] text-slate-400">co</span>
          </div>
          <div class="flex items-baseline gap-1 whitespace-nowrap">
            <span class="font-mono text-sm font-semibold text-slate-800">{{
              stats().assetCount
            }}</span>
            <span class="text-[11px] text-slate-400">assets</span>
          </div>
          <div class="flex items-baseline gap-1 whitespace-nowrap">
            <span class="font-mono text-sm font-semibold text-slate-800">{{
              stats().trialCount
            }}</span>
            <span class="text-[11px] text-slate-400">trials</span>
          </div>
          <div class="flex items-baseline gap-1 whitespace-nowrap">
            <span
              class="font-mono text-xs font-semibold px-1.5 rounded"
              [class.text-amber-800]="stats().catalystCount90d > 0"
              [class.bg-amber-50]="stats().catalystCount90d > 0"
              [class.text-slate-500]="stats().catalystCount90d === 0"
              >{{ stats().catalystCount90d }}</span
            >
            <span class="text-[11px] text-slate-400">cat/90d</span>
          </div>
        </div>
      </div>

      <div class="w-px self-stretch bg-slate-200"></div>

      <div class="flex flex-col gap-1 flex-shrink-0">
        <span class="font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400"
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
  styles: `
    :host ::ng-deep .read-content strong {
      color: var(--slate-800, #1e293b);
      font-weight: 600;
    }
    :host ::ng-deep .read-content strong.leader-name {
      color: var(--teal-600, #0d9488);
    }
  `,
})
export class TimelineInsightStripComponent {
  protected readonly state = inject(LandscapeStateService);

  readonly companies = input.required<Company[]>();

  protected readonly read = computed(() => buildCompetitiveRead(this.companies()));
  protected readonly stats = computed(() => computeTimelineStats(this.companies()));
}
