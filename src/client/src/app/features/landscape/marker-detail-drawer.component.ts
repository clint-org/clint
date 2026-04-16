import { Component, input, output } from '@angular/core';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { MarkerDetailContentComponent } from '../../shared/components/marker-detail-content.component';

@Component({
  selector: 'app-marker-detail-drawer',
  standalone: true,
  imports: [MarkerDetailContentComponent],
  animations: [slidePanelAnimation],
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    @if (open()) {
      <div
        @slidePanel
        class="absolute top-0 right-0 bottom-0 z-10 flex w-[340px] flex-col border-l border-slate-200 bg-white shadow-[-4px_0_16px_rgba(0,0,0,0.08)]"
        role="region"
        aria-label="Marker detail"
      >
        <!-- Panel header -->
        <div
          class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-2.5"
        >
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            @if (detail(); as d) {
              <span
                class="inline-block h-2 w-2 shrink-0 rounded-full"
                [style.background-color]="d.catalyst.marker_type_color"
                aria-hidden="true"
              ></span>
              <p class="text-[10px] font-semibold uppercase tracking-widest text-teal-600">
                {{ d.catalyst.category_name }} &middot;
                {{ d.catalyst.marker_type_name }}
              </p>
            }
          </div>
          <button
            type="button"
            class="flex h-6 w-6 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
            (click)="drawerClose.emit()"
            aria-label="Close detail panel"
          >
            <i class="fa-solid fa-xmark text-xs"></i>
          </button>
        </div>

        <!-- Panel body (scrollable) -->
        <div class="flex-1 overflow-y-auto px-5 pt-3 pb-4">
          <app-marker-detail-content
            [detail]="detail()"
            (markerClick)="markerClick.emit($event)"
          />
        </div>
      </div>
    }
  `,
})
export class MarkerDetailDrawerComponent {
  readonly detail = input<CatalystDetail | null>(null);
  readonly open = input<boolean>(false);
  readonly drawerClose = output<void>();
  readonly markerClick = output<string>();

  onEscape(): void {
    if (this.open()) {
      this.drawerClose.emit();
    }
  }
}
