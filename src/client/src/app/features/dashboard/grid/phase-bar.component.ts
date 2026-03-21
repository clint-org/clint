import { Component, computed, inject, input, output } from '@angular/core';

import { TrialPhase } from '../../../core/models/trial.model';
import { TimelineService } from '../../../core/services/timeline.service';

const DEFAULT_COLORS: Record<string, string> = {
  P1: '#94a3b8',
  P2: '#67e8f9',
  P3: '#2dd4bf',
  P4: '#a78bfa',
  OBS: '#fbbf24',
};

const BAR_HEIGHT = 14;
const CORNER_RADIUS = 3;
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
    Math.max(
      0,
      this.timeline.dateToX(
        this.phase().start_date,
        this.startYear(),
        this.endYear(),
        this.totalWidth()
      )
    )
  );

  protected barWidth = computed(() => {
    const endDate = this.phase().end_date;
    if (!endDate) {
      return 0;
    }
    const rawStart = this.timeline.dateToX(
      this.phase().start_date,
      this.startYear(),
      this.endYear(),
      this.totalWidth()
    );
    const endX = Math.min(
      this.totalWidth(),
      this.timeline.dateToX(endDate, this.startYear(), this.endYear(), this.totalWidth())
    );
    const clampedStart = Math.max(0, rawStart);
    return Math.max(0, endX - clampedStart);
  });

  protected barColor = computed(() => {
    const phase = this.phase();
    return phase.color ?? DEFAULT_COLORS[phase.phase_type] ?? '#64748b';
  });

  protected labelText = computed(() => this.phase().phase_type);

  protected showLabelInside = computed(() => this.barWidth() >= MIN_LABEL_WIDTH);

  protected insideLabelColor = computed(() => {
    const hex = this.barColor().replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    // Relative luminance per WCAG 2.1
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#1e293b' : '#ffffff';
  });

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
