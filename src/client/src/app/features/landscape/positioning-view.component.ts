import {
  ChangeDetectionStrategy,
  Component,
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
import { PositioningBubble, PositioningGrouping } from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { LandscapeStateService } from './landscape-state.service';
import { DensityMatrixComponent, type SortEvent, type SortField } from './density-matrix.component';
import { DensityControlsPanelComponent } from './density-controls-panel.component';
import { PositioningDetailPanelComponent } from './positioning-detail-panel.component';

@Component({
  selector: 'app-positioning-view',
  imports: [
    DensityMatrixComponent,
    DensityControlsPanelComponent,
    PositioningDetailPanelComponent,
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
      @if (data && data.bubbles.length > 0) {
        <div class="flex h-full overflow-auto">
          <app-density-controls-panel
            [bubbles]="data.bubbles"
            [grouping]="state.positioningGrouping()"
            [countUnit]="state.countUnit()"
          />
          <div class="flex-1 min-w-0 overflow-hidden landscape-layout">
            <div class="flex-1 min-w-0 min-h-0 overflow-auto">
              <app-density-matrix
                [bubbles]="data.bubbles"
                [countUnit]="state.countUnit()"
                [selectedBubble]="selectedBubble()"
                [sortField]="sortField()"
                [sortDir]="sortDir()"
                [latestEventDate]="data.latest_event_date ?? null"
                (rowClick)="onBubbleClick($event)"
                (sortChange)="onSortChange($event)"
              />
            </div>
            <div class="landscape-panel-wrap">
              <app-positioning-detail-panel
                [bubble]="selectedBubble()"
                [countUnit]="state.countUnit()"
                [totalBubbles]="data.bubbles.length"
                [grouping]="state.positioningGrouping()"
                (clearSelection)="selectedBubble.set(null)"
                (openAsset)="onOpenAsset($event)"
                (openInBullseye)="onOpenInBullseye()"
              />
            </div>
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
export class PositioningViewComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);
  private readonly router = inject(Router);

  readonly spaceId = signal('');
  readonly tenantId = signal('');
  readonly selectedBubble = signal<PositioningBubble | null>(null);
  readonly sortField = signal<SortField>('total');
  readonly sortDir = signal<'asc' | 'desc'>('desc');

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
    params: () => ({
      spaceId: this.spaceId(),
      grouping: this.state.positioningGrouping(),
      countUnit: this.state.countUnit(),
      filters: this.state.filters(),
    }),
    loader: async ({ params }) => {
      if (!params.spaceId) return null;
      return this.landscapeService.getPositioningData(
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

  onBubbleClick(bubble: PositioningBubble): void {
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

  /** Map positioning grouping to the closest bullseye dimension segment. */
  private bullseyeSegment(): string {
    const map: Record<PositioningGrouping, string> = {
      moa: 'by-moa',
      indication: 'by-indication',
      'moa+indication': 'by-indication',
      company: 'by-company',
      roa: 'by-roa',
    };
    return map[this.state.positioningGrouping()] ?? 'by-indication';
  }
}
