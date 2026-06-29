import { describe, it, expect } from 'vitest';
import {
  buildCreateEventArgs,
  buildUpdateEventArgs,
  resolvePeriodMidpoint,
  sourceDisplay,
  isEventFormValid,
  significanceValue,
  visibilityValue,
  type EventFormState,
} from './event-payload';

function base(): EventFormState {
  return {
    eventTypeId: 'et-readout',
    anchorType: 'trial',
    anchorId: 'tr-1',
    title: 'Topline readout',
    eventDate: '2026-09-15',
    datePrecision: 'exact',
    extent: 'point',
    endDate: null,
    endDatePrecision: 'exact',
    projection: 'forecasted',
    significance: 'Default',
    visibility: 'Default',
    noLongerExpected: false,
    description: '',
    sources: [],
    tags: [],
    regulatoryPathway: null,
  };
}

describe('buildCreateEventArgs', () => {
  it('maps anchor + type + forecasted projection to the create_event params', () => {
    expect(buildCreateEventArgs(base())).toMatchObject({
      p_event_type_id: 'et-readout',
      p_anchor_type: 'trial',
      p_anchor_id: 'tr-1',
      p_projection: 'forecasted',
      p_significance: null,
      p_visibility: null,
      p_is_ongoing: false,
      p_end_date: null,
    });
  });

  it('space anchor drops anchor_id to null', () => {
    expect(buildCreateEventArgs({ ...base(), anchorType: 'space', anchorId: 'ignored' }).p_anchor_id).toBeNull();
  });

  it('High/Low significance + Pinned/Hidden visibility map through', () => {
    const a = buildCreateEventArgs({ ...base(), significance: 'High', visibility: 'Hidden' });
    expect(a.p_significance).toBe('high');
    expect(a.p_visibility).toBe('hidden');
  });

  it('extent=until carries end fields; onwards sets is_ongoing; point clears both', () => {
    expect(buildCreateEventArgs({ ...base(), extent: 'onwards' })).toMatchObject({ p_is_ongoing: true, p_end_date: null });
    expect(
      buildCreateEventArgs({ ...base(), extent: 'until', endDate: '2027-01-01', endDatePrecision: 'month' }),
    ).toMatchObject({ p_end_date: '2027-01-01', p_end_date_precision: 'month', p_is_ongoing: false });
  });

  it('builds p_metadata from tags + pathway, null when both empty', () => {
    expect(buildCreateEventArgs(base()).p_metadata).toBeNull();
    expect(
      buildCreateEventArgs({ ...base(), tags: ['obesity', ' GLP-1 ', ''], regulatoryPathway: 'BLA' }).p_metadata,
    ).toEqual({ tags: ['obesity', 'GLP-1'], pathway: 'BLA' });
    expect(buildCreateEventArgs({ ...base(), tags: ['x'] }).p_metadata).toEqual({ tags: ['x'] });
  });

  it('builds the p_sources jsonb array (url required, blank label -> null), null when empty', () => {
    expect(buildCreateEventArgs(base()).p_sources).toBeNull();
    const a = buildCreateEventArgs({
      ...base(),
      sources: [
        { url: ' https://fda.gov/x ', label: ' FDA ' },
        { url: '', label: 'dropped' },
        { url: 'https://ct.gov/y', label: '' },
      ],
    });
    expect(a.p_sources).toEqual([
      { url: 'https://fda.gov/x', label: 'FDA' },
      { url: 'https://ct.gov/y', label: null },
    ]);
  });
});

describe('buildUpdateEventArgs', () => {
  it('carries mutable fields + no_longer_expected + type/anchor (re-anchor on edit)', () => {
    const a = buildUpdateEventArgs({
      ...base(),
      noLongerExpected: true,
      significance: 'Low',
      anchorType: 'company',
      anchorId: 'co-1',
      eventTypeId: 'et-approval',
    });
    expect(a).toMatchObject({
      p_title: 'Topline readout',
      p_no_longer_expected: true,
      p_significance: 'low',
      p_event_type_id: 'et-approval',
      p_anchor_type: 'company',
      p_anchor_id: 'co-1',
    });
  });
  it('space anchor on edit nulls anchor_id', () => {
    expect(buildUpdateEventArgs({ ...base(), anchorType: 'space', anchorId: 'x' }).p_anchor_id).toBeNull();
  });
});

describe('resolvePeriodMidpoint', () => {
  it('exact returns the picked date; fuzzy returns midpoints', () => {
    expect(resolvePeriodMidpoint('exact', 2026, 0, '2026-09-15')).toBe('2026-09-15');
    expect(resolvePeriodMidpoint('year', 2026, 0, '')).toBe('2026-07-02');
    expect(resolvePeriodMidpoint('half', 2026, 1, '')).toBe('2026-10-01');
    expect(resolvePeriodMidpoint('quarter', 2026, 2, '')).toBe('2026-08-15');
    expect(resolvePeriodMidpoint('month', 2026, 0, '')).toBe('2026-01-15');
  });
});

describe('sourceDisplay', () => {
  it('label, else URL host, else raw', () => {
    expect(sourceDisplay({ url: 'https://x.com/a', label: 'Reuters' })).toBe('Reuters');
    expect(sourceDisplay({ url: 'https://clinicaltrials.gov/study/NCT01', label: null })).toBe('clinicaltrials.gov');
    expect(sourceDisplay({ url: 'not a url', label: '  ' })).toBe('not a url');
  });
});

describe('isEventFormValid', () => {
  it('requires type, title, and an entity for non-space anchors', () => {
    expect(isEventFormValid(base())).toBe(true);
    expect(isEventFormValid({ ...base(), eventTypeId: null })).toBe(false);
    expect(isEventFormValid({ ...base(), title: ' ' })).toBe(false);
    expect(isEventFormValid({ ...base(), anchorType: 'company', anchorId: null })).toBe(false);
    expect(isEventFormValid({ ...base(), anchorType: 'space', anchorId: null })).toBe(true);
  });
  it('blocks end < start when extent=until', () => {
    expect(isEventFormValid({ ...base(), extent: 'until', endDate: '2026-01-01' })).toBe(false);
    expect(isEventFormValid({ ...base(), extent: 'until', endDate: '2027-01-01' })).toBe(true);
  });
});

describe('choice mappers', () => {
  it('map Default to null', () => {
    expect(significanceValue('Default')).toBeNull();
    expect(visibilityValue('Default')).toBeNull();
  });
});
