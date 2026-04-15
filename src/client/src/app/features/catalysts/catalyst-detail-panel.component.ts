import { Component, input, output } from '@angular/core';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { MarkerDetailContentComponent } from '../../shared/components/marker-detail-content.component';

@Component({
  selector: 'app-catalyst-detail-panel',
  standalone: true,
  imports: [MarkerDetailContentComponent],
  template: `
    <div class="flex h-full flex-col overflow-hidden border-l border-slate-200 bg-white">
      <!-- Panel header -->
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div class="min-w-0 flex-1">
          @if (detail(); as d) {
            <p class="text-[10px] font-semibold uppercase tracking-widest text-teal-600">
              {{ d.catalyst.category_name }} &middot; {{ d.catalyst.marker_type_name }}
            </p>
          }
        </div>
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
          (click)="panelClose.emit()"
          aria-label="Close detail panel"
        >
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>

      <!-- Panel body (scrollable) -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        <app-marker-detail-content
          [detail]="detail()"
          (markerClick)="markerClick.emit($event)"
        />
      </div>
    </div>
  `,
})
export class CatalystDetailPanelComponent {
  readonly detail = input<CatalystDetail | null>(null);
  readonly panelClose = output<void>();
  readonly markerClick = output<string>();
}
