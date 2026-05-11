/**
 * Smoke tests for EntityEventsPanelService exports.
 *
 * The component itself (EntityEventsPanelComponent) uses Angular-compiled
 * decorators that require @angular/compiler at runtime, making it
 * incompatible with the node-environment vitest runner. Component-level
 * integration coverage lives in the page-level Playwright e2e specs (Task 9).
 *
 * These tests verify that the service module's shape is stable: the service
 * class is exported and the interface type contracts are honored.
 */
import { describe, expect, it } from 'vitest';

import {
  EntityEventsPanelService,
  type EntityEventRow,
  type FetchEntityEventsParams,
} from './entity-events-panel.service';

describe('EntityEventsPanelService', () => {
  it('is defined and named correctly', () => {
    expect(EntityEventsPanelService).toBeDefined();
    expect(EntityEventsPanelService.name).toBe('EntityEventsPanelService');
  });

  it('exposes a fetch method', () => {
    expect(typeof EntityEventsPanelService.prototype.fetch).toBe('function');
  });
});

describe('FetchEntityEventsParams interface', () => {
  it('accepts a valid params object', () => {
    const params: FetchEntityEventsParams = {
      spaceId: 'space-1',
      entityLevel: 'trial',
      entityId: 'trial-1',
      limit: 10,
    };
    expect(params.spaceId).toBe('space-1');
    expect(params.entityLevel).toBe('trial');
  });

  it('limit is optional', () => {
    const params: FetchEntityEventsParams = {
      spaceId: 'space-1',
      entityLevel: 'product',
      entityId: 'prod-1',
    };
    expect(params.limit).toBeUndefined();
  });
});

describe('EntityEventRow interface', () => {
  it('accepts a fully-populated row object', () => {
    const row: EntityEventRow = {
      id: 'ev-1',
      title: 'Phase 3 readout',
      event_date: '2025-06-15',
      category_name: 'Clinical',
      category_id: 'cat-1',
      priority: 'high',
      entity_level: 'trial',
      entity_name: 'TRIAL-001',
      entity_id: 'trial-1',
      company_name: 'Acme Pharma',
      tags: ['oncology'],
      has_thread: false,
      thread_id: null,
      description: null,
    };
    expect(row.id).toBe('ev-1');
    expect(row.entity_level).toBe('trial');
    expect(row.tags).toHaveLength(1);
  });
});
