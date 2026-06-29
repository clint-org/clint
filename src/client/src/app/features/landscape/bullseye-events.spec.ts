import { describe, it, expect } from 'vitest';
import { BullseyeMarker } from '../../core/models/landscape.model';
import { deriveBullseyeEventBuckets, BULLSEYE_EVENT_LIST_CAP } from './bullseye-events';

function ev(id: string, event_date: string): BullseyeMarker {
  return {
    id,
    event_date,
    marker_type_name: 'Topline data',
    shape: 'circle',
    color: '#16a34a',
    projection: 'actual',
    category_name: 'Data',
  };
}

const TODAY = '2026-06-29';

describe('deriveBullseyeEventBuckets', () => {
  it('returns empty buckets for empty input', () => {
    expect(deriveBullseyeEventBuckets([], TODAY)).toEqual({ recent: [], upcoming: [] });
  });

  it('splits past and future on the today boundary (today counts as upcoming)', () => {
    const events = [ev('past', '2026-01-15'), ev('today', TODAY), ev('future', '2026-09-01')];
    const { recent, upcoming } = deriveBullseyeEventBuckets(events, TODAY);
    expect(recent.map((e) => e.id)).toEqual(['past']);
    expect(upcoming.map((e) => e.id)).toEqual(['today', 'future']);
  });

  it('orders recent descending (most recent first) and upcoming ascending (soonest first)', () => {
    const events = [
      ev('p1', '2025-03-01'),
      ev('p2', '2026-02-01'),
      ev('f1', '2027-01-01'),
      ev('f2', '2026-08-01'),
    ];
    const { recent, upcoming } = deriveBullseyeEventBuckets(events, TODAY);
    expect(recent.map((e) => e.id)).toEqual(['p2', 'p1']);
    expect(upcoming.map((e) => e.id)).toEqual(['f2', 'f1']);
  });

  it('caps each list independently', () => {
    const past = Array.from({ length: 5 }, (_, i) =>
      ev(`p${i}`, `2026-0${i + 1}-01`)
    );
    const future = Array.from({ length: 5 }, (_, i) =>
      ev(`f${i}`, `2026-${String(i + 7).padStart(2, '0')}-01`)
    );
    const { recent, upcoming } = deriveBullseyeEventBuckets([...past, ...future], TODAY, 2);
    expect(recent).toHaveLength(2);
    expect(upcoming).toHaveLength(2);
    // Recent keeps the two latest past events; upcoming keeps the two soonest.
    expect(recent.map((e) => e.id)).toEqual(['p4', 'p3']);
    expect(upcoming.map((e) => e.id)).toEqual(['f0', 'f1']);
  });

  it('defaults the cap to BULLSEYE_EVENT_LIST_CAP', () => {
    const past = Array.from({ length: BULLSEYE_EVENT_LIST_CAP + 2 }, (_, i) =>
      ev(`p${i}`, `2026-0${i + 1}-01`)
    );
    const { recent } = deriveBullseyeEventBuckets(past, TODAY);
    expect(recent).toHaveLength(BULLSEYE_EVENT_LIST_CAP);
  });
});
