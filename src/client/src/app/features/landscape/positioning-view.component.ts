import { Component, computed, effect, inject, OnInit, resource, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';

import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { PositioningBubble, PositioningGrouping } from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
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
    SkeletonComponent,
    MessageModule,
    ButtonModule,
  ],
  animations: [slidePanelAnimation],
  template: `
    @if (positioningData.isLoading()) {
      <div
        class="flex h-full items-center justify-center"
        aria-busy="true"
        aria-label="Loading positioning data"
      >
        <app-skeleton w="200px" h="14px" />
      </div>
    } @else if (positioningData.error()) {
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3 text-center max-w-md">
          <p-message severity="error" [closable]="false">
            Failed to load positioning data. Please try again.
          </p-message>
          <p-button
            label="Retry"
            severity="primary"
            size="small"
            (onClick)="positioningData.reload()"
          />
        </div>
      </div>
    } @else {
      @let data = positioningData.value();
      @if (data && chartBubbles().length > 0) {
        <div class="landscape-layout">
          <div class="landscape-chart-wrap" style="min-width: 0; min-height: 0; overflow: hidden;">
            <app-positioning-chart
              [bubbles]="chartBubbles()"
              [width]="1200"
              [height]="700"
              [countUnit]="state.countUnit()"
              [xLabel]="xAxisLabel()"
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
              [grouping]="state.positioningGrouping()"
              (clearSelection)="selectedBubble.set(null)"
              (openProduct)="onOpenProduct($event)"
              (openInBullseye)="onOpenInBullseye()"
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
  private readonly router = inject(Router);

  readonly spaceId = signal('');
  readonly tenantId = signal('');
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
        request.filters
      );
    },
  });

  /** X-axis label changes based on grouping type. */
  readonly xAxisLabel = computed(() => {
    const g = this.state.positioningGrouping();
    return g === 'company' ? 'Products' : 'Competitors';
  });

  /**
   * Transform bubbles for chart display. For company grouping, replace
   * competitor_count (always 1) with product count so bubbles spread
   * across the X-axis meaningfully.
   */
  readonly chartBubbles = computed<PositioningBubble[]>(() => {
    const data = this.positioningData.value();
    if (!data) return [];
    const grouping = this.state.positioningGrouping();
    if (grouping !== 'company') return data.bubbles;
    return data.bubbles.map((b) => ({
      ...b,
      competitor_count: b.products.length,
    }));
  });

  ngOnInit(): void {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('spaceId')) {
        this.spaceId.set(snap.paramMap.get('spaceId')!);
      }
      if (snap.paramMap.has('tenantId')) {
        this.tenantId.set(snap.paramMap.get('tenantId')!);
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

  onOpenProduct(productId: string): void {
    // Open the timeline filtered by this product so the analyst sees the
    // product's trials and markers in time. The footer "Open in bullseye"
    // button still routes to bullseye for the cross-positional view.
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'timeline'], {
      queryParams: { productIds: productId },
    });
  }

  onOpenInBullseye(): void {
    this.router.navigate([
      '/t',
      this.tenantId(),
      's',
      this.spaceId(),
      'bullseye',
      this.bullseyeSegment(),
    ]);
  }

  /** Map positioning grouping to the closest bullseye dimension segment. */
  private bullseyeSegment(): string {
    const map: Record<PositioningGrouping, string> = {
      moa: 'by-moa',
      'therapeutic-area': 'by-therapy-area',
      'moa+therapeutic-area': 'by-therapy-area',
      company: 'by-company',
      roa: 'by-roa',
    };
    return map[this.state.positioningGrouping()] ?? 'by-therapy-area';
  }
}
