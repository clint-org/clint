import type { PaletteCommand } from '../models/palette.model';

const MAX_COMMANDS = 8;

export function filterCommands(cmds: PaletteCommand[]): PaletteCommand[] {
  return cmds.filter((c) => (c.when ? !!c.when() : true)).slice(0, MAX_COMMANDS);
}
