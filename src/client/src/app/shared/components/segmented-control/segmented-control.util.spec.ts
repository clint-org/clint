import { describe, expect, it } from 'vitest';

import { nextSegmentIndex } from './segmented-control.util';

describe('nextSegmentIndex', () => {
  it('moves forward and wraps on ArrowDown/ArrowRight', () => {
    expect(nextSegmentIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextSegmentIndex('ArrowRight', 1, 3)).toBe(2);
    expect(nextSegmentIndex('ArrowDown', 2, 3)).toBe(0);
  });

  it('moves backward and wraps on ArrowUp/ArrowLeft', () => {
    expect(nextSegmentIndex('ArrowUp', 2, 3)).toBe(1);
    expect(nextSegmentIndex('ArrowLeft', 1, 3)).toBe(0);
    expect(nextSegmentIndex('ArrowUp', 0, 3)).toBe(2);
  });

  it('jumps to the ends on Home/End', () => {
    expect(nextSegmentIndex('Home', 2, 3)).toBe(0);
    expect(nextSegmentIndex('End', 0, 3)).toBe(2);
  });

  it('returns null for non-navigation keys', () => {
    expect(nextSegmentIndex('Enter', 1, 3)).toBeNull();
    expect(nextSegmentIndex('a', 1, 3)).toBeNull();
  });

  it('returns null when there are no options', () => {
    expect(nextSegmentIndex('ArrowDown', 0, 0)).toBeNull();
  });
});
