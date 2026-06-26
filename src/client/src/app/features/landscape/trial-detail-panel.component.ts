import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { IntelligenceDetailBundle } from '../../core/models/primary-intelligence.model';
import { slidePanelAnimation } from '../../shared/animations/slide-panel.animation';
import { DetailPanelSectionComponent } from '../../shared/components/detail-panel-section.component';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';
import { PiDetailSectionComponent } from '../../shared/components/pi-detail-section/pi-detail-section.component';

/**
 * Right-hand drawer that shows a trial's OWNED primary intelligence when a
 * trial row is clicked in the timeline. A trial owns its PI, so this renders
 * the shared owned-PI block (headline + summary) -- never a reference list.
 * Mutually exclusive with the marker detail pane (both are driven by
 * LandscapeStateService).
 */
@Component({
  selector: 'app-trial-detail-panel',
  imports: [DetailPanelShellComponent, DetailPanelSectionComponent, PiDetailSectionComponent],
  animations: [slidePanelAnimation],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div
        @slidePanel
        class="absolute top-0 right-0 bottom-0 z-30 w-[340px] border-l border-slate-200 bg-white shadow-[-4px_0_16px_rgba(0,0,0,0.08)]"
      >
        <app-detail-panel-shell
          label="Trial intelligence"
          density="compact"
          (closed)="panelClose.emit()"
        >
          <app-detail-panel-section [first]="true">
            @if (record(); as r) {
              <app-pi-detail-section [headline]="r.headline" [summary]="r.summary_md" />
            } @else {
              <p class="text-[12px] text-slate-500">
                No published intelligence for this trial yet.
              </p>
            }
          </app-detail-panel-section>
        </app-detail-panel-shell>
      </div>
    }
  `,
})
export class TrialDetailPanelComponent {
  readonly detail = input<IntelligenceDetailBundle | null>(null);
  readonly open = input<boolean>(false);
  readonly panelClose = output<void>();

  protected readonly record = computed(() => this.detail()?.published?.record ?? null);
}
