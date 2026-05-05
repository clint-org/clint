import { Component, computed, inject, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { ChangeEvent, ChangeEventType } from '../../../core/models/change-event.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { summaryFor } from '../../utils/change-event-summary';

@Component({
  selector: 'app-change-event-row',
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: './change-event-row.component.html',
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
  readonly summary = computed(() => summaryFor(this.event()));
  readonly sourceLabel = computed(() => {
    if (this.event().source === 'ctgov') return 'CT.GOV';
    return this.brand.agency()?.name ?? this.brand.appDisplayName();
  });

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
