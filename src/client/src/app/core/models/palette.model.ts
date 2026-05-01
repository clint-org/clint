export type PaletteKind = 'company' | 'product' | 'trial' | 'catalyst' | 'event';

export type PaletteCommandKind = 'command';

export type PaletteScope = 'space' | 'all-spaces';

export type PrefixTokenChar = '>' | '@' | '#' | '!';

export interface ParsedQuery {
  token: PrefixTokenChar | null;
  term: string;
}

export interface PaletteEntityItem {
  kind: PaletteKind;
  id: string;
  name: string;
  secondary: string | null;
  score: number;
  pinned: boolean;
  recentAt: string | null;
}

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  hotkey?: string;
  when?: () => boolean;
  run: () => void | Promise<void>;
}

export interface PaletteCommandRow {
  kind: PaletteCommandKind;
  command: PaletteCommand;
}

export type PaletteItem = PaletteEntityItem | PaletteCommandRow;

export interface EmptyState {
  pinned: PaletteEntityItem[];
  recents: PaletteEntityItem[];
  commands: PaletteCommand[];
}
