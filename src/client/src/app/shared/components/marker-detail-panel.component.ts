import { Component, computed, input, output } from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { FillStyle, InnerMark } from '../../core/models/marker.model';
import { slidePanelAnimation } from '../animations/slide-panel.animation';
import { MarkerDetailContentComponent } from './marker-detail-content.component';
import { CircleIconComponent } from './svg-icons/circle-icon.component';
import { DiamondIconComponent } from './svg-icons/diamond-icon.component';
import { FlagIconComponent } from './svg-icons/flag-icon.component';
import { TriangleIconComponent } from './svg-icons/triangle-icon.component';
import { SquareIconComponent } from './svg-icons/square-icon.component';

@Component({
  selector: 'app-marker-detail-panel',
  standalone: true,
  imports: [
    NgClass,
    NgTemplateOutlet,
    MarkerDetailContentComponent,
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
  ],
  animations: [slidePanelAnimation],
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
  template: `
    @if (mode() === 'drawer') {
      @if (open()) {
        <div
          @slidePanel
          class="absolute top-0 right-0 bottom-0 z-10 flex w-[340px] flex-col border-l border-slate-200 bg-white shadow-[-4px_0_16px_rgba(0,0,0,0.08)]"
          role="region"
          aria-label="Marker detail"
        >
          <ng-container [ngTemplateOutlet]="panelContent" />
        </div>
      }
    } @else {
      <div class="flex h-full flex-col overflow-hidden border-l border-slate-200 bg-white">
        <ng-container [ngTemplateOutlet]="panelContent" />
      </div>
    }

    <ng-template #panelContent>
      <!-- Panel header -->
      <div
        class="flex shrink-0 justify-between gap-3 border-b border-slate-100 px-5"
        [ngClass]="mode() === 'drawer' ? 'items-center py-2.5' : 'items-start py-4'"
      >
        <div class="flex min-w-0 flex-1 items-center gap-1.5">
          @if (detail(); as d) {
            <svg width="12" height="12" class="shrink-0 overflow-visible" aria-hidden="true">
              @switch (d.catalyst.marker_type_shape) {
                @case ('circle') {
                  <g app-circle-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                    [innerMark]="innerMark()"
                  />
                }
                @case ('diamond') {
                  <g app-diamond-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                    [innerMark]="innerMark()"
                  />
                }
                @case ('flag') {
                  <g app-flag-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                  />
                }
                @case ('triangle') {
                  <g app-triangle-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                  />
                }
                @case ('square') {
                  <g app-square-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                    [innerMark]="innerMark()"
                  />
                }
              }
            </svg>
            <p class="text-[10px] font-semibold uppercase tracking-widest text-brand-600">
              {{ d.catalyst.category_name }} &middot; {{ d.catalyst.marker_type_name }}
            </p>
          }
        </div>
        <button
          type="button"
          class="flex shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-brand-500"
          [ngClass]="mode() === 'drawer' ? 'h-6 w-6' : 'h-7 w-7'"
          (click)="panelClose.emit()"
          aria-label="Close detail panel"
        >
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>

      <!-- Panel body (scrollable) -->
      <div
        class="flex-1 overflow-y-auto px-5"
        [ngClass]="mode() === 'drawer' ? 'pt-3 pb-4' : 'py-4'"
      >
        <app-marker-detail-content
          [detail]="detail()"
          (markerClick)="markerClick.emit($event)"
        />
      </div>
    </ng-template>
  `,
})
export class MarkerDetailPanelComponent {
  readonly detail = input<CatalystDetail | null>(null);
  readonly mode = input<'inline' | 'drawer'>('inline');
  readonly open = input<boolean>(true);
  readonly panelClose = output<void>();
  readonly markerClick = output<string>();

  effectiveFillStyle = computed<FillStyle>(() => {
    const c = this.detail()?.catalyst;
    if (!c) return 'filled';
    if (c.projection) return c.projection === 'actual' ? 'filled' : 'outline';
    return c.is_projected ? 'outline' : 'filled';
  });

  innerMark = computed<InnerMark>(() => {
    const d = this.detail();
    return (d?.catalyst.marker_type_inner_mark as InnerMark) ?? 'none';
  });

  onEscape(): void {
    if (this.mode() === 'drawer' && this.open()) {
      this.panelClose.emit();
    }
  }
}
