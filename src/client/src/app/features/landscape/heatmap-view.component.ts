import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnInit,
  resource,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';

import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { HeatmapBubble, HeatmapGrouping } from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { LandscapeStateService } from './landscape-state.service';
import { HeatmapComponent, type SortEvent, type SortField } from './heatmap.component';
import { HeatmapControlsPanelComponent } from './heatmap-controls-panel.component';
import { HeatmapDetailPanelComponent } from './heatmap-detail-panel.component';

@Component({
  selector: 'app-heatmap-view',
  imports: [
    HeatmapComponent,
    HeatmapControlsPanelComponent,
    HeatmapDetailPanelComponent,
    SkeletonComponent,
    MessageModule,
    ButtonModule,
  ],
  animations: [slidePanelAnimation],
  template: `
    @if (heatmapData.isLoading()) {
      <div
        class="flex h-full items-center justify-center"
        aria-busy="true"
        aria-label="Loading heatmap data"
      >
        <app-skeleton w="200px" h="14px" />
      </div>
    } @else if (heatmapData.error()) {
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3 text-center max-w-md">
          <p-message severity="error" [closable]="false">
            Failed to load heatmap data. Please try again.
          </p-message>
          <p-button
            label="Retry"
            severity="primary"
            size="small"
            (onClick)="heatmapData.reload()"
          />
        </div>
      </div>
    } @else {
      @let data = heatmapData.value();
      @if (data && data.bubbles.length > 0) {
        <div class="flex h-full overflow-auto">
          <app-heatmap-controls-panel
            [bubbles]="data.bubbles"
            [grouping]="state.heatmapGrouping()"
            [countUnit]="state.countUnit()"
          />
          <div class="flex-1 min-w-0 overflow-hidden landscape-layout">
            <div class="flex-1 min-w-0 min-h-0 overflow-auto">
              <app-heatmap
                [bubbles]="data.bubbles"
                [countUnit]="state.countUnit()"
                [selectedBubble]="selectedBubble()"
                [sortField]="sortField()"
                [sortDir]="sortDir()"
                [latestEventDate]="data.latest_event_date ?? null"
                [showPreclinical]="state.showPreclinical()"
                (rowClick)="onBubbleClick($event)"
                (sortChange)="onSortChange($event)"
              />
            </div>
            @if (showPanel()) {
              <div class="landscape-panel-wrap" @slidePanel>
                <app-heatmap-detail-panel
                  [bubble]="selectedBubble()"
                  [countUnit]="state.countUnit()"
                  [totalBubbles]="data.bubbles.length"
                  [grouping]="state.heatmapGrouping()"
                  [showPreclinical]="state.showPreclinical()"
                  (clearSelection)="selectedBubble.set(null)"
                  (openAsset)="onOpenAsset($event)"
                  (openInBullseye)="onOpenInBullseye()"
                />
              </div>
            }
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapViewComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);
  private readonly router = inject(Router);

  readonly spaceId = signal('');
  readonly tenantId = signal('');
  readonly selectedBubble = signal<HeatmapBubble | null>(null);
  readonly sortField = signal<SortField>('total');
  readonly sortDir = signal<'asc' | 'desc'>('desc');

  /**
   * The detail panel is an absolute-positioned overlay that covers the
   * right ~340px of the matrix (including the APP/LAUNCHED columns). Only
   * mount it once a row is selected so the full phase span — Launched
   * included — is visible on first visit and whenever the panel is closed.
   */
  protected readonly showPanel = computed(() => this.selectedBubble() !== null);

  constructor() {
    // Clear selection when grouping, count unit, or filters change
    effect(() => {
      this.state.heatmapGrouping();
      this.state.countUnit();
      this.state.filters();
      this.selectedBubble.set(null);
    });
  }

  readonly heatmapData = resource({
    params: () => ({
      spaceId: this.spaceId(),
      grouping: this.state.heatmapGrouping(),
      countUnit: this.state.countUnit(),
      filters: this.state.filters(),
    }),
    loader: async ({ params }) => {
      if (!params.spaceId) return null;
      return this.landscapeService.getHeatmapData(
        params.spaceId,
        params.grouping,
        params.countUnit,
        params.filters
      );
    },
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

  onBubbleClick(bubble: HeatmapBubble): void {
    if (!bubble || this.selectedBubble() === bubble) {
      this.selectedBubble.set(null);
    } else {
      this.selectedBubble.set(bubble);
    }
  }

  onSortChange(event: SortEvent): void {
    this.sortField.set(event.field as SortField);
    this.sortDir.set(event.dir);
  }

  onOpenAsset(assetId: string): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'timeline'], {
      queryParams: { assetIds: assetId },
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

  /** Map heatmap grouping to the closest bullseye dimension segment. */
  private bullseyeSegment(): string {
    const map: Record<HeatmapGrouping, string> = {
      moa: 'by-moa',
      indication: 'by-indication',
      'moa+indication': 'by-indication',
      company: 'by-company',
      roa: 'by-roa',
    };
    return map[this.state.heatmapGrouping()] ?? 'by-indication';
  }
}
