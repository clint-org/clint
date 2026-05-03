import { Component, computed, input, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import type { ChangeEvent, ChangeEventType } from '../../../core/models/change-event.model';
import { summaryFor } from '../../utils/change-event-summary';

@Component({
  selector: 'app-change-event-row',
  standalone: true,
  imports: [DatePipe, JsonPipe, ButtonModule],
  templateUrl: './change-event-row.component.html',
})
export class ChangeEventRowComponent {
  readonly event = input.required<ChangeEvent>();
  readonly expanded = signal(false);

  readonly iconClass = computed(() => iconFor(this.event().event_type));
  readonly summary = computed(() => summaryFor(this.event()));
  readonly sourceLabel = computed(() => (this.event().source === 'ctgov' ? 'CT.GOV' : 'ANALYST'));

  toggle(): void {
    this.expanded.update((v) => !v);
  }
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
