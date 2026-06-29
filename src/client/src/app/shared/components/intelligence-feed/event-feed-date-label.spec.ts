import { describe, expect, it } from 'vitest';

import { eventFeedDateLabel } from './event-feed-date-label';
import type { EventFeedItem } from '../../../core/models/intelligence-feed-item.model';

const base: EventFeedItem = {
  kind: 'event',
  id: 'e1',
  space_id: 's',
  feed_ts: '2026-03-12T00:00:00Z',
  title: 'Topline',
  entity_type: 'product',
  entity_id: 'p1',
  entity_name: 'Zepbound',
  event_date: '2026-09-01',
  date_precision: 'quarter',
  end_date: null,
  end_date_precision: 'exact',
  is_ongoing: false,
  projection: 'primary',
  is_projected: true,
  significance: 'high',
  visibility: null,
  no_longer_expected: false,
  category_name: 'Clinical',
  marker_shape: 'circle',
  marker_color: '#4ade80',
  marker_inner_mark: 'dot',
  marker_fill_style: 'filled',
  anchor_type: 'asset',
  description: null,
};

describe('eventFeedDateLabel', () => {
  it('prefixes an approximate (quarter) date with ~', () => {
    // event_date 2026-09-01 (month 9) with quarter precision -> Q3 '26
    expect(eventFeedDateLabel(base)).toMatch(/^~Q3/);
  });

  it('renders an exact date without a ~ prefix', () => {
    const label = eventFeedDateLabel({ ...base, date_precision: 'exact' });
    expect(label.startsWith('~')).toBe(false);
    expect(label).toContain('2026');
  });

  it('renders a bounded range for a fuzzy end date', () => {
    const label = eventFeedDateLabel({
      ...base,
      date_precision: 'quarter',
      end_date: '2027-02-15',
      end_date_precision: 'quarter',
    });
    expect(label).toContain('~');
    expect(label).toMatch(/Q3.*Q1|Q3.*–/);
  });
});
