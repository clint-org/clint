import { describe, expect, it } from 'vitest';
import type { FeedItem } from '../../core/models/event.model';
import { buildEventsExportColumns } from './events-export.util';
import { buildExportSheet } from '../../shared/export/grid-sheet.util';

function fixture(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    source_type: 'analyst',
    id: 'e1',
    title: 'Phase 3 Topline Results',
    feed_ts: '2026-05-15T09:30:00.000Z',
    event_date: '2026-05-15',
    category_name: 'Clinical',
    category_id: 'c1',
    priority: 'high',
    entity_level: 'asset',
    entity_name: 'Farxiga',
    entity_id: 'a1',
    company_name: 'AstraZeneca',
    company_id: 'co1',
    asset_id: 'a1',
    asset_name: 'Farxiga',
    trial_id: null,
    trial_name: null,
    tags: ['readout', 'hfpef'],
    has_thread: false,
    thread_id: null,
    description: 'DELIVER met its primary endpoint.',
    source_url: 'https://example.com',
    change_event_type: null,
    change_payload: null,
    change_source: null,
    has_annotation: false,
    observed_at: null,
    company_logo_url: null,
    ...overrides,
  } as FeedItem;
}

const display = {
  title: (i: FeedItem) => i.title ?? '',
  entity: (i: FeedItem) => i.entity_name ?? '--',
};

describe('buildEventsExportColumns', () => {
  it('carries visible columns plus detail-panel row fields with date cells', () => {
    const columns = buildEventsExportColumns(display);
    const spec = buildExportSheet('Events', columns, [fixture()]);
    expect(spec.columns.map((c) => c.header)).toEqual([
      'Logged',
      'Event date',
      'Source',
      'Title',
      'Category',
      'Entity',
      'Company',
      'Asset',
      'Trial',
      'Priority',
      'Tags',
      'Description',
      'Source URL',
    ]);
    const row = spec.rows[0];
    expect(row['c0']).toEqual(new Date('2026-05-15T09:30:00.000Z'));
    expect(row['c1']).toEqual(new Date(Date.UTC(2026, 4, 15)));
    expect(row['c2']).toBe('Analyst');
    expect(row['c9']).toBe('High');
    expect(row['c10']).toBe('readout, hfpef');
    expect(row['c11']).toBe('DELIVER met its primary endpoint.');
  });

  it('renders title and entity through the page display functions', () => {
    const columns = buildEventsExportColumns({
      title: () => 'Composed change summary',
      entity: () => 'Industry',
    });
    const spec = buildExportSheet('Events', columns, [fixture({ source_type: 'detected' })]);
    expect(spec.rows[0]['c3']).toBe('Composed change summary');
    expect(spec.rows[0]['c5']).toBe('Industry');
    expect(spec.rows[0]['c2']).toBe('Detected');
  });
});
