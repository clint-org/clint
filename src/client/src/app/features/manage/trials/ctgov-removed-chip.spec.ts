// `ctgov-removed-chip.ts` imports Angular's `formatDate` from `@angular/common`,
// whose module-load static initializer expects the Angular compiler facade.
// Under the node-environment unit runner there is no AOT linker, so load the
// JIT compiler first (per Angular's own error guidance) before the helper.
import '@angular/compiler';
import { describe, expect, it } from 'vitest';
import { ctgovRemovedChip } from './ctgov-removed-chip';

describe('ctgovRemovedChip', () => {
  it('returns null for null', () => {
    expect(ctgovRemovedChip(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(ctgovRemovedChip(undefined)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(ctgovRemovedChip('')).toBeNull();
  });

  it('returns the chip text and a tooltip for a withdrawal timestamp', () => {
    const result = ctgovRemovedChip('2026-06-25T12:00:00Z');
    expect(result).not.toBeNull();
    expect(result!.text).toBe('Removed from CT.gov');
    expect(result!.tooltip).toContain('Jun 25, 2026');
    expect(result!.tooltip).toContain('registry');
  });
});
