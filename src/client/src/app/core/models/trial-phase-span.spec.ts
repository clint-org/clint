import { describe, expect, it } from 'vitest';

import { precisionMidpointISO } from './marker-date-precision';
import type { DatePrecision } from './marker-date-precision';
import {
  deriveTrialPhaseSpan,
  PCD_MARKER_TYPE_ID,
  PhaseSpanMarker,
  TRIAL_END_MARKER_TYPE_ID,
  TRIAL_START_MARKER_TYPE_ID,
} from './trial-phase-span';

function makeMarker(
  marker_type_id: string,
  event_date: string | null,
  date_precision: DatePrecision
): PhaseSpanMarker {
  return { marker_type_id, event_date, date_precision };
}

describe('deriveTrialPhaseSpan', () => {
  describe('0 markers', () => {
    it('returns all null for an empty array', () => {
      expect(deriveTrialPhaseSpan([])).toEqual({
        start: null,
        startPrecision: null,
        end: null,
        endPrecision: null,
      });
    });

    it('returns all null when no markers match any system type', () => {
      const markers = [makeMarker('00000000-0000-0000-0000-000000000099', '2025-01-15', 'exact')];
      expect(deriveTrialPhaseSpan(markers)).toEqual({
        start: null,
        startPrecision: null,
        end: null,
        endPrecision: null,
      });
    });
  });

  describe('single Trial Start + single Trial End', () => {
    it('propagates start and end dates with their precisions', () => {
      const markers = [
        makeMarker(TRIAL_START_MARKER_TYPE_ID, '2024-03-01', 'exact'),
        makeMarker(TRIAL_END_MARKER_TYPE_ID, '2027-06-30', 'exact'),
      ];
      expect(deriveTrialPhaseSpan(markers)).toEqual({
        start: '2024-03-01',
        startPrecision: 'exact',
        end: '2027-06-30',
        endPrecision: 'exact',
      });
    });
  });

  describe('N Trial Start markers -> earliest wins', () => {
    it('selects the earliest event_date as start', () => {
      const markers = [
        makeMarker(TRIAL_START_MARKER_TYPE_ID, '2024-09-15', 'exact'),
        makeMarker(TRIAL_START_MARKER_TYPE_ID, '2024-01-15', 'exact'),
        makeMarker(TRIAL_START_MARKER_TYPE_ID, '2024-06-15', 'exact'),
      ];
      const result = deriveTrialPhaseSpan(markers);
      expect(result.start).toBe('2024-01-15');
      expect(result.startPrecision).toBe('exact');
    });

    it('captures the precision of whichever marker has the earliest date', () => {
      const earliestDate = precisionMidpointISO('month', 2023, 11);
      const markers = [
        makeMarker(TRIAL_START_MARKER_TYPE_ID, '2024-06-15', 'exact'),
        makeMarker(TRIAL_START_MARKER_TYPE_ID, earliestDate, 'month'),
      ];
      const result = deriveTrialPhaseSpan(markers);
      expect(result.start).toBe(earliestDate);
      expect(result.startPrecision).toBe('month');
    });
  });

  describe('N Trial End markers -> latest wins', () => {
    it('selects the latest event_date as end', () => {
      const markers = [
        makeMarker(TRIAL_END_MARKER_TYPE_ID, '2025-12-15', 'exact'),
        makeMarker(TRIAL_END_MARKER_TYPE_ID, '2027-06-15', 'exact'),
        makeMarker(TRIAL_END_MARKER_TYPE_ID, '2026-03-01', 'exact'),
      ];
      const result = deriveTrialPhaseSpan(markers);
      expect(result.end).toBe('2027-06-15');
      expect(result.endPrecision).toBe('exact');
    });
  });

  describe('PCD fallback', () => {
    it('uses PCD as end when no Trial End markers are present', () => {
      const markers = [makeMarker(PCD_MARKER_TYPE_ID, '2026-09-15', 'exact')];
      expect(deriveTrialPhaseSpan(markers)).toEqual({
        start: null,
        startPrecision: null,
        end: '2026-09-15',
        endPrecision: 'exact',
      });
    });

    it('uses the latest PCD when multiple PCD markers are present', () => {
      const markers = [
        makeMarker(PCD_MARKER_TYPE_ID, '2026-03-15', 'exact'),
        makeMarker(PCD_MARKER_TYPE_ID, '2027-01-15', 'exact'),
      ];
      expect(deriveTrialPhaseSpan(markers).end).toBe('2027-01-15');
    });

    it('ignores PCD when Trial End markers are present', () => {
      const markers = [
        makeMarker(TRIAL_END_MARKER_TYPE_ID, '2027-03-15', 'exact'),
        makeMarker(PCD_MARKER_TYPE_ID, '2028-01-15', 'exact'),
      ];
      const result = deriveTrialPhaseSpan(markers);
      expect(result.end).toBe('2027-03-15');
      expect(result.endPrecision).toBe('exact');
    });
  });

  describe('precision propagation', () => {
    it('passes through month precision verbatim using the TS midpoint source of truth', () => {
      const startDate = precisionMidpointISO('month', 2026, 11);
      const endDate = precisionMidpointISO('month', 2029, 3);
      const markers = [
        makeMarker(TRIAL_START_MARKER_TYPE_ID, startDate, 'month'),
        makeMarker(TRIAL_END_MARKER_TYPE_ID, endDate, 'month'),
      ];
      expect(deriveTrialPhaseSpan(markers)).toEqual({
        start: startDate,
        startPrecision: 'month',
        end: endDate,
        endPrecision: 'month',
      });
    });

    it('passes through year precision verbatim using the TS midpoint source of truth', () => {
      const startDate = precisionMidpointISO('year', 2025, 1);
      const endDate = precisionMidpointISO('year', 2028, 1);
      const markers = [
        makeMarker(TRIAL_START_MARKER_TYPE_ID, startDate, 'year'),
        makeMarker(TRIAL_END_MARKER_TYPE_ID, endDate, 'year'),
      ];
      expect(deriveTrialPhaseSpan(markers)).toEqual({
        start: startDate,
        startPrecision: 'year',
        end: endDate,
        endPrecision: 'year',
      });
    });
  });

  describe('robustness', () => {
    it('skips markers with null event_date', () => {
      const markers = [
        makeMarker(TRIAL_START_MARKER_TYPE_ID, null, 'exact'),
        makeMarker(TRIAL_START_MARKER_TYPE_ID, '2025-06-15', 'exact'),
      ];
      expect(deriveTrialPhaseSpan(markers).start).toBe('2025-06-15');
    });

    it('returns all null when only null-event_date markers are present', () => {
      const markers = [makeMarker(TRIAL_START_MARKER_TYPE_ID, null, 'exact')];
      expect(deriveTrialPhaseSpan(markers)).toEqual({
        start: null,
        startPrecision: null,
        end: null,
        endPrecision: null,
      });
    });

    it('ignores unrelated marker types and derives from system types only', () => {
      const UNRELATED = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const markers = [
        makeMarker(UNRELATED, '2020-01-01', 'exact'),
        makeMarker(TRIAL_START_MARKER_TYPE_ID, '2025-06-15', 'exact'),
        makeMarker(UNRELATED, '2030-12-31', 'exact'),
      ];
      const result = deriveTrialPhaseSpan(markers);
      expect(result.start).toBe('2025-06-15');
      expect(result.end).toBeNull();
    });

    it('can derive only end (start absent)', () => {
      const markers = [makeMarker(TRIAL_END_MARKER_TYPE_ID, '2027-06-30', 'exact')];
      expect(deriveTrialPhaseSpan(markers)).toEqual({
        start: null,
        startPrecision: null,
        end: '2027-06-30',
        endPrecision: 'exact',
      });
    });
  });
});
