import { Component, computed, inject, input, output } from '@angular/core';

import { TrialPhase } from '../../../core/models/trial.model';
import { TimelineService } from '../../../core/services/timeline.service';

const DEFAULT_COLORS: Record<string, string> = {
  P1: '#60a5fa',
  P2: '#34d399',
  P3: '#f97316',
  P4: '#a855f7',
  OBS: '#6b7280',
};

const BAR_HEIGHT = 24;
const CORNER_RADIUS = 4;
const MIN_LABEL_WIDTH = 40;

@Component({
  selector: 'g[app-phase-bar]',
  standalone: true,
  templateUrl: './phase-bar.component.html',
})
export class PhaseBarComponent {
  private readonly timeline = inject(TimelineService);

  phase = input.required<TrialPhase>();
  startYear = input.required<number>();
  endYear = input.required<number>();
  totalWidth = input.required<number>();

  phaseClick = output<TrialPhase>();

  protected barX = computed(() =>
    this.timeline.dateToX(
      this.phase().start_date,
      this.startYear(),
      this.endYear(),
      this.totalWidth(),
    ),
  );

  protected barWidth = computed(() => {
    const endDate = this.phase().end_date;
    if (!endDate) {
      return 0;
    }
    const endX = this.timeline.dateToX(
      endDate,
      this.startYear(),
      this.endYear(),
      this.totalWidth(),
    );
    return Math.max(0, endX - this.barX());
  });

  protected barColor = computed(() => {
    const phase = this.phase();
    return phase.color ?? DEFAULT_COLORS[phase.phase_type] ?? '#6b7280';
  });

  protected labelText = computed(() => this.phase().label ?? this.phase().phase_type);

  protected showLabelInside = computed(() => this.barWidth() >= MIN_LABEL_WIDTH);

  protected labelX = computed(() => {
    if (this.showLabelInside()) {
      return this.barX() + this.barWidth() / 2;
    }
    return this.barX() + this.barWidth() + 4;
  });

  protected labelAnchor = computed(() => (this.showLabelInside() ? 'middle' : 'start'));

  protected barHeight = BAR_HEIGHT;
  protected cornerRadius = CORNER_RADIUS;

  onClick(): void {
    this.phaseClick.emit(this.phase());
  }
}
