import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';

import { MarkerDetailPanelComponent } from '../../shared/components/marker-detail-panel.component';
import { LandscapeStateService } from './landscape-state.service';

/**
 * Page-level marker detail drawer for entity pages (asset, trial, company).
 *
 * Mounts a viewport-anchored drawer driven by the LandscapeStateService
 * instance provided locally by the host page. The drawer stays in view
 * while the host page scrolls underneath. Outputs from the panel route
 * to the events page and trial detail page using the route's tenant +
 * space ids.
 */
@Component({
  selector: 'app-entity-marker-drawer',
  imports: [MarkerDetailPanelComponent, ProgressSpinner],
  template: `
    @if (state.selectedMarkerId()) {
      @if (state.detailLoading() && !state.selectedDetail()) {
        <div
          class="fixed top-[42px] right-0 bottom-0 z-30 flex w-[340px] items-center justify-center border-l border-slate-200 bg-white"
        >
          <p-progress-spinner strokeWidth="3" styleClass="w-[28px] h-[28px]" />
        </div>
      } @else {
        <app-marker-detail-panel
          mode="page-drawer"
          [detail]="state.selectedDetail()"
          [spaceId]="state.spaceIdSig()"
          surfaceKey="timeline_detail"
          [open]="!!state.selectedMarkerId()"
          (panelClose)="state.clearSelection()"
          (markerClick)="state.selectMarker($event)"
          (eventClick)="onEventClick($event)"
          (trialClick)="onTrialClick($event)"
        />
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityMarkerDrawerComponent {
  protected readonly state = inject(LandscapeStateService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly tenantId = this.findRouteParam('tenantId') ?? '';
  private readonly spaceId = this.findRouteParam('spaceId') ?? '';

  protected onEventClick(eventId: string): void {
    this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'events'], {
      queryParams: { eventId },
    });
  }

  protected onTrialClick(trialId: string): void {
    if (!trialId) return;
    this.router.navigate([
      '/t',
      this.tenantId,
      's',
      this.spaceId,
      'manage',
      'trials',
      trialId,
    ]);
  }

  private findRouteParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }
}
