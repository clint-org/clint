import { Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { FillStyle, InnerMark } from '../../core/models/marker.model';
import { slidePanelAnimation } from '../animations/slide-panel.animation';
import {
  CtgovMarkerSurfaceKey,
  MarkerDetailContentComponent,
} from './marker-detail-content.component';
import { DetailPanelShellComponent } from './detail-panel-shell.component';
import { CircleIconComponent } from './svg-icons/circle-icon.component';
import { DiamondIconComponent } from './svg-icons/diamond-icon.component';
import { FlagIconComponent } from './svg-icons/flag-icon.component';
import { TriangleIconComponent } from './svg-icons/triangle-icon.component';
import { SquareIconComponent } from './svg-icons/square-icon.component';

/**
 * Container for the marker detail content. Two display modes:
 *   - `drawer`: 340px slide-in panel anchored to the right of the host (used
 *     by the timeline + catalysts views in the landscape shell).
 *   - `inline`: renders directly into a parent column without animation.
 *
 * The header eyebrow shows the marker shape glyph + "{category} ·
 * {marker_type}" so the user can scan what kind of object is selected
 * before the body loads.
 */
@Component({
  selector: 'app-marker-detail-panel',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    MarkerDetailContentComponent,
    DetailPanelShellComponent,
    CircleIconComponent,
    DiamondIconComponent,
    FlagIconComponent,
    TriangleIconComponent,
    SquareIconComponent,
  ],
  animations: [slidePanelAnimation],
  template: `
    @if (mode() === 'drawer') {
      @if (open()) {
        <div
          @slidePanel
          class="absolute top-0 right-0 bottom-0 z-10 w-[340px] border-l border-slate-200 bg-white shadow-[-4px_0_16px_rgba(0,0,0,0.08)]"
        >
          <ng-container *ngTemplateOutlet="paneContent" />
        </div>
      }
    } @else {
      <div class="h-full">
        <ng-container *ngTemplateOutlet="paneContent" />
      </div>
    }

    <ng-template #paneContent>
      <app-detail-panel-shell
        [label]="headerLabel()"
        [density]="mode() === 'drawer' ? 'compact' : 'roomy'"
        [bordered]="mode() === 'inline'"
        (closed)="panelClose.emit()"
      >
        <span headerLeading class="inline-flex shrink-0 items-center">
          @if (detail(); as d) {
            <svg width="12" height="12" class="overflow-visible" aria-hidden="true">
              @switch (d.catalyst.marker_type_shape) {
                @case ('circle') {
                  <g
                    app-circle-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                    [innerMark]="innerMark()"
                  />
                }
                @case ('diamond') {
                  <g
                    app-diamond-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                    [innerMark]="innerMark()"
                  />
                }
                @case ('flag') {
                  <g
                    app-flag-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                  />
                }
                @case ('triangle') {
                  <g
                    app-triangle-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                  />
                }
                @case ('square') {
                  <g
                    app-square-icon
                    [size]="12"
                    [color]="d.catalyst.marker_type_color"
                    [fillStyle]="effectiveFillStyle()"
                    [innerMark]="innerMark()"
                  />
                }
              }
            </svg>
          }
        </span>

        <app-marker-detail-content
          [detail]="detail()"
          [spaceId]="spaceId()"
          [surfaceKey]="surfaceKey()"
          (markerClick)="markerClick.emit($event)"
          (eventClick)="eventClick.emit($event)"
        />
      </app-detail-panel-shell>
    </ng-template>
  `,
})
export class MarkerDetailPanelComponent {
  readonly detail = input<CatalystDetail | null>(null);
  /** Optional space id, threaded through to the materials section. */
  readonly spaceId = input<string | null>(null);
  readonly mode = input<'inline' | 'drawer'>('inline');
  readonly open = input<boolean>(true);
  /**
   * Per-space CT.gov field surface to render under the Trial section.
   * Defaults to `timeline_detail`; the catalysts route overrides to
   * `key_catalysts_panel`.
   */
  readonly surfaceKey = input<CtgovMarkerSurfaceKey>('timeline_detail');
  readonly panelClose = output<void>();
  readonly markerClick = output<string>();
  readonly eventClick = output<string>();

  readonly headerLabel = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return `${d.catalyst.category_name} · ${d.catalyst.marker_type_name}`;
  });

  readonly effectiveFillStyle = computed<FillStyle>(() => {
    const c = this.detail()?.catalyst;
    if (!c) return 'filled';
    if (c.projection) return c.projection === 'actual' ? 'filled' : 'outline';
    return c.is_projected ? 'outline' : 'filled';
  });

  readonly innerMark = computed<InnerMark>(() => {
    const d = this.detail();
    return (d?.catalyst.marker_type_inner_mark as InnerMark) ?? 'none';
  });
}
