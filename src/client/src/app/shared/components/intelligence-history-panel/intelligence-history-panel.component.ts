import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import {
  IntelligenceHistoryPayload,
  IntelligenceVersionRow,
} from '../../../core/models/primary-intelligence.model';

/**
 * Inline panel mounted below IntelligenceBlock on every entity detail
 * page. Shows version history for the anchor. Collapsed by default;
 * lazy expands on click. Agency-only affordances (drafts subsection,
 * per-version edit diffs, withdraw / purge) are gated by
 * `currentUserCanEdit`.
 */
@Component({
  selector: 'app-intelligence-history-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  templateUrl: './intelligence-history-panel.component.html',
})
export class IntelligenceHistoryPanelComponent {
  readonly payload = input.required<IntelligenceHistoryPayload>();
  readonly currentUserCanEdit = input<boolean>(false);
  readonly authorMap = input<Record<string, string>>({});

  readonly withdraw = output<{ id: string; changeNote: string }>();
  readonly purgeVersion = output<{ id: string; confirmation: string }>();
  readonly purgeAnchor = output<{ id: string; confirmation: string }>();
  readonly versionRevisionsRequested = output<string>();

  protected readonly expanded = signal(false);

  protected readonly versions = computed<IntelligenceVersionRow[]>(
    () => this.payload().versions ?? [],
  );
  protected readonly versionCount = computed(() => this.versions().length);
  protected readonly latest = computed<IntelligenceVersionRow | null>(
    () => this.versions()[0] ?? null,
  );
  protected readonly canExpand = computed(() => this.versionCount() > 1);

  protected toggle(): void {
    if (!this.canExpand()) return;
    this.expanded.update((v) => !v);
  }

  protected formatDate(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
}
