import { Component, input, output } from '@angular/core';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { MarkerDetailContentComponent } from '../../shared/components/marker-detail-content.component';

@Component({
  selector: 'app-marker-detail-drawer',
  standalone: true,
  imports: [MarkerDetailContentComponent],
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    @if (open()) {
      <!-- Backdrop -->
      <div
        class="fixed inset-0 z-40 bg-black/20"
        (click)="drawerClose.emit()"
        (keydown.escape)="drawerClose.emit()"
        aria-hidden="true"
      ></div>

      <!-- Drawer panel -->
      <div
        class="fixed top-0 right-0 bottom-0 z-50 flex w-[480px] max-w-[50vw] flex-col bg-white border-l border-slate-200 shadow-[-4px_0_16px_rgba(0,0,0,0.08)]"
        role="dialog"
        aria-modal="true"
        aria-label="Marker detail"
        (click)="$event.stopPropagation()"
        (keydown)="$event.stopPropagation()"
      >
        <!-- Panel header -->
        <div
          class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-2.5"
        >
          <div class="min-w-0 flex-1">
            @if (detail(); as d) {
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
            aria-label="Close detail drawer"
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
