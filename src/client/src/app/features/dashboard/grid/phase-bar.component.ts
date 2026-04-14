import { Component, computed, inject, input, output } from '@angular/core';

import { TimelineService } from '../../../core/services/timeline.service';

const DEFAULT_COLORS: Record<string, string> = {
  PRECLIN: '#cbd5e1', // slate-300 — before first-in-human, dimmer than P1
  P1: '#94a3b8',
  P2: '#67e8f9',
  P3: '#2dd4bf',
  P4: '#a78bfa',
  APPROVED: '#8b5cf6', // violet-500 — darker than P4 violet to differentiate
  LAUNCHED: '#0d9488', // teal-600 — hero color for the strongest state
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

  phaseType = input.required<string>();
  startDate = input.required<string>();
  endDate = input<string | null>(null);
  startYear = input.required<number>();
  endYear = input.required<number>();
  totalWidth = input.required<number>();

  phaseClick = output<void>();

  protected barX = computed(() =>
    Math.max(
      0,
      this.timeline.dateToX(
        this.startDate(),
        this.startYear(),
        this.endYear(),
        this.totalWidth()
      )
    )
  );

  protected barWidth = computed(() => {
    const endDate = this.endDate();
    if (!endDate) {
      return 0;
    }
    const rawStart = this.timeline.dateToX(
      this.startDate(),
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

  protected barColor = computed(() => DEFAULT_COLORS[this.phaseType()] ?? '#64748b');

  protected labelText = computed(() => this.phaseType());

  protected showLabelInside = computed(() => this.barWidth() >= MIN_LABEL_WIDTH);

  labelColor = computed(() => {
    if (!this.showLabelInside()) return '#64748b';
    return this.barColor();
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
    this.phaseClick.emit();
  }
}
