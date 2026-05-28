import { describe, expect, it } from 'vitest';
import { formatEventDateSuffix } from './format-event-date-suffix';
import { FeedItem } from '../../core/models/event.model';

function makeItem(overrides: Partial<FeedItem>): FeedItem {
  return {
    id: 'test-id',
    source_type: 'event',
    title: 'Test event',
    feed_ts: '2026-05-28T10:00:00Z',
    event_date: '2026-05-28',
    category_name: 'Strategy',
    category_id: 'cat-1',
    priority: null,
    entity_level: 'company',
    entity_name: null,
    entity_id: null,
    company_name: null,
    company_logo_url: null,
    tags: [],
    has_thread: false,
    thread_id: null,
    description: null,
    source_url: null,
    change_event_type: null,
    change_payload: null,
    change_source: null,
    has_annotation: false,
    observed_at: null,
    ...overrides,
  } as FeedItem;
}

describe('formatEventDateSuffix', () => {
  it('returns empty string for detected source_type', () => {
    const item = makeItem({ source_type: 'detected', event_date: '2026-05-20' });
    expect(formatEventDateSuffix(item)).toBe('');
  });

  it('returns empty string when event_date and feed_ts are the same day', () => {
    const item = makeItem({
      event_date: '2026-05-28',
      feed_ts: '2026-05-28T14:30:00Z',
    });
    expect(formatEventDateSuffix(item)).toBe('');
  });

  it('returns empty string when event_date is missing', () => {
    const item = makeItem({ event_date: null as unknown as string });
    expect(formatEventDateSuffix(item)).toBe('');
  });

  it('returns empty string when feed_ts is missing', () => {
    const item = makeItem({ feed_ts: null as unknown as string });
    expect(formatEventDateSuffix(item)).toBe('');
  });

  it('returns the formatted suffix when event_date is later than feed_ts day', () => {
    const item = makeItem({
      event_date: '2026-05-29',
      feed_ts: '2026-05-28T10:00:00Z',
    });
    expect(formatEventDateSuffix(item)).toBe(' · May 29, 2026');
  });

  it('returns the formatted suffix when event_date is earlier than feed_ts day', () => {
    const item = makeItem({
      event_date: '2026-04-15',
      feed_ts: '2026-05-28T10:00:00Z',
    });
    expect(formatEventDateSuffix(item)).toBe(' · Apr 15, 2026');
  });

  it('returns empty string for an invalid event_date', () => {
    const item = makeItem({ event_date: 'not-a-date' });
    expect(formatEventDateSuffix(item)).toBe('');
  });

  it('handles marker source_type correctly (same day returns empty)', () => {
    const item = makeItem({
      source_type: 'marker',
      event_date: '2026-05-28',
      feed_ts: '2026-05-28T09:00:00Z',
    });
    expect(formatEventDateSuffix(item)).toBe('');
  });

  it('handles marker source_type correctly (different day returns suffix)', () => {
    const item = makeItem({
      source_type: 'marker',
      event_date: '2026-03-10',
      feed_ts: '2026-05-28T09:00:00Z',
    });
    expect(formatEventDateSuffix(item)).toBe(' · Mar 10, 2026');
  });
});
