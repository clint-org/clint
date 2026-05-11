import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DatePipe, NgOptimizedImage } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TooltipModule } from 'primeng/tooltip';
import type { ChangeEvent, ChangeEventType } from '../../../core/models/change-event.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { summarySegmentsFor } from '../../utils/change-event-summary';

const DEFAULT_ROW_COLOR = '#334155'; // slate-700

@Component({
  selector: 'app-change-event-row',
  standalone: true,
  imports: [DatePipe, NgOptimizedImage, RouterLink, TooltipModule],
  templateUrl: './change-event-row.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChangeEventRowComponent {
  readonly event = input.required<ChangeEvent>();
  /**
   * Optional. When both tenantId and spaceId are provided the row becomes a
   * link to the marker drawer (when the event has a marker_id) or the trial
   * detail page. When omitted (e.g. on the trial-detail Activity card where
   * the row would link back to itself), the row renders as plain text.
   */
  readonly tenantId = input<string | null>(null);
  readonly spaceId = input<string | null>(null);

  private readonly brand = inject(BrandContextService);

  readonly iconClass = computed(() => iconFor(this.event().event_type));
  /**
   * Structured segments + a color hint. Color is the destination phase color
   * for phase_transitioned, the marker's category color for marker_* events,
   * and null otherwise (template falls back to slate-700). Pulls from
   * established taxonomies so a teal "3" in a row is the same teal as the
   * P3 phase bar on the timeline.
   */
  readonly rich = computed(() => summarySegmentsFor(this.event()));
  readonly accentColor = computed(() => this.rich().color ?? DEFAULT_ROW_COLOR);
  readonly sourceLabel = computed(() => {
    if (this.event().source === 'ctgov') return 'CT.gov';
    return this.brand.agency()?.name ?? this.brand.appDisplayName();
  });

  readonly monogram = computed(() => monogramFor(this.event().company_name));
  /** Stable per-company tint for the monogram fallback (when no logo URL). */
  readonly monogramTint = computed(() => tintFor(this.event().company_name));
  readonly relativeTime = computed(() => formatRelative(this.event().observed_at));

  readonly routerLink = computed<unknown[] | null>(() => {
    const t = this.tenantId();
    const s = this.spaceId();
    if (!t || !s) return null;
    const e = this.event();
    if (e.marker_id) {
      return ['/t', t, 's', s, 'catalysts'];
    }
    if (e.trial_id) {
      return ['/t', t, 's', s, 'manage', 'trials', e.trial_id];
    }
    return null;
  });

  readonly queryParams = computed<Record<string, string> | null>(() => {
    const e = this.event();
    return e.marker_id && this.routerLink() ? { markerId: e.marker_id } : null;
  });
}

function iconFor(t: ChangeEventType): string {
  switch (t) {
    case 'status_changed':
      return 'fa-solid fa-flag';
    case 'date_moved':
      return 'fa-solid fa-calendar-days';
    case 'phase_transitioned':
      return 'fa-solid fa-arrow-right-arrow-left';
    case 'enrollment_target_changed':
      return 'fa-solid fa-users';
    case 'arm_added':
    case 'arm_removed':
      return 'fa-solid fa-vial';
    case 'intervention_changed':
      return 'fa-solid fa-syringe';
    case 'outcome_measure_changed':
      return 'fa-solid fa-bullseye';
    case 'sponsor_changed':
      return 'fa-solid fa-building';
    case 'eligibility_criteria_changed':
    case 'eligibility_changed':
      return 'fa-solid fa-list-check';
    case 'trial_withdrawn':
      return 'fa-solid fa-ban';
    case 'marker_added':
      return 'fa-solid fa-circle-plus';
    case 'marker_removed':
      return 'fa-solid fa-circle-minus';
    case 'marker_updated':
      return 'fa-solid fa-pen-to-square';
    case 'marker_reclassified':
      return 'fa-solid fa-shuffle';
    case 'projection_finalized':
      return 'fa-solid fa-circle-check';
    default:
      return 'fa-solid fa-circle';
  }
}

/**
 * Two-letter initials from a company name. "Eli Lilly" -> "EL",
 * "Roche" -> "RO", "Bristol-Myers Squibb" -> "BM". Multi-word names use
 * first letter of first two words; single-word names use first two letters.
 */
function monogramFor(name: string | null): string {
  if (!name) return '--';
  const cleaned = name.trim();
  if (!cleaned) return '--';
  const words = cleaned.split(/[\s\-_]+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Deterministic slate-tinted palette for the monogram fallback. Sponsors
 * with no logo URL get a stable tint based on the hash of their name so the
 * same company always renders the same color. Stays in the slate family --
 * never brand-coloured, since this is a fallback identity not a real logo.
 */
const MONOGRAM_TINTS = [
  { bg: '#f1f5f9', fg: '#334155', border: '#e2e8f0' }, // slate
  { bg: '#f1f5f9', fg: '#475569', border: '#cbd5e1' },
  { bg: '#e2e8f0', fg: '#334155', border: '#cbd5e1' },
  { bg: '#f8fafc', fg: '#475569', border: '#e2e8f0' },
] as const;

function tintFor(name: string | null): { bg: string; fg: string; border: string } {
  if (!name) return MONOGRAM_TINTS[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return MONOGRAM_TINTS[Math.abs(hash) % MONOGRAM_TINTS.length];
}

/**
 * Compact relative time for the widget's 7-day window. "Just now" < 60s,
 * then "Nm" / "Nh" / "Nd". Past 7d we fall back to a short absolute date,
 * though in practice the widget filters to 7d so that branch is rare.
 */
function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(then).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
