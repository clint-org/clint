import { describe, expect, it } from 'vitest';

import { phaseOrder } from './phase-colors';

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
