import { signal } from '@angular/core';

import {
  IntelligenceEntityType,
  IntelligenceHistoryPayload,
  IntelligenceVersionRevision,
} from '../../../core/models/primary-intelligence.model';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';

/**
 * Reusable state holder for the history panel on detail pages. Each
 * detail page constructs one of these and binds the panel to its
 * signals. Centralizes the lazy-load + revisions cache pattern so
 * every page does not re-implement it.
 */
export class IntelligenceHistoryHost {
  readonly payload = signal<IntelligenceHistoryPayload>({
    current: null,
    draft: null,
    versions: [],
    events: [],
  });

  constructor(private readonly service: PrimaryIntelligenceService) {}

  async load(
    spaceId: string,
    entityType: IntelligenceEntityType,
    entityId: string,
  ): Promise<void> {
    this.payload.set(
      await this.service.loadHistory(spaceId, entityType, entityId),
    );
  }

  async loadVersionRevisions(versionId: string): Promise<IntelligenceVersionRevision[]> {
    return this.service.loadVersionRevisions(versionId);
  }

  async withdraw(id: string, changeNote: string): Promise<void> {
    await this.service.withdraw(id, changeNote);
  }

  async purge(id: string, confirmation: string, purgeAnchor = false): Promise<void> {
    await this.service.purge(id, confirmation, purgeAnchor);
  }
}
