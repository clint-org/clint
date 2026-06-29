import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { Marker, MarkerType } from '../../../core/models/marker.model';
import {
  isApproximate,
  markerPeriodLabel,
  markerStartCaption,
} from '../../../core/models/marker-date-precision';
import { resolveMarkerVisual } from '../../../core/models/marker-visual';
import { textColorOnWhite } from '../../../shared/utils/color-contrast';
import { TimelineService } from '../../../core/services/timeline.service';
import { MarkerIconComponent } from '../../../shared/components/svg-icons/marker-icon.component';
import { MarkerTooltipComponent } from './marker-tooltip.component';

@Component({
  selector: 'app-marker',
  standalone: true,
  imports: [MarkerIconComponent, MarkerTooltipComponent],
  templateUrl: './marker.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerComponent {
  private readonly timeline = inject(TimelineService);

  readonly marker = input.required<Marker>();
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();
  readonly totalWidth = input.required<number>();

  /** Compact density shrinks the glyph and recenters it for tighter rows. */
  readonly compact = input<boolean>(false);

  /**
   * Row layout decides which date captions fit (see marker-label-layout.ts);
   * suppressed captions stay reachable via the hover tooltip.
   */
  readonly showDateLabel = input<boolean>(true);

  /**
   * The end-cap caption is secondary to start captions; row layout suppresses it
   * when it would collide (see marker-label-layout.ts). Suppressed end labels
   * stay reachable via the hover tooltip's full range.
   */
  readonly showEndLabel = input<boolean>(true);

  readonly trialName = input<string>('');
  readonly trialPhase = input<string>('');
  readonly recruitmentStatus = input<string>('');
  readonly companyName = input<string>('');
  /** Owning company's logo, threaded to the hover tooltip's company tile. */
  readonly companyLogoUrl = input<string | null>(null);
  readonly assetName = input<string>('');

  readonly markerClick = output<Marker>();

  readonly showTooltip = signal(false);

  readonly markerType = computed<MarkerType | undefined>(() => this.marker().marker_types);

  /**
   * Glyph size by event-type importance. The events executives scan for -- data
   * readouts, regulatory filings, approvals, launches, commercial moves, loss of
   * exclusivity -- render large so they pop; routine clinical milestones (trial
   * start/end, primary completion) and corporate events recede as context.
   * (significance is binary high|low and gates feed visibility, not size, so
   * importance is keyed off the event category instead.)
   */
  private static readonly CONTEXT_CATEGORIES = new Set([
    'Clinical',
    'Financial',
    'Strategic',
    'Leadership',
  ]);

  /**
   * Glyph geometry by density. `center` is the marker centerline (matched to the
   * phase bar center); `signal`/`context` are the two importance tiers. Compact
   * shrinks all three so rows can tighten while the date captions stay.
   */
  private readonly geom = computed(() =>
    this.compact()
      ? { center: 13, signal: 15, context: 10 }
      : { center: 15, signal: 21, context: 13 }
  );

  readonly iconSize = computed(() => {
    const category = this.markerType()?.marker_categories?.name ?? '';
    const g = this.geom();
    return MarkerComponent.CONTEXT_CATEGORIES.has(category) ? g.context : g.signal;
  });

  readonly topOffset = computed(() => this.geom().center - this.iconSize() / 2);

  readonly markerX = computed(() =>
    Math.max(
      0,
      this.timeline.dateToX(
        this.marker().event_date,
        this.startYear(),
        this.endYear(),
        this.totalWidth()
      )
    )
  );

  /** This marker spans time: a bounded end, or an open-ended "onwards". */
  readonly isRange = computed(() => {
    const m = this.marker();
    return m.is_ongoing || !!m.end_date;
  });

  /**
   * Right edge of the range tail in px. A bounded marker ends at its end_date;
   * an "onwards" marker runs to the window's right edge (continuing into the
   * future) where it fades out.
   */
  private readonly rangeEndX = computed(() => {
    const m = this.marker();
    if (m.is_ongoing) return this.totalWidth();
    if (!m.end_date) return this.markerX();
    return Math.min(
      this.totalWidth(),
      this.timeline.dateToX(m.end_date, this.startYear(), this.endYear(), this.totalWidth())
    );
  });

  /** Tail width in px (0 when the bar is a point). */
  readonly tailWidth = computed(() =>
    this.isRange() ? Math.max(0, this.rangeEndX() - this.markerX()) : 0
  );

  readonly isOngoing = computed(() => this.marker().is_ongoing);

  /** Period label for a fuzzy bounded end ("Q1 '27"), else null. */
  readonly endPeriodLabel = computed(() =>
    markerPeriodLabel(this.marker().end_date, this.marker().end_date_precision)
  );

  /** A bounded end exists and is itself approximate (render a hollow end cap). */
  readonly endIsFuzzy = computed(
    () => !this.marker().is_ongoing && isApproximate(this.marker().end_date_precision)
  );

  /**
   * Projection encoding is owned by resolveMarkerVisual (the shared source of
   * truth, so legend / catalyst table / bullseye / PPTX read identically): an
   * actual date is filled with no badge; every projected tier is hollow with a
   * tier letter ('c' company, 'p' primary, 'f' forecasted) and a gentle opacity
   * dim. The NLE strike-through stays the distinct "no longer expected" cue.
   */
  readonly visual = computed(() => resolveMarkerVisual(this.marker()));

  readonly isNle = computed(() => this.visual().isNle);

  readonly isDashedLine = computed(() => this.markerType()?.shape === 'dashed-line');

  /**
   * Date caption color: the marker type's color darkened (if needed) to the
   * AA 4.5:1 normal-text ratio on white. The icon keeps the raw color; only
   * the 8px text needs the boost.
   */
  readonly captionColor = computed(() => textColorOnWhite(this.markerType()?.color ?? '#475569'));

  readonly nleOpacity = computed(() => (this.isNle() ? 0.3 : 1));

  // Approximate markers show the period ("~Q4 '26"), not a false exact day.
  readonly shortDate = computed(() =>
    markerStartCaption(this.marker().event_date, this.marker().date_precision)
  );

  readonly ariaLabel = computed(() => {
    const m = this.marker();
    return m.title || this.markerType()?.name || '';
  });

  /**
   * Primary link for the compact tooltip's single source slot. The derived
   * CT.gov registry link wins, else the first attached citation, else the
   * legacy source_url (mid-transition fallback). get_dashboard_data does not
   * yet derive registry_url / sources for trial markers, so this resolves to
   * source_url today and upgrades transparently once the RPC emits them.
   */
  readonly primarySourceUrl = computed<string | null>(() => {
    const m = this.marker();
    return m.registry_url ?? m.sources?.[0]?.url ?? m.source_url ?? null;
  });

  onMarkerClick(): void {
    this.markerClick.emit(this.marker());
  }
}
