import { describe, expect, it } from 'vitest';
import {
  EMPTY_STATE_COMMAND_LIMIT,
  capForEmptyState,
  filterCommands,
} from './filter-commands';
import type { PaletteCommand } from '../models/palette.model';

function cmd(id: string, when?: () => boolean): PaletteCommand {
  return { id, label: id, run: () => undefined, ...(when ? { when } : {}) };
}

describe('filterCommands', () => {
  it('keeps every command that passes its when predicate (no cap)', () => {
    const cmds = Array.from({ length: 12 }, (_, i) => cmd(`c${i}`));
    // Regression: the export entries and "Import from source" used to be
    // dropped by a hard slice; search must see the full set (P1.1).
    expect(filterCommands(cmds)).toHaveLength(12);
  });

  it('drops commands whose when predicate is false', () => {
    const cmds = [cmd('a'), cmd('b', () => false), cmd('c', () => true)];
    expect(filterCommands(cmds).map((c) => c.id)).toEqual(['a', 'c']);
  });
});

describe('capForEmptyState', () => {
  it(`caps the empty-state list to ${EMPTY_STATE_COMMAND_LIMIT}`, () => {
    const cmds = Array.from({ length: 12 }, (_, i) => cmd(`c${i}`));
    expect(capForEmptyState(cmds)).toHaveLength(EMPTY_STATE_COMMAND_LIMIT);
  });

  it('returns the list unchanged when under the limit', () => {
    const cmds = [cmd('a'), cmd('b')];
    expect(capForEmptyState(cmds)).toHaveLength(2);
  });
});
