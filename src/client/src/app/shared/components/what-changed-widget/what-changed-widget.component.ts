import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ChangeEvent } from '../../../core/models/change-event.model';
import { ChangeEventService } from '../../../core/services/change-event.service';
import { errorMessage } from '../../../core/utils/error-message';
import { ChangeEventRowComponent } from '../change-event-row/change-event-row.component';
import { SkeletonComponent } from '../skeleton/skeleton.component';

/**
 * "What changed" widget for the engagement landing. Calls
 * get_activity_feed with a high-signal whitelist over the last 7 days
 * and renders the top 5 events. Surface 2 of the trial change feed
 * design (docs/superpowers/specs/2026-05-02-trial-change-feed-design.md).
 */
@Component({
  selector: 'app-what-changed-widget',
  standalone: true,
  imports: [RouterLink, ChangeEventRowComponent, SkeletonComponent],
  templateUrl: './what-changed-widget.component.html',
})
export class WhatChangedWidgetComponent {
  private readonly feed = inject(ChangeEventService);

  readonly spaceId = input.required<string>();
  readonly tenantId = input<string | null>(null);

  protected readonly events = signal<ChangeEvent[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly skeletonRows = [0, 1, 2];

  protected readonly activityLink = computed(() => {
    const t = this.tenantId();
    const s = this.spaceId();
    if (!t || !s) return '';
    return `/t/${t}/s/${s}/activity`;
  });

  private readonly loadEffect = effect(() => {
    const sid = this.spaceId();
    if (!sid) return;
    void this.load(sid);
  });

  private async load(spaceId: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const page = await this.feed.getActivityFeed(
        spaceId,
        { date_range: '7d', whitelist: 'high_signal' },
        null,
        5
      );
      this.events.set(page.events);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.events.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
