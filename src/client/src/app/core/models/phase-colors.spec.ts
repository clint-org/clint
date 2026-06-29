import { describe, expect, it } from 'vitest';

import { normalizePhaseKey, phaseOrder, phaseShortLabel } from './phase-colors';

describe('phaseShortLabel', () => {
  it('maps canonical keys to short labels', () => {
    expect(phaseShortLabel('P3')).toBe('PH 3');
    expect(phaseShortLabel('PRECLIN')).toBe('PRECLIN');
    expect(phaseShortLabel('OBS')).toBe('OBS');
  });

  it('normalizes raw label-form phases to the same short label as the timeline', () => {
    // get_event_detail returns trial_phase as "Phase 3"; the timeline feeds the
    // key "P3". Both must render "PH 3".
    expect(phaseShortLabel('Phase 3')).toBe('PH 3');
    expect(phaseShortLabel('Phase III')).toBe('PH 3');
    expect(phaseShortLabel('Early Phase 1')).toBe('PH 1');
    expect(phaseShortLabel('Observational')).toBe('OBS');
  });

  it('returns unknown values unchanged', () => {
    expect(phaseShortLabel('N/A')).toBe('N/A');
    expect(phaseShortLabel('')).toBe('');
  });
});

describe('normalizePhaseKey', () => {
  it('maps label-form, roman, and combo phases to canonical keys', () => {
    expect(normalizePhaseKey('Phase 3')).toBe('P3');
    expect(normalizePhaseKey('phase iv')).toBe('P4');
    expect(normalizePhaseKey('Phase 1/Phase 2')).toBe('P2');
    expect(normalizePhaseKey('P3')).toBe('P3');
  });

  it('returns input unchanged for unknown values and empty for nullish', () => {
    expect(normalizePhaseKey('N/A')).toBe('N/A');
    expect(normalizePhaseKey(null)).toBe('');
    expect(normalizePhaseKey(undefined)).toBe('');
  });
});

describe('phaseOrder', () => {
  it('ranks trial phases in clinical progression order', () => {
    expect(phaseOrder('PRECLIN')).toBeLessThan(phaseOrder('P1'));
    expect(phaseOrder('P1')).toBeLessThan(phaseOrder('P2'));
    expect(phaseOrder('P2')).toBeLessThan(phaseOrder('P3'));
    expect(phaseOrder('P3')).toBeLessThan(phaseOrder('P4'));
    expect(phaseOrder('P4')).toBeLessThan(phaseOrder('OBS'));
  });

  it('sorts unknown, null, and unset phases last', () => {
    expect(phaseOrder(null)).toBe(Number.MAX_SAFE_INTEGER);
    expect(phaseOrder(undefined)).toBe(Number.MAX_SAFE_INTEGER);
    expect(phaseOrder('')).toBe(Number.MAX_SAFE_INTEGER);
    expect(phaseOrder('NOT_A_PHASE')).toBe(Number.MAX_SAFE_INTEGER);
    expect(phaseOrder('P3')).toBeLessThan(phaseOrder('NOT_A_PHASE'));
  });
});
