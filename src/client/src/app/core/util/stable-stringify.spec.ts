import { describe, it, expect } from 'vitest';
import { stableStringify } from './stable-stringify';

describe('stableStringify', () => {
  it('serializes primitives', () => {
    expect(stableStringify(1)).toBe('1');
    expect(stableStringify('a')).toBe('"a"');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(true)).toBe('true');
  });

  it('sorts object keys for determinism', () => {
    const a = stableStringify({ b: 2, a: 1 });
    const b = stableStringify({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":1,"b":2}');
  });

  it('recurses into nested objects', () => {
    const a = stableStringify({ x: { b: 2, a: 1 } });
    const b = stableStringify({ x: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });

  it('preserves array order', () => {
    expect(stableStringify([2, 1])).toBe('[2,1]');
    expect(stableStringify([1, 2])).toBe('[1,2]');
  });

  it('handles arrays of objects', () => {
    expect(stableStringify([{ b: 2, a: 1 }])).toBe('[{"a":1,"b":2}]');
  });

  it('serializes undefined as null inside structures', () => {
    expect(stableStringify({ a: undefined })).toBe('{"a":null}');
  });
});
