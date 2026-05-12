import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';

import {
  PHASE_COLORS,
  PHASE_FALLBACK_COLOR,
  phaseShortLabel,
} from '../../../core/models/phase-colors';
import { TimelineService } from '../../../core/services/timeline.service';

const BAR_HEIGHT = 14;
const CORNER_RADIUS = 3;
const MIN_LABEL_WIDTH = 40;

@Component({
  selector: 'g[app-phase-bar]',
  standalone: true,
  templateUrl: './phase-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PhaseBarComponent {
  private readonly timeline = inject(TimelineService);

  readonly phaseType = input.required<string>();
  readonly startDate = input.required<string>();
  readonly endDate = input<string | null>(null);
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();
  readonly totalWidth = input.required<number>();

  readonly phaseClick = output<void>();

  protected readonly barX = computed(() =>
    Math.max(
      0,
      this.timeline.dateToX(this.startDate(), this.startYear(), this.endYear(), this.totalWidth())
    )
  );

  protected readonly barWidth = computed(() => {
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

  protected readonly barColor = computed(
    () => PHASE_COLORS[this.phaseType()] ?? PHASE_FALLBACK_COLOR
  );

  protected readonly labelText = computed(() => phaseShortLabel(this.phaseType()));

  protected readonly showLabelInside = computed(() => this.barWidth() >= MIN_LABEL_WIDTH);

  readonly labelColor = computed(() => {
    if (!this.showLabelInside()) return '#64748b';
    return this.barColor();
  });

  protected readonly labelX = computed(() => {
    if (this.showLabelInside()) {
      return this.barX() + this.barWidth() / 2;
    }
    return this.barX() + this.barWidth() + 4;
  });

  protected readonly labelAnchor = computed(() => (this.showLabelInside() ? 'middle' : 'start'));

  protected barHeight = BAR_HEIGHT;
  protected cornerRadius = CORNER_RADIUS;

  onClick(): void {
    this.phaseClick.emit();
  }
}
