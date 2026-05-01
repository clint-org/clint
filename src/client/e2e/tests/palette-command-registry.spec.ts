import { test, expect } from '@playwright/test';
import { filterCommands } from '../../src/app/core/util/filter-commands';
import type { PaletteCommand } from '../../src/app/core/models/palette.model';

const noop = () => undefined;

test.describe('filterCommands', () => {
  test('keeps commands without a when() predicate', () => {
    const cmds: PaletteCommand[] = [{ id: 'a', label: 'A', run: noop }];
    expect(filterCommands(cmds)).toHaveLength(1);
  });
  test('filters out commands whose when() returns false', () => {
    const cmds: PaletteCommand[] = [
      { id: 'a', label: 'A', run: noop },
      { id: 'b', label: 'B', when: () => false, run: noop },
    ];
    const out = filterCommands(cmds);
    expect(out.map((c) => c.id)).toEqual(['a']);
  });
  test('keeps commands whose when() returns true', () => {
    const cmds: PaletteCommand[] = [
      { id: 'a', label: 'A', when: () => true, run: noop },
    ];
    expect(filterCommands(cmds)).toHaveLength(1);
  });
  test('caps results to 8 entries', () => {
    const cmds: PaletteCommand[] = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`, label: `C${i}`, run: noop,
    }));
    expect(filterCommands(cmds)).toHaveLength(8);
  });
});
