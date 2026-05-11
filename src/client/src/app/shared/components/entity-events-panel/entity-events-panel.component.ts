import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  EntityEventRow,
  EntityEventsPanelService,
} from './entity-events-panel.service';

@Component({
  selector: 'app-entity-events-panel',
  imports: [DatePipe, RouterLink],
  templateUrl: './entity-events-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityEventsPanelComponent {
  private readonly service = inject(EntityEventsPanelService);

  readonly spaceId = input.required<string>();
  readonly tenantId = input.required<string>();
  readonly entityLevel = input.required<'trial' | 'product' | 'company'>();
  readonly entityId = input.required<string>();
  readonly limit = input<number>(20);

  protected readonly rows = signal<EntityEventRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly seeAllLink = computed(() => [
    '/t', this.tenantId(), 's', this.spaceId(), 'events',
  ]);

  protected readonly seeAllQueryParams = computed(() => ({
    entityLevel: this.entityLevel(),
    entityId: this.entityId(),
  }));

  constructor() {
    effect(() => {
      // Re-fetch whenever any required input changes.
      const space = this.spaceId();
      const level = this.entityLevel();
      const id = this.entityId();
      const lim = this.limit();
      if (!space || !id) return;
      void this.load(space, level, id, lim);
    });
  }

  private async load(
    spaceId: string,
    entityLevel: 'trial' | 'product' | 'company',
    entityId: string,
    limit: number,
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.service.fetch({ spaceId, entityLevel, entityId, limit });
      this.rows.set(data);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load events.');
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
