import type { PaletteCommand } from '../models/palette.model';

/**
 * How many commands the palette shows in its empty (no-query) state. Search
 * matches the full command set; this cap only limits the resting list so it
 * does not crowd out pinned/recent entities on open.
 */
export const EMPTY_STATE_COMMAND_LIMIT = 8;

/**
 * Apply each command's `when` predicate. Does NOT cap the list — a command
 * that passes its predicate is always searchable. (Previously this also
 * sliced to a fixed limit, which silently dropped later commands like
 * "Import from source" and the export entries from search results.)
 */
export function filterCommands(cmds: PaletteCommand[]): PaletteCommand[] {
  return cmds.filter((c) => (c.when ? !!c.when() : true));
}

/** Cap a (already `when`-filtered) command list for the empty-state display. */
export function capForEmptyState(cmds: PaletteCommand[]): PaletteCommand[] {
  return cmds.slice(0, EMPTY_STATE_COMMAND_LIMIT);
}
