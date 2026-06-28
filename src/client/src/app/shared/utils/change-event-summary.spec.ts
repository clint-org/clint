import { describe, expect, it } from 'vitest';
import type { ChangeEvent } from '../../core/models/change-event.model';
import type { FeedItem } from '../../core/models/event.model';
import {
  feedItemToChangeEvent,
  flattenSummarySegments,
  summaryFor,
  summarySegmentsFor,
} from './change-event-summary';

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

  it('marker_updated renders each changed field as old → new', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: {
          changed_fields: ['title', 'description'],
          changes: {
            title: { from: 'Old title', to: 'New title' },
            description: { from: 'Old text', to: 'New text' },
          },
          event_date: '2026-06-20',
          marker_title: 'PDUFA decision',
          marker_type_name: 'Topline readout',
          marker_color: '#0ea5e9',
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('Old title');
    expect(text).toContain('New title');
    expect(text).toContain('Old text');
    expect(text).toContain('New text');
  });

  it('marker_updated truncates values longer than 40 chars with ellipsis', () => {
    const longOld = 'A'.repeat(60);
    const longNew = 'B'.repeat(60);
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: {
          changed_fields: ['description'],
          changes: { description: { from: longOld, to: longNew } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('…');
    expect(text).not.toContain(longOld);
    expect(text).not.toContain(longNew);
  });

  it('marker_updated legacy slim payload (changed_fields only) still renders field names', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: { changed_fields: ['title', 'description'] },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('title');
    expect(text).toContain('description');
    expect(text).not.toContain('→');
  });

  it('marker_added picks up marker_title gracefully when ChangeEvent.marker_title is null', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_added',
        marker_title: null,
        payload: {
          event_date: '2026-06-20',
          marker_title: 'PDUFA decision (from payload)',
          marker_type_name: 'Topline readout',
        },
      })
    );
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it('date_moved with simultaneous description edit renders BOTH primary and secondary', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'date_moved',
        marker_title: 'TRIUMPH-1 readout',
        payload: {
          which_date: 'event_date',
          from: '2026-10-19',
          to: '2026-10-21',
          days_diff: 2,
          direction: 'slip',
          changes: { description: { from: 'Old desc', to: 'New desc' } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('event date');
    expect(text).toContain('Old desc');
    expect(text).toContain('New desc');
  });

  it('date_moved still reads legacy secondary_changes key (in-flight rows)', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'date_moved',
        marker_title: 'TRIUMPH-1 readout',
        payload: {
          which_date: 'event_date',
          from: '2026-10-19',
          to: '2026-10-21',
          days_diff: 2,
          direction: 'slip',
          secondary_changes: { description: { from: 'Old desc', to: 'New desc' } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('Old desc');
    expect(text).toContain('New desc');
  });

  it('projection_finalized with simultaneous title edit renders both', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'projection_finalized',
        payload: {
          from: 'projected',
          to: 'actual',
          event_date: '2026-06-20',
          changes: { title: { from: 'Old', to: 'New' } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('projected');
    expect(text).toContain('actual');
    expect(text).toContain('Old');
    expect(text).toContain('New');
  });

  it('marker_reclassified with simultaneous end_date edit renders both', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_reclassified',
        from_marker_type_name: 'Interim readout',
        to_marker_type_name: 'Topline readout',
        payload: {
          from_type_id: 'a',
          to_type_id: 'b',
          event_date: '2026-06-20',
          changes: { end_date: { from: '2026-06-01', to: '2026-07-15' } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('Interim readout');
    expect(text).toContain('Topline readout');
    expect(text).toContain('Jun 1, 2026');
    expect(text).toContain('Jul 15, 2026');
  });
});

describe('status_changed enum humanization (P2.6)', () => {
  it('humanizes raw CT.gov status enums in the plain summary', () => {
    expect(
      summaryFor(
        baseEvent({
          event_type: 'status_changed',
          payload: { from: 'RECRUITING', to: 'ACTIVE_NOT_RECRUITING' },
        }),
      ),
    ).toBe('Status: Recruiting → Active Not Recruiting');
  });

  it('humanizes raw status enums in the rich segments', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'status_changed',
        payload: { from: 'RECRUITING', to: 'ACTIVE_NOT_RECRUITING' },
      }),
    );
    const old = result.segments.find((s) => s.kind === 'old');
    const next = result.segments.find((s) => s.kind === 'new');
    expect(old?.text).toBe('Recruiting');
    expect(next?.text).toBe('Active Not Recruiting');
    expect(result.segments.some((s) => s.kind === 'arrow')).toBe(true);
  });

  it('tolerates a missing status value without throwing', () => {
    expect(
      summaryFor(
        baseEvent({ event_type: 'status_changed', payload: { from: 'RECRUITING' } }),
      ),
    ).toContain('Recruiting');
  });
});

describe('trial_withdrawn and trial_restored summaries', () => {
  it('summaryFor trial_withdrawn returns the registry-removal text', () => {
    expect(
      summaryFor(baseEvent({ event_type: 'trial_withdrawn', payload: { nct_id: 'NCT1', reason: 'withdrawn' } })),
    ).toBe('Removed from the CT.gov registry');
  });

  it('summaryFor trial_withdrawn never contains "undefined"', () => {
    expect(
      summaryFor(baseEvent({ event_type: 'trial_withdrawn', payload: {} })),
    ).not.toContain('undefined');
  });

  it('summaryFor trial_restored with date includes both the base text and the date', () => {
    const result = summaryFor(
      baseEvent({
        event_type: 'trial_restored',
        payload: { nct_id: 'NCT1', last_update_posted_date: '2026-06-20' },
      }),
    );
    expect(result).toContain('Restored to CT.gov');
    expect(result).toContain('2026-06-20');
  });

  it('summaryFor trial_restored with empty payload returns the base text without "undefined"', () => {
    const result = summaryFor(
      baseEvent({ event_type: 'trial_restored', payload: {} }),
    );
    expect(result).toBe('Restored to CT.gov');
    expect(result).not.toContain('undefined');
  });

  it('summarySegmentsFor trial_withdrawn returns the registry-removal text', () => {
    const result = summarySegmentsFor(
      baseEvent({ event_type: 'trial_withdrawn', payload: {} }),
    );
    expect(joinText(result.segments)).toBe('Removed from the CT.gov registry');
  });

  it('summarySegmentsFor trial_restored with date includes the date', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'trial_restored',
        payload: { last_update_posted_date: '2026-06-20' },
      }),
    );
    const text = joinText(result.segments);
    expect(text).toContain('Restored to CT.gov');
    expect(text).toContain('2026-06-20');
  });

  it('summarySegmentsFor trial_restored with empty payload returns base text without "undefined"', () => {
    const result = summarySegmentsFor(
      baseEvent({ event_type: 'trial_restored', payload: {} }),
    );
    const text = joinText(result.segments);
    expect(text).toBe('Restored to CT.gov');
    expect(text).not.toContain('undefined');
  });
});

function detectedFeedItem(overrides: Partial<FeedItem>): FeedItem {
  return {
    source_type: 'detected',
    id: 'ce-1',
    title: 'Marker Added',
    feed_ts: '2026-06-27T15:35:00Z',
    event_date: '2025-09-15',
    category_name: 'Catalyst lifecycle',
    category_id: null,
    priority: null,
    entity_level: 'trial',
    entity_name: 'VANQUISH-1',
    entity_id: 'trial-1',
    company_name: 'Viking Therapeutics',
    company_id: 'co-1',
    asset_id: 'asset-1',
    asset_name: 'VK2735',
    trial_id: 'trial-1',
    trial_name: 'VANQUISH-1',
    tags: [],
    has_thread: false,
    thread_id: null,
    description: null,
    source_url: null,
    change_event_type: 'marker_added',
    change_payload: {},
    change_source: 'ctgov',
    has_annotation: false,
    observed_at: null,
    company_logo_url: null,
    is_projected: null,
    marker_type_shape: null,
    marker_type_color: null,
    marker_type_inner_mark: null,
    category_color: null,
    ...overrides,
  };
}

describe('feedItemToChangeEvent', () => {
  it('reads marker context out of the change payload so marker_added composes a real title', () => {
    const item = detectedFeedItem({
      change_payload: {
        marker_title: 'FDA Accepts VK2735 NDA for Review',
        marker_type_name: 'Acceptance',
        event_date: '2025-09-15',
      },
    });
    const summary = flattenSummarySegments(summarySegmentsFor(feedItemToChangeEvent(item)).segments);
    // The raw row title was the generic "Marker Added"; the composed summary
    // surfaces the actual marker that was added.
    expect(item.title).toBe('Marker Added');
    expect(summary).toContain('Marker added: FDA Accepts VK2735 NDA for Review');
    expect(summary).toContain('Acceptance');
  });

  it('falls back to a bare "Marker added" when the payload carries no marker title', () => {
    const summary = flattenSummarySegments(
      summarySegmentsFor(feedItemToChangeEvent(detectedFeedItem({}))).segments,
    );
    expect(summary).toBe('Marker added');
  });
});

describe('flattenSummarySegments', () => {
  it('joins segment text and renders the arrow segment as an arrow glyph', () => {
    expect(
      flattenSummarySegments([
        { kind: 'plain', text: 'Status: ' },
        { kind: 'old', text: 'Recruiting' },
        { kind: 'arrow' },
        { kind: 'new', text: 'Completed' },
      ]),
    ).toBe('Status: Recruiting→Completed');
  });
});
