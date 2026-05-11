import { Injectable, inject } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs/operators';
import { SupabaseService } from './supabase.service';
import { PaletteKind } from '../models/palette.model';

interface ParsedRoute {
  kind: PaletteKind;
  spaceId: string;
  entityId: string;
}

const PATTERNS: { re: RegExp; kind: PaletteKind }[] = [
  { re: /\/t\/[^/]+\/s\/([^/]+)\/manage\/trials\/([0-9a-f-]{36})/, kind: 'trial' },
  { re: /\/t\/[^/]+\/s\/([^/]+)\/manage\/assets\/([0-9a-f-]{36})/, kind: 'product' },
  { re: /\/t\/[^/]+\/s\/([^/]+)\/manage\/companies\/([0-9a-f-]{36})/, kind: 'company' },
];

function parseEntityRoute(url: string): ParsedRoute | null {
  for (const p of PATTERNS) {
    const m = url.match(p.re);
    if (m) return { kind: p.kind, spaceId: m[1], entityId: m[2] };
  }
  return null;
}

@Injectable({ providedIn: 'root' })
export class PaletteRecentsService {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);

  init() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => {
        const parsed = parseEntityRoute(e.urlAfterRedirects);
        if (!parsed) return;
        void this.touch(parsed);
      });
  }

  async touch(p: ParsedRoute) {
    const { error } = await this.supabase.client.rpc('palette_touch_recent', {
      p_space_id: p.spaceId,
      p_kind: p.kind,
      p_entity_id: p.entityId,
    });
    if (error) console.error('palette_touch_recent', error);
  }
}
