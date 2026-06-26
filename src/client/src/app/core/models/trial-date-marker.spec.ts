import { describe, expect, it } from 'vitest';

import {
  TRIAL_END_TITLE,
  TRIAL_START_TITLE,
  isCtgovOwnedMarker,
  planTrialDateMarker,
  projectionForDate,
  selectTrialEndMarker,
  selectTrialStartMarker,
} from './trial-date-marker';
import {
  TRIAL_END_MARKER_TYPE_ID,
  TRIAL_START_MARKER_TYPE_ID,
} from './trial-phase-span';

const PCD_TYPE = 'a0000000-0000-0000-0000-000000000008';

function marker(over: Partial<{
  id: string;
  marker_type_id: string;
  event_date: string | null;
  metadata: Record<string, unknown> | null;
}>) {
  return {
    id: 'm',
    marker_type_id: TRIAL_START_MARKER_TYPE_ID,
    event_date: '2024-01-01',
    metadata: null,
    ...over,
  };
}

describe('isCtgovOwnedMarker', () => {
  it('is true only when metadata.source === ctgov', () => {
    expect(isCtgovOwnedMarker({ metadata: { source: 'ctgov' } })).toBe(true);
  });

  it('is false for analyst / un-owned / missing metadata', () => {
    expect(isCtgovOwnedMarker({ metadata: { source: 'analyst' } })).toBe(false);
    expect(isCtgovOwnedMarker({ metadata: null })).toBe(false);
    expect(isCtgovOwnedMarker(null)).toBe(false);
    expect(isCtgovOwnedMarker(undefined)).toBe(false);
  });
});

describe('selectTrialStartMarker / selectTrialEndMarker', () => {
  it('picks the earliest Trial Start marker', () => {
    const markers = [
      marker({ id: 'late', event_date: '2024-06-01' }),
      marker({ id: 'early', event_date: '2024-01-01' }),
      marker({ id: 'end', marker_type_id: TRIAL_END_MARKER_TYPE_ID, event_date: '2023-01-01' }),
    ];
    expect(selectTrialStartMarker(markers)?.id).toBe('early');
  });

  it('picks the latest Trial End marker and ignores PCD fallback', () => {
    const markers = [
      marker({ id: 'pcd', marker_type_id: PCD_TYPE, event_date: '2030-01-01' }),
      marker({ id: 'end-early', marker_type_id: TRIAL_END_MARKER_TYPE_ID, event_date: '2025-01-01' }),
      marker({ id: 'end-late', marker_type_id: TRIAL_END_MARKER_TYPE_ID, event_date: '2026-01-01' }),
    ];
    expect(selectTrialEndMarker(markers)?.id).toBe('end-late');
  });

  it('returns null when no matching marker exists or list is empty', () => {
    expect(selectTrialStartMarker([])).toBeNull();
    expect(selectTrialStartMarker(null)).toBeNull();
    expect(selectTrialEndMarker([marker({ marker_type_id: PCD_TYPE })])).toBeNull();
  });

  it('skips markers with no event_date', () => {
    const markers = [
      marker({ id: 'nulled', event_date: null }),
      marker({ id: 'real', event_date: '2024-03-03' }),
    ];
    expect(selectTrialStartMarker(markers)?.id).toBe('real');
  });
});

describe('projectionForDate', () => {
  it('is actual for today-or-past, company for future', () => {
    expect(projectionForDate('2024-01-01', '2026-06-26')).toBe('actual');
    expect(projectionForDate('2026-06-26', '2026-06-26')).toBe('actual');
    expect(projectionForDate('2030-01-01', '2026-06-26')).toBe('company');
  });
});

describe('planTrialDateMarker', () => {
  const base = {
    markerTypeId: TRIAL_START_MARKER_TYPE_ID,
    title: TRIAL_START_TITLE,
    today: '2026-06-26',
  };

  it('locked -> none even when the date changed', () => {
    const plan = planTrialDateMarker({
      ...base,
      existing: { id: 'm1' },
      locked: true,
      oldDate: '2024-01-01',
      newDate: '2025-01-01',
    });
    expect(plan.action).toBe('none');
  });

  it('unchanged -> none', () => {
    expect(
      planTrialDateMarker({
        ...base,
        existing: { id: 'm1' },
        locked: false,
        oldDate: '2024-01-01',
        newDate: '2024-01-01',
      }).action,
    ).toBe('none');
    expect(
      planTrialDateMarker({
        ...base,
        existing: null,
        locked: false,
        oldDate: null,
        newDate: null,
      }).action,
    ).toBe('none');
  });

  it('set + existing analyst marker -> update with recomputed projection', () => {
    const plan = planTrialDateMarker({
      ...base,
      existing: { id: 'm1' },
      locked: false,
      oldDate: '2024-01-01',
      newDate: '2030-09-09',
    });
    expect(plan).toEqual({
      action: 'update',
      markerId: 'm1',
      update: { event_date: '2030-09-09', projection: 'company' },
    });
  });

  it('set + no marker -> create an analyst-owned Trial Start (actual for past date)', () => {
    const plan = planTrialDateMarker({
      ...base,
      existing: null,
      locked: false,
      oldDate: null,
      newDate: '2024-01-01',
    });
    expect(plan).toEqual({
      action: 'create',
      create: {
        marker_type_id: TRIAL_START_MARKER_TYPE_ID,
        title: TRIAL_START_TITLE,
        event_date: '2024-01-01',
        projection: 'actual',
        date_precision: 'exact',
      },
    });
  });

  it('cleared + existing marker -> delete', () => {
    const plan = planTrialDateMarker({
      ...base,
      existing: { id: 'm1' },
      locked: false,
      oldDate: '2024-01-01',
      newDate: null,
    });
    expect(plan).toEqual({ action: 'delete', markerId: 'm1' });
  });

  it('cleared + no marker -> none', () => {
    expect(
      planTrialDateMarker({
        ...base,
        existing: null,
        locked: false,
        oldDate: null,
        newDate: '',
      }).action,
    ).toBe('none');
  });

  it('carries the Trial End identity when planning the end field', () => {
    const plan = planTrialDateMarker({
      markerTypeId: TRIAL_END_MARKER_TYPE_ID,
      title: TRIAL_END_TITLE,
      today: '2026-06-26',
      existing: null,
      locked: false,
      oldDate: null,
      newDate: '2027-01-01',
    });
    expect(plan.create?.marker_type_id).toBe(TRIAL_END_MARKER_TYPE_ID);
    expect(plan.create?.title).toBe(TRIAL_END_TITLE);
    expect(plan.create?.projection).toBe('company');
  });
});
