import { describe, expect, it } from 'vitest';
import { effectiveVisibility } from './marker-visibility';
import type { Marker, MarkerType } from './marker.model';

function markerType(over: Partial<MarkerType> = {}): MarkerType {
  return {
    id: 't1',
    space_id: 's1',
    created_by: null,
    category_id: 'c1',
    name: 'Commercial / Distribution',
    shape: 'hexagon',
    fill_style: 'filled',
    color: '#0891b2',
    inner_mark: 'none',
    is_system: true,
    display_order: 1,
    created_at: '2026-01-01',
    ...over,
  };
}

function marker(over: Partial<Marker> = {}): Marker {
  return {
    id: 'm1',
    space_id: 's1',
    created_by: 'u1',
    marker_type_id: 't1',
    title: 'Event',
    projection: 'actual',
    event_date: '2026-01-01',
    end_date: null,
    description: null,
    source_url: null,
    metadata: null,
    is_projected: false,
    no_longer_expected: false,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    updated_by: null,
    marker_types: markerType(),
    ...over,
  } as Marker;
}

describe('effectiveVisibility', () => {
  it('pinned forces on even when significance is low', () => {
    expect(effectiveVisibility(marker({ visibility: 'pinned', significance: 'low' }))).toBe(true);
  });

  it('hidden forces off even when significance is high', () => {
    expect(effectiveVisibility(marker({ visibility: 'hidden', significance: 'high' }))).toBe(false);
  });

  it('null visibility with own high significance renders', () => {
    expect(effectiveVisibility(marker({ visibility: null, significance: 'high' }))).toBe(true);
  });

  it('null visibility with own low significance is feed-only', () => {
    expect(effectiveVisibility(marker({ visibility: null, significance: 'low' }))).toBe(false);
  });

  it('falls back to the type default_significance high when own significance is null', () => {
    expect(
      effectiveVisibility(
        marker({
          visibility: null,
          significance: null,
          marker_types: markerType({ default_significance: 'high' }),
        })
      )
    ).toBe(true);
  });

  it('falls back to the type default_significance low when own significance is null', () => {
    expect(
      effectiveVisibility(
        marker({
          visibility: null,
          significance: null,
          marker_types: markerType({ default_significance: 'low' }),
        })
      )
    ).toBe(false);
  });
});
