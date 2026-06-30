import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { CatalystDetail } from '../../core/models/event-detail.model';
import { FillStyle, InnerMark } from '../../core/models/marker.model';
import {
  ProjectionBadge,
  projectionBadge,
  projectionOutlineDash,
} from '../../core/models/marker-visual';
import { PiReference } from '../../core/models/primary-intelligence.model';
import { SpaceRoleService } from '../../core/services/space-role.service';
import { MarkerEditTarget, markerEditAnchor } from './marker-edit-route';
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
              [projectionBadge]="markerBadge()"
              [outlineDash]="markerOutlineDash()"
            />
          }
        </span>

        @if (canEditMarker()) {
          <button
            headerActions
            type="button"
            class="inline-flex items-center gap-1 border border-slate-300 px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-slate-600 hover:border-slate-400 hover:text-slate-800 focus:outline-none focus:ring-1 focus:ring-brand-500"
            (click)="onEditMarker()"
          >
            <i class="fa-solid fa-pen text-[9px]" aria-hidden="true"></i>
            Edit
          </button>
        }

        <app-marker-detail-content
          [detail]="detail()"
          [spaceId]="spaceId()"
          [surfaceKey]="surfaceKey()"
          [references]="references()"
          [entityIntelligence]="entityIntelligence()"
          (markerClick)="markerClick.emit($event)"
          (eventClick)="eventClick.emit($event)"
          (trialClick)="trialClick.emit($event)"
          (openIntelligence)="openIntelligence.emit($event)"
        />
      </app-detail-panel-shell>
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerDetailPanelComponent {
  private readonly spaceRole = inject(SpaceRoleService);

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
  /** Incoming PI references for the selected marker; see MarkerDetailContentComponent. */
  readonly references = input<PiReference[]>([]);
  /** Owned trial/asset intelligence for this marker; see MarkerDetailContentComponent. */
  readonly entityIntelligence = input<PiReference[]>([]);
  /** Forwarded to the content body; see MarkerDetailContentComponent. */
  readonly showEditAction = input<boolean>(false);
  readonly panelClose = output<void>();
  readonly markerClick = output<string>();
  readonly eventClick = output<string>();
  readonly trialClick = output<string>();
  /** Re-emitted from the content body when a PI reference is activated. */
  readonly openIntelligence = output<{ entityType: string; entityId: string }>();
  /**
   * Re-emitted when the header Edit affordance is activated, carrying the
   * marker's routable anchor (trial/asset/company) so the host can open the
   * merged Event editor on that entity's profile. See MarkerDetailContentComponent.
   */
  readonly editMarkerClick = output<MarkerEditTarget & { markerId: string }>();

  readonly headerLabel = computed(() => {
    const d = this.detail();
    if (!d) return '';
    return `${d.catalyst.category_name} · ${d.catalyst.marker_type_name}`;
  });

  /** Routable edit anchor for the selected marker, or null when none. */
  private readonly editAnchor = computed<MarkerEditTarget | null>(() =>
    markerEditAnchor(this.detail()?.catalyst)
  );

  /**
   * Whether the header shows the compact "Edit" affordance: the host opted in
   * via showEditAction, the current user can write to the active space, and the
   * marker is anchored to a routable entity (trial, asset, or company). The
   * editor opens on that entity's profile via the host. Space-anchored markers
   * have no profile editor here, so Edit stays hidden for them.
   */
  protected readonly canEditMarker = computed(
    () => this.showEditAction() && this.spaceRole.canEdit() && !!this.editAnchor()
  );

  protected onEditMarker(): void {
    const anchor = this.editAnchor();
    const c = this.detail()?.catalyst;
    if (!anchor || !c || !this.spaceRole.canEdit()) return;
    this.editMarkerClick.emit({ ...anchor, markerId: c.marker_id });
  }

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
    return this.detail()?.catalyst.marker_type_inner_mark ?? 'none';
  });

  /**
   * Projection tier badge for the header glyph, derived from the same rule the
   * timeline uses (`projectionBadge` in marker-visual), so the detail-pane glyph
   * carries the same 'c'/'p'/'f' letter as the marker on the row. The catalyst
   * surfaces `projection` + `anchor_type` from the read RPC.
   */
  readonly markerBadge = computed<ProjectionBadge>(() => {
    const c = this.detail()?.catalyst;
    if (!c) return null;
    return projectionBadge(c.projection, c.anchor_type);
  });

  readonly markerOutlineDash = computed<boolean>(() =>
    projectionOutlineDash(this.detail()?.catalyst.projection)
  );
}
