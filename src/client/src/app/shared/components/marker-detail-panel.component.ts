import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { CatalystDetail } from '../../core/models/catalyst.model';
import { FillStyle, InnerMark } from '../../core/models/marker.model';
import { slidePanelAnimation } from '../animations/slide-panel.animation';
import {
  CtgovMarkerSurfaceKey,
  MarkerDetailContentComponent,
} from './marker-detail-content.component';
import { DetailPanelShellComponent } from './detail-panel-shell.component';
import { MarkerIconComponent } from './svg-icons/marker-icon.component';

/**
 * Container for the marker detail content. Three display modes:
 *   - `drawer`: 340px slide-in panel anchored to the right of the host (used
 *     by the timeline + catalysts views in the landscape shell).
 *   - `page-drawer`: 340px slide-in panel anchored to the right of the
 *     viewport (used on entity pages where the host is short and the user
 *     should be able to scroll the parent page underneath).
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
    MarkerIconComponent,
  ],
  animations: [slidePanelAnimation],
  template: `
    @if (mode() === 'drawer' || mode() === 'page-drawer') {
      @if (open()) {
        <div
          @slidePanel
          [class]="drawerClasses()"
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
        [density]="mode() === 'inline' ? 'roomy' : 'compact'"
        [bordered]="mode() === 'inline'"
        (closed)="panelClose.emit()"
      >
        <span headerLeading class="inline-flex shrink-0 items-center">
          @if (detail(); as d) {
            <app-marker-icon
              [shape]="d.catalyst.marker_type_shape"
              [color]="d.catalyst.marker_type_color"
              [size]="12"
              [fillStyle]="effectiveFillStyle()"
              [innerMark]="innerMark()"
              [isNle]="d.catalyst.no_longer_expected"
            />
          }
        </span>

        <app-marker-detail-content
          [detail]="detail()"
          [spaceId]="spaceId()"
          [surfaceKey]="surfaceKey()"
          (markerClick)="markerClick.emit($event)"
          (eventClick)="eventClick.emit($event)"
          (trialClick)="trialClick.emit($event)"
        />
      </app-detail-panel-shell>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerDetailPanelComponent {
  readonly detail = input<CatalystDetail | null>(null);
  /** Optional space id, threaded through to the materials section. */
  readonly spaceId = input<string | null>(null);
  readonly mode = input<'inline' | 'drawer' | 'page-drawer'>('inline');
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
  readonly trialClick = output<string>();

  readonly headerLabel = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return `${d.catalyst.category_name} · ${d.catalyst.marker_type_name}`;
  });

  readonly drawerClasses = computed(() => {
    const base = 'z-30 w-[340px] border-l border-slate-200 bg-white shadow-[-4px_0_16px_rgba(0,0,0,0.08)]';
    const positioning =
      this.mode() === 'page-drawer'
        ? 'fixed top-[42px] right-0 bottom-0'
        : 'absolute top-0 right-0 bottom-0';
    return `${positioning} ${base}`;
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
