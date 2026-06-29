/**
 * Tests for ActivityPageComponent (read-only Activity log at /activity).
 *
 * The unit runner is a plain node environment (vitest.units.config.ts) with no
 * Angular compiler, so we verify the exported pure filter helper directly and
 * assert the component/template contract by source (readFileSync). This follows
 * the same pattern used by taxonomies-help.component.spec.ts and other component
 * specs in this codebase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildDetectedFilters } from './activity-filters';

const ts = readFileSync(join(__dirname, 'activity-page.component.ts'), 'utf8');
const html = readFileSync(join(__dirname, 'activity-page.component.html'), 'utf8');

describe('buildDetectedFilters (detected-only query shape)', () => {
  it('pins sourceType to detected', () => {
    expect(buildDetectedFilters().sourceType).toBe('detected');
  });

  it('applies no date / category / tag / priority narrowing', () => {
    const f = buildDetectedFilters();
    expect(f.dateFrom).toBeNull();
    expect(f.dateTo).toBeNull();
    expect(f.entityLevel).toBeNull();
    expect(f.entityId).toBeNull();
    expect(f.categoryNames).toEqual([]);
    expect(f.tags).toEqual([]);
    expect(f.priority).toBeNull();
    expect(f.search).toBeNull();
  });

  it('sorts newest first by feed_ts', () => {
    const f = buildDetectedFilters();
    expect(f.sortField).toBe('feed_ts');
    expect(f.sortDir).toBe('desc');
  });
});

describe('ActivityPageComponent contract', () => {
  it('is a standalone OnPush component with the correct class name', () => {
    expect(ts).toContain('export class ActivityPageComponent');
    expect(ts).toContain('ChangeDetectionStrategy.OnPush');
  });

  it('fetches the detected feed via EventService.getEventsPageData', () => {
    expect(ts).toContain("from '../../core/services/event.service'");
    expect(ts).toContain('getEventsPageData(');
    expect(ts).toContain('buildDetectedFilters()');
  });

  it('resolves spaceId and tenantId from the route', () => {
    expect(ts).toContain("getRouteParam('spaceId')");
    expect(ts).toContain("getRouteParam('tenantId')");
    expect(ts).toContain('paramMap.get(name)');
  });

  it('renders the detail panel read-only (canEdit false)', () => {
    expect(html).toContain('app-event-detail-panel');
    expect(html).toContain('[canEdit]="false"');
    expect(html).toContain('[selectedFeedItem]="item"');
  });

  it('exposes NO create/log-event affordance', () => {
    expect(html).not.toContain('Log event');
    expect(html.toLowerCase()).not.toContain('opencreatemodal');
    expect(ts).not.toContain('openCreateModal');
    // No action button is projected anywhere on this read-only page.
    expect(html).not.toContain('p-button');
  });

  it('wires no edit or delete affordance on the detail panel', () => {
    expect(html).not.toContain('(edit)=');
    expect(html).not.toContain('(delete)=');
    expect(ts).not.toContain('openEditModal');
    expect(ts).not.toContain('onDeleteEvent');
  });

  it('renders detected change rows (rich summary segments + change type)', () => {
    expect(ts).toContain('getDetectedSummary(');
    expect(html).toContain('getDetectedSummary(item).segments');
    expect(html).toContain('changeTypeLabel(item)');
  });

  it('names what Activity is in the empty state and marks it read-only', () => {
    expect(html).toContain('No detected changes yet.');
    expect(html.toLowerCase()).toContain('read-only');
  });
});
