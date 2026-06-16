import { describe, expect, it } from 'vitest';
import {
  MARKER_FIELD_LABELS,
  PROJECTION_LABEL,
  formatMarkerFieldValue,
} from './marker-fields';
import type { Projection } from '../../core/models/marker.model';

// Keep this list in sync with the Projection union in marker.model.ts.
const ALL_PROJECTIONS: Projection[] = ['stout', 'company', 'primary', 'actual'];

describe('PROJECTION_LABEL (P2.2 relabel)', () => {
  it('has a human label for every Projection enum value', () => {
    for (const p of ALL_PROJECTIONS) {
      expect(PROJECTION_LABEL[p], `missing label for "${p}"`).toBeTruthy();
    }
  });

  it('labels the field as a source, not as projected-vs-actual', () => {
    expect(MARKER_FIELD_LABELS['projection']).toBe('Projection source');
  });

  it('reads "actual" as a confirmed date and the others as projected sources', () => {
    expect(PROJECTION_LABEL['actual'].toLowerCase()).toContain('actual');
    for (const p of ['stout', 'company', 'primary'] as Projection[]) {
      expect(PROJECTION_LABEL[p]).toMatch(/projected/i);
    }
  });

  it('formats a projection value via the canonical label', () => {
    expect(formatMarkerFieldValue('projection', 'stout')).toBe('Projected · Stout estimate');
    expect(formatMarkerFieldValue('projection', 'actual')).toBe('Confirmed actual');
  });

  it('falls back to the raw value for an unknown projection', () => {
    expect(formatMarkerFieldValue('projection', 'mystery')).toBe('mystery');
  });
});
