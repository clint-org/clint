import { Component, effect, inject, OnInit, resource, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';

import { PositioningBubble } from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { LandscapeStateService } from './landscape-state.service';
import { PositioningChartComponent } from './positioning-chart.component';
import { PositioningDetailPanelComponent } from './positioning-detail-panel.component';
import { PositioningTooltipComponent } from './positioning-tooltip.component';

@Component({
  selector: 'app-positioning-view',
  standalone: true,
  imports: [
    PositioningChartComponent,
    PositioningDetailPanelComponent,
    PositioningTooltipComponent,
    ProgressSpinner,
    MessageModule,
    ButtonModule,
  ],
  template: `
    @if (positioningData.isLoading()) {
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3">
          <p-progressspinner
            strokeWidth="4"
            [style]="{ width: '2rem', height: '2rem' }"
            aria-label="Loading positioning data"
          />
          <span class="text-sm text-slate-500">Loading positioning data...</span>
        </div>
      </div>
    } @else if (positioningData.error()) {
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3 text-center max-w-md">
          <p-message severity="error" [closable]="false">
            Failed to load positioning data. Please try again.
          </p-message>
          <p-button label="Retry" severity="primary" size="small" (onClick)="positioningData.reload()" />
        </div>
      </div>
    } @else {
      @let data = positioningData.value();
      @if (data && data.bubbles.length > 0) {
        <div class="landscape-layout">
          <div style="min-width: 0; min-height: 0; overflow: hidden;">
            <app-positioning-chart
              [bubbles]="data.bubbles"
              [width]="1200"
              [height]="700"
              [countUnit]="state.countUnit()"
              [selectedBubble]="selectedBubble()"
              (bubbleHover)="onBubbleHover($event)"
              (bubbleClick)="onBubbleClick($event)"
            />
          </div>
          <div class="landscape-panel-wrap">
            <app-positioning-detail-panel
              [bubble]="selectedBubble()"
              [countUnit]="state.countUnit()"
              [totalBubbles]="data.bubbles.length"
              (clearSelection)="selectedBubble.set(null)"
            />
          </div>
        </div>
      } @else if (data) {
        <div class="flex items-center justify-center h-full">
          <p-message severity="info" [closable]="false">
            No data matches the current filters. Try adjusting your selections.
          </p-message>
        </div>
      }
    }

    <app-positioning-tooltip
      [bubble]="hoveredBubble()"
      [x]="tooltipX()"
      [y]="tooltipY()"
      [countUnit]="state.countUnit()"
    />
  `,
})
export class PositioningViewComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);

  readonly spaceId = signal('');
  readonly selectedBubble = signal<PositioningBubble | null>(null);
  readonly hoveredBubble = signal<PositioningBubble | null>(null);
  readonly tooltipX = signal(0);
  readonly tooltipY = signal(0);

  constructor() {
    // Clear selection when grouping, count unit, or filters change
    effect(() => {
      this.state.positioningGrouping();
      this.state.countUnit();
      this.state.filters();
      this.selectedBubble.set(null);
    });
  }

  readonly positioningData = resource({
    request: () => ({
      spaceId: this.spaceId(),
      grouping: this.state.positioningGrouping(),
      countUnit: this.state.countUnit(),
      filters: this.state.filters(),
    }),
    loader: async ({ request }) => {
      if (!request.spaceId) return null;
      return this.landscapeService.getPositioningData(
        request.spaceId,
        request.grouping,
        request.countUnit,
        request.filters,
      );
    },
  });

  ngOnInit(): void {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('spaceId')) {
        this.spaceId.set(snap.paramMap.get('spaceId')!);
        break;
      }
      snap = snap.parent;
    }
  }

  onBubbleHover(bubble: PositioningBubble | null): void {
    this.hoveredBubble.set(bubble);
    if (bubble) {
      const handler = (e: MouseEvent) => {
        this.tooltipX.set(e.clientX);
        this.tooltipY.set(e.clientY);
        document.removeEventListener('mousemove', handler);
      };
      document.addEventListener('mousemove', handler);
    }
  }

  onBubbleClick(bubble: PositioningBubble): void {
    if (!bubble || this.selectedBubble() === bubble) {
      this.selectedBubble.set(null);
    } else {
      this.selectedBubble.set(bubble);
    }
  }
}
