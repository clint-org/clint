import { describe, expect, it } from 'vitest';
import { resolveMarkerVisual, GLYPH_RATIOS } from './marker-visual';
import type { Marker, MarkerType } from './marker.model';

function markerType(over: Partial<MarkerType> = {}): MarkerType {
  return {
    id: 't1',
    space_id: 's1',
    created_by: null,
    category_id: 'c1',
    name: 'Topline Data',
    shape: 'circle',
    fill_style: 'filled',
    color: '#16a34a',
    inner_mark: 'dot',
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
    title: 'PCD',
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
  };
}

describe('resolveMarkerVisual', () => {
  it('actual projection renders filled', () => {
    expect(resolveMarkerVisual(marker({ projection: 'actual' })).fillStyle).toBe('filled');
  });

  it('non-actual projection renders outline', () => {
    expect(resolveMarkerVisual(marker({ projection: 'forecasted' })).fillStyle).toBe('outline');
    expect(resolveMarkerVisual(marker({ projection: 'company' })).fillStyle).toBe('outline');
    expect(resolveMarkerVisual(marker({ projection: 'primary' })).fillStyle).toBe('outline');
  });

  it('badges only the deviating tiers; actual and trial/registry primary carry none', () => {
    expect(resolveMarkerVisual(marker({ projection: 'actual' })).projectionBadge).toBeNull();
    // primary with no anchor context, or on a trial, is the CT.gov registry default: no letter
    expect(resolveMarkerVisual(marker({ projection: 'primary' })).projectionBadge).toBeNull();
    expect(
      resolveMarkerVisual(marker({ projection: 'primary', anchor_type: 'trial' })).projectionBadge,
    ).toBeNull();
    expect(resolveMarkerVisual(marker({ projection: 'company' })).projectionBadge).toBe('c');
    expect(resolveMarkerVisual(marker({ projection: 'forecasted' })).projectionBadge).toBe('f');
  });

  it("badges primary as 'p' on asset/company anchors (non-registry primary source)", () => {
    expect(
      resolveMarkerVisual(marker({ projection: 'primary', anchor_type: 'asset' })).projectionBadge,
    ).toBe('p');
    expect(
      resolveMarkerVisual(marker({ projection: 'primary', anchor_type: 'company' })).projectionBadge,
    ).toBe('p');
    // the 'p' rule is specific to the primary tier; other tiers keep their own letters
    expect(
      resolveMarkerVisual(marker({ projection: 'company', anchor_type: 'asset' })).projectionBadge,
    ).toBe('c');
    expect(
      resolveMarkerVisual(marker({ projection: 'forecasted', anchor_type: 'asset' }))
        .projectionBadge,
    ).toBe('f');
    // a confirmed actual on an asset still carries no badge
    expect(
      resolveMarkerVisual(marker({ projection: 'actual', anchor_type: 'asset' })).projectionBadge,
    ).toBeNull();
  });

  it('dims opacity only at the forecasted tier (actual/company/primary all solid)', () => {
    const actual = resolveMarkerVisual(marker({ projection: 'actual' })).opacity;
    const company = resolveMarkerVisual(marker({ projection: 'company' })).opacity;
    const primary = resolveMarkerVisual(marker({ projection: 'primary' })).opacity;
    const forecasted = resolveMarkerVisual(marker({ projection: 'forecasted' })).opacity;
    expect(actual).toBe(1);
    expect(company).toBeLessThanOrEqual(actual);
    expect(primary).toBeLessThanOrEqual(company);
    expect(forecasted).toBeLessThan(primary);
  });

  it('dashes the outline only for the forecasted tier', () => {
    expect(resolveMarkerVisual(marker({ projection: 'forecasted' })).outlineDash).toBe(true);
    expect(resolveMarkerVisual(marker({ projection: 'actual' })).outlineDash).toBe(false);
    expect(resolveMarkerVisual(marker({ projection: 'company' })).outlineDash).toBe(false);
    expect(resolveMarkerVisual(marker({ projection: 'primary' })).outlineDash).toBe(false);
  });

  it('passes through shape, color, and inner mark from the marker type', () => {
    const v = resolveMarkerVisual(
      marker({ marker_types: markerType({ shape: 'diamond', color: '#ea580c', inner_mark: 'check' }) })
    );
    expect(v.shape).toBe('diamond');
    expect(v.color).toBe('#ea580c');
    expect(v.innerMark).toBe('check');
  });

  it('reflects no_longer_expected as isNle', () => {
    expect(resolveMarkerVisual(marker({ no_longer_expected: true })).isNle).toBe(true);
    expect(resolveMarkerVisual(marker({ no_longer_expected: false })).isNle).toBe(false);
  });

  it('returns safe defaults when marker_types is absent', () => {
    const v = resolveMarkerVisual(marker({ marker_types: undefined }));
    expect(v.shape).toBe('circle');
    expect(v.innerMark).toBe('none');
    expect(v.color).toBe('#64748b');
  });
});

describe('GLYPH_RATIOS', () => {
  it('exposes the inner-mark and shape fractions used by both renderers', () => {
    expect(GLYPH_RATIOS.innerDotR).toBeCloseTo(0.15, 5);
    expect(GLYPH_RATIOS.squareInset).toBeCloseTo(0.1, 5);
    expect(GLYPH_RATIOS.diamondHalfW).toBeCloseTo(0.42, 5);
    expect(GLYPH_RATIOS.checkPoints).toHaveLength(6);
  });

  it('covers a representative ratio for every shape family', () => {
    expect(GLYPH_RATIOS.diamondHalfH).toBeCloseTo(0.48, 5);
    expect(GLYPH_RATIOS.circleDashX1).toBeCloseTo(0.28, 5);
    expect(GLYPH_RATIOS.circleDashX2).toBeCloseTo(0.72, 5);
    expect(GLYPH_RATIOS.squareXMin).toBeCloseTo(0.3, 5);
    expect(GLYPH_RATIOS.squareXMax).toBeCloseTo(0.7, 5);
    expect(GLYPH_RATIOS.flagPoleX).toBeCloseTo(0.15, 5);
    expect(GLYPH_RATIOS.flagWidth).toBeCloseTo(0.8, 5);
    expect(GLYPH_RATIOS.flagHeight).toBeCloseTo(0.6, 5);
    expect(GLYPH_RATIOS.trianglePoints).toEqual([0.15, 0.1, 0.9, 0.5, 0.15, 0.9]);
  });
});
