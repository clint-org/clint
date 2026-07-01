/**
 * Tests for ActivityPageComponent (read-only Activity log at /activity).
 *
 * The unit runner is a plain node environment (vitest.units.config.ts) with no
 * Angular compiler, so we verify the exported pure filter helpers directly and
 * assert the component/template contract by source (readFileSync). This follows
 * the same pattern used by taxonomies-help.component.spec.ts and other component
 * specs in this codebase.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_SOURCE_OPTIONS,
  ACTIVITY_TYPE_OPTIONS,
  changeTypeLabel,
} from './activity-filters';

const ts = readFileSync(join(__dirname, 'activity-page.component.ts'), 'utf8');
const html = readFileSync(join(__dirname, 'activity-page.component.html'), 'utf8');

describe('activity filter options', () => {
  it('enumerates the three change sources with human labels', () => {
    expect(ACTIVITY_SOURCE_OPTIONS).toEqual([
      { label: 'CT.gov', value: 'ctgov' },
      { label: 'Analyst', value: 'analyst' },
      { label: 'Import', value: 'source_import' },
    ]);
  });

  it('offers a type option for every change-event type, sorted by label', () => {
    expect(ACTIVITY_TYPE_OPTIONS.length).toBe(18);
    const labels = ACTIVITY_TYPE_OPTIONS.map((o) => o.label);
    expect([...labels].sort((a, b) => a.localeCompare(b))).toEqual(labels);
  });
});

describe('changeTypeLabel', () => {
  it('renders the marker_* discriminators as user-facing "Event ..." copy', () => {
    expect(changeTypeLabel('marker_added')).toBe('Event added');
    expect(changeTypeLabel('marker_removed')).toBe('Event removed');
    expect(changeTypeLabel('marker_updated')).toBe('Event edited');
    expect(changeTypeLabel('marker_reclassified')).toBe('Event reclassified');
  });

  it('humanizes a snake_case type', () => {
    expect(changeTypeLabel('date_moved')).toBe('Date moved');
    expect(changeTypeLabel('phase_transitioned')).toBe('Phase transitioned');
  });

  it('renders a dash for a null type', () => {
    expect(changeTypeLabel(null)).toBe('--');
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
  });

  it('drives filters through the shared grid state and query mapper', () => {
    expect(ts).toContain('createGridState');
    expect(ts).toContain('buildServerQuery');
    // sourceType is pinned so the feed never widens beyond detected changes.
    expect(ts).toContain("forcedSourceType: 'detected'");
  });

  it('declares filterable columns for logged date, source, and type', () => {
    expect(ts).toContain("field: 'feed_ts'");
    expect(ts).toContain("field: 'change_source'");
    expect(ts).toContain("field: 'change_event_type'");
  });

  it('renders the grid toolbar and per-column filter controls', () => {
    expect(html).toContain('app-grid-toolbar');
    expect(html).toContain('p-column-filter');
    expect(html).toContain('field="change_source"');
    expect(html).toContain('field="change_event_type"');
    expect(html).toContain('field="feed_ts"');
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

  it('exposes NO create/log-event or edit/delete affordance', () => {
    expect(html).not.toContain('Log event');
    expect(ts).not.toContain('openCreateModal');
    expect(ts).not.toContain('openEditModal');
    expect(ts).not.toContain('onDeleteEvent');
    expect(html).not.toContain('(edit)=');
    expect(html).not.toContain('(delete)=');
  });

  it('renders detected change rows (rich summary segments + change type)', () => {
    expect(ts).toContain('getDetectedSummary(');
    expect(html).toContain('getDetectedSummary(item).segments');
    expect(html).toContain('changeTypeLabel(item)');
  });

  it('names what Activity is in the empty state and distinguishes the filtered case', () => {
    expect(html).toContain('No detected changes yet.');
    expect(html.toLowerCase()).toContain('read-only');
    expect(html).toContain('No detected changes match your filters.');
  });
});
