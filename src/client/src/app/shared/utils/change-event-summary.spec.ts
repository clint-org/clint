import { describe, expect, it } from 'vitest';
import type { ChangeEvent } from '../../core/models/change-event.model';
import { summarySegmentsFor } from './change-event-summary';

function baseEvent(overrides: Partial<ChangeEvent>): ChangeEvent {
  return {
    id: 'evt-1',
    trial_id: 'trial-1',
    space_id: 'space-1',
    event_type: 'marker_added',
    source: 'ctgov',
    payload: {},
    occurred_at: '2026-05-28T14:00:00Z',
    observed_at: '2026-05-28T14:00:00Z',
    marker_id: 'm-1',
    marker_title: 'Topline Phase 3 readout',
    marker_color: '#0ea5e9',
    marker_type_name: 'Topline readout',
    from_marker_type_name: null,
    to_marker_type_name: null,
    trial_name: 'TRIUMPH-1',
    trial_identifier: 'NCT00000001',
    asset_name: null,
    company_name: 'Novo Nordisk',
    company_logo_url: null,
    ...overrides,
  };
}

function joinText(segments: { text?: string }[]): string {
  return segments.map((s) => s.text ?? '').join('');
}

describe('summarySegmentsFor marker-related events', () => {
  it('marker_added inlines the catalyst date when payload.event_date is present', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_added',
        payload: { event_date: '2026-05-29' },
      })
    );
    expect(joinText(result.segments)).toContain('May 29, 2026');
  });

  it('marker_updated inlines the catalyst date when payload.event_date is present', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: { changed_fields: ['description'], event_date: '2026-05-29' },
      })
    );
    expect(joinText(result.segments)).toContain('May 29, 2026');
  });

  it('marker_updated omits the date suffix when payload.event_date is absent', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: { changed_fields: ['description'] },
      })
    );
    expect(joinText(result.segments)).not.toContain('2026');
  });

  it('marker_reclassified inlines the catalyst date when payload.event_date is present', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_reclassified',
        from_marker_type_name: 'Topline readout',
        to_marker_type_name: 'Interim readout',
        payload: { from_type_id: 'a', to_type_id: 'b', event_date: '2026-05-29' },
      })
    );
    expect(joinText(result.segments)).toContain('May 29, 2026');
  });

  it('marker_reclassified omits the date suffix when payload.event_date is absent', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_reclassified',
        from_marker_type_name: 'Topline readout',
        to_marker_type_name: 'Interim readout',
        payload: { from_type_id: 'a', to_type_id: 'b' },
      }),
    );
    expect(joinText(result.segments)).not.toContain('2026');
  });

  it('projection_finalized still inlines the catalyst date (regression guard)', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'projection_finalized',
        payload: { from: 'projected', to: 'actual', event_date: '2026-05-29' },
      })
    );
    expect(joinText(result.segments)).toContain('May 29, 2026');
  });
});
