import { Injectable, inject, signal } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { PaletteEntityItem, PaletteKind } from '../models/palette.model';

@Injectable({ providedIn: 'root' })
export class PalettePinService {
  private readonly supabase = inject(SupabaseService);
  readonly pinnedVersion = signal(0);

  async pin(spaceId: string, kind: PaletteKind, entityId: string, position = 0) {
    const { error } = await this.supabase.client.rpc('palette_set_pinned', {
      p_space_id: spaceId, p_kind: kind, p_entity_id: entityId, p_position: position,
    });
    if (error) { console.error('palette_set_pinned', error); return; }
    this.pinnedVersion.update((v) => v + 1);
  }

  async unpin(spaceId: string, kind: PaletteKind, entityId: string) {
    const { error } = await this.supabase.client.rpc('palette_unpin', {
      p_space_id: spaceId, p_kind: kind, p_entity_id: entityId,
    });
    if (error) { console.error('palette_unpin', error); return; }
    this.pinnedVersion.update((v) => v + 1);
  }

  async toggle(spaceId: string, item: PaletteEntityItem) {
    if (item.pinned) await this.unpin(spaceId, item.kind, item.id);
    else await this.pin(spaceId, item.kind, item.id);
  }
}
