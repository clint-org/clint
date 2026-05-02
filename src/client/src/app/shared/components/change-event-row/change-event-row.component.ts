import { Component, computed, input, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import type { ChangeEvent, ChangeEventType } from '../../../core/models/change-event.model';

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

function summaryFor(e: ChangeEvent): string {
  const p = e.payload;
  switch (e.event_type) {
    case 'status_changed':
      return `Status: ${p['from']} -> ${p['to']}`;
    case 'date_moved':
      return `${p['which_date']} ${p['direction']} ${p['days_diff']}d (${p['from']} -> ${p['to']})`;
    case 'phase_transitioned': {
      const from = (p['from'] as string[] | undefined)?.join('/') ?? '';
      const to = (p['to'] as string[] | undefined)?.join('/') ?? '';
      return `Phase: ${from} -> ${to}`;
    }
    case 'enrollment_target_changed':
      return `Enrollment: ${p['from']} -> ${p['to']} (${p['percent_change']}%)`;
    case 'arm_added':
      return `Arm added: ${p['arm_label']}`;
    case 'arm_removed':
      return `Arm removed: ${p['arm_label']}`;
    case 'intervention_changed':
      return `Intervention changed: ${p['arm_label'] ?? ''}`.trim();
    case 'outcome_measure_changed':
      return `Outcome measure changed: ${p['measure_name'] ?? ''}`.trim();
    case 'sponsor_changed':
      return `Sponsor: ${p['from']} -> ${p['to']}`;
    case 'eligibility_criteria_changed':
    case 'eligibility_changed':
      return `Eligibility criteria changed`;
    case 'trial_withdrawn':
      return `Trial withdrawn from CT.gov (last seen ${p['last_seen_post_date']})`;
    case 'marker_added':
      return `Marker added${e.marker_title ? `: ${e.marker_title}` : ''}`;
    case 'marker_removed':
      return `Marker removed${e.marker_title ? `: ${e.marker_title}` : ''}`;
    case 'marker_updated': {
      const fields = (p['changed_fields'] as string[] | undefined)?.join(', ') ?? '';
      return `Updated: ${fields}`;
    }
    case 'marker_reclassified':
      return `Reclassified`;
    case 'projection_finalized':
      return `Projected -> Actual`;
    default:
      return e.event_type;
  }
}
