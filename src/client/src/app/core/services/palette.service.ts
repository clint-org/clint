import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import {
  EmptyState,
  PaletteCommand,
  PaletteEntityItem,
  PaletteItem,
  PaletteKind,
  PaletteScope,
  ParsedQuery,
} from '../models/palette.model';
import { parsePrefixToken } from '../util/parse-prefix-token';
import { coalesceQuery } from '../util/coalesce-query';

export { coalesceQuery } from '../util/coalesce-query';

const MIN_QUERY = 2;
const DEBOUNCE_MS = 80;

function tokenToKind(t: ParsedQuery['token']): PaletteKind | null {
  switch (t) {
    case '@': return 'company';
    case '#': return 'trial';
    case '!': return 'catalyst';
    case '>': return null;
    default:  return null;
  }
}

@Injectable({ providedIn: 'root' })
export class PaletteService {
  private readonly supabase = inject(SupabaseService);

  readonly isOpen = signal(false);
  readonly query = signal('');
  readonly scope = signal<PaletteScope>('space');
  readonly selectedIndex = signal(0);
  readonly isLoading = signal(false);
  readonly results = signal<PaletteItem[]>([]);
  readonly emptyState = signal<EmptyState>({ pinned: [], recents: [], commands: [] });

  readonly parsedQuery = computed<ParsedQuery>(() => parsePrefixToken(this.query()));

  private currentSpaceId: string | null = null;
  private commandsProvider: (() => PaletteCommand[]) | null = null;
  private readonly fire = coalesceQuery(DEBOUNCE_MS, (q) => this.search(q));

  setCommandsProvider(p: () => PaletteCommand[]) { this.commandsProvider = p; }

  open(spaceId: string) {
    this.currentSpaceId = spaceId;
    this.query.set('');
    this.selectedIndex.set(0);
    this.results.set([]);
    this.isOpen.set(true);
    void this.loadEmptyState();
  }

  close() {
    this.isOpen.set(false);
  }

  setQuery(q: string) {
    this.query.set(q);
    this.selectedIndex.set(0);
    const parsed = parsePrefixToken(q);
    if (parsed.token === '>') {
      this.results.set(this.commandsAsRows(parsed.term));
      this.isLoading.set(false);
      return;
    }
    if (parsed.term.length < MIN_QUERY) {
      // Restore the empty-state flat list so arrow nav and Enter still work.
      this.results.set(this.emptyStateAsRows());
      this.isLoading.set(false);
      return;
    }
    this.isLoading.set(true);
    this.fire(q);
  }

  private emptyStateAsRows(): PaletteItem[] {
    const s = this.emptyState();
    return [
      ...s.pinned,
      ...s.recents,
      ...s.commands.map((c) => ({ kind: 'command' as const, command: c })),
    ];
  }

  moveSelection(delta: number) {
    const len = this.results().length;
    if (len === 0) return;
    const next = (this.selectedIndex() + delta + len) % len;
    this.selectedIndex.set(next);
  }

  selectIndex(i: number) {
    this.selectedIndex.set(Math.max(0, Math.min(i, this.results().length - 1)));
  }

  selectedItem(): PaletteItem | null {
    return this.results()[this.selectedIndex()] ?? null;
  }

  private async loadEmptyState() {
    if (!this.currentSpaceId) return;
    const { data, error } = await this.supabase.client.rpc('palette_empty_state', {
      p_space_id: this.currentSpaceId,
    });
    if (error) { console.error('palette_empty_state', error); return; }
    const payload = (data ?? { pinned: [], recents: [] }) as { pinned: PaletteEntityItem[]; recents: PaletteEntityItem[] };
    this.emptyState.set({
      pinned: payload.pinned ?? [],
      recents: payload.recents ?? [],
      commands: this.commandsProvider?.() ?? [],
    });
    // Mirror flat list into results so arrow nav and Enter work in the empty state.
    if (this.query().length === 0) {
      this.results.set(this.emptyStateAsRows());
    }
  }

  private async search(rawQuery: string) {
    if (!this.currentSpaceId) return;
    const parsed = parsePrefixToken(rawQuery);
    const kind = tokenToKind(parsed.token);
    const term = parsed.term;
    if (term.length < MIN_QUERY) {
      this.results.set([]);
      this.isLoading.set(false);
      return;
    }
    const { data, error } = await this.supabase.client.rpc('search_palette', {
      p_space_id: this.currentSpaceId,
      p_query: term,
      p_kind: kind,
      p_limit: 25,
    });
    this.isLoading.set(false);
    if (error) { console.error('search_palette', error); this.results.set([]); return; }
    const items: PaletteEntityItem[] = (data ?? []).map((r: Record<string, unknown>) => ({
      kind: r['kind'] as PaletteKind,
      id: r['id'] as string,
      name: r['name'] as string,
      secondary: r['secondary'] as string | null,
      score: r['score'] as number,
      pinned: !!(r['pinned']),
      recentAt: r['recent_at'] as string | null,
    }));
    this.results.set(items);
    this.selectedIndex.set(0);
  }

  private commandsAsRows(term: string): PaletteItem[] {
    const all = this.commandsProvider?.() ?? [];
    const t = term.toLowerCase();
    const filtered = t ? all.filter((c) => c.label.toLowerCase().includes(t)) : all;
    return filtered.map((c) => ({ kind: 'command' as const, command: c }));
  }
}
