import { describe, it, expect } from 'vitest';
import { mapCtgovPhase, CTGOV_TO_APP_PHASE } from './nct-phase-map';

describe('mapCtgovPhase', () => {
  it('maps PHASE1 to P1', () => {
    expect(mapCtgovPhase(['PHASE1'])).toBe('P1');
  });

  it('maps PHASE2 to P2', () => {
    expect(mapCtgovPhase(['PHASE2'])).toBe('P2');
  });

  it('maps PHASE3 to P3', () => {
    expect(mapCtgovPhase(['PHASE3'])).toBe('P3');
  });

  it('maps PHASE4 to P4', () => {
    expect(mapCtgovPhase(['PHASE4'])).toBe('P4');
  });

  it('maps EARLY_PHASE1 to P1', () => {
    expect(mapCtgovPhase(['EARLY_PHASE1'])).toBe('P1');
  });

  it('maps NA to OBS', () => {
    expect(mapCtgovPhase(['NA'])).toBe('OBS');
  });

  it('maps combo [PHASE1, PHASE2] to P1_2', () => {
    expect(mapCtgovPhase(['PHASE1', 'PHASE2'])).toBe('P1_2');
  });

  it('maps combo [PHASE2, PHASE1] to P1_2 (order-independent)', () => {
    expect(mapCtgovPhase(['PHASE2', 'PHASE1'])).toBe('P1_2');
  });

  it('maps combo [PHASE2, PHASE3] to P2_3', () => {
    expect(mapCtgovPhase(['PHASE2', 'PHASE3'])).toBe('P2_3');
  });

  it('maps combo [PHASE3, PHASE2] to P2_3 (order-independent)', () => {
    expect(mapCtgovPhase(['PHASE3', 'PHASE2'])).toBe('P2_3');
  });

  it('returns null for empty array', () => {
    expect(mapCtgovPhase([])).toBeNull();
  });

  it('returns null for null', () => {
    expect(mapCtgovPhase(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(mapCtgovPhase(undefined)).toBeNull();
  });

  it('returns null for unknown phase strings', () => {
    expect(mapCtgovPhase(['UNKNOWN_PHASE'])).toBeNull();
  });

  it('falls back to first element for unrecognized combo phases', () => {
    expect(mapCtgovPhase(['PHASE1', 'PHASE3'])).toBe('P1');
  });
});

describe('CTGOV_TO_APP_PHASE', () => {
  it('contains all expected single-phase mappings', () => {
    expect(CTGOV_TO_APP_PHASE).toEqual({
      'EARLY_PHASE1': 'P1',
      'PHASE1': 'P1',
      'PHASE2': 'P2',
      'PHASE3': 'P3',
      'PHASE4': 'P4',
      'NA': 'OBS',
    });
  });
});
