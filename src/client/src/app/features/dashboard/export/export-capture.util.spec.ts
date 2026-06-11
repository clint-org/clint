import { describe, expect, it } from 'vitest';

import { EXPORT_EXCLUDE_ATTR, includeInCapture } from './export-capture.util';

function fakeElement(attrs: string[]): Node {
  return {
    hasAttribute: (name: string) => attrs.includes(name),
  } as unknown as Node;
}

describe('includeInCapture', () => {
  it('excludes elements marked data-export-exclude', () => {
    expect(includeInCapture(fakeElement([EXPORT_EXCLUDE_ATTR]))).toBe(false);
  });

  it('includes ordinary elements', () => {
    expect(includeInCapture(fakeElement([]))).toBe(true);
  });

  it('includes non-element nodes such as text nodes', () => {
    expect(includeInCapture({} as Node)).toBe(true);
  });
});
