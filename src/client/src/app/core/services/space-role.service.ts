import { Injectable, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import { SupabaseService } from './supabase.service';

export type SpaceRole = 'owner' | 'editor' | 'viewer' | null;

/**
 * Resolves the current user's role on the current space (the `:spaceId`
 * segment of the active URL). The result drives UI gating across data
 * pages: write controls render only when `canEdit()` or `isOwner()` is
 * true. Server-side RLS remains the authoritative gate; this service
 * keeps the UI from offering actions the caller cannot execute.
 *
 * The role is fetched once per `:spaceId` change. A null role means the
 * user has no `space_members` row for the active space (platform admin
 * read-only access still resolves to null here, since admins cannot
 * write; the service is correct to gate write controls off for them).
 */
@Injectable({ providedIn: 'root' })
export class SpaceRoleService {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);

  private readonly _spaceId = signal<string | null>(null);
  private readonly _role = signal<SpaceRole>(null);

  readonly spaceId = this._spaceId.asReadonly();
  readonly currentUserRole = this._role.asReadonly();

  readonly isOwner = computed(() => this._role() === 'owner');
  readonly canEdit = computed(() => {
    const r = this._role();
    return r === 'owner' || r === 'editor';
  });
  readonly canRead = computed(() => this._role() !== null);

  constructor() {
    this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((e) => this.handleNavigation(e.urlAfterRedirects));
    this.handleNavigation(this.router.url);
  }

  private handleNavigation(url: string): void {
    const id = this.extractSpaceId(url);
    if (id === this._spaceId()) return;
    this._spaceId.set(id);
    if (id) {
      this.fetchRole(id);
    } else {
      this._role.set(null);
    }
  }

  private extractSpaceId(url: string): string | null {
    // Match /t/<tenant>/s/<space>/...; both ids are uuids but we only need
    // the second path segment after `/s/`.
    const match = url.match(/\/s\/([0-9a-f-]{36})(\/|$|\?)/i);
    return match ? match[1] : null;
  }

  private async fetchRole(spaceId: string): Promise<void> {
    const userId = this.supabase.currentUser()?.id;
    if (!userId) {
      this._role.set(null);
      return;
    }
    const { data, error } = await this.supabase.client
      .from('space_members')
      .select('role')
      .eq('space_id', spaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) {
      this._role.set(null);
      return;
    }
    this._role.set(data.role as SpaceRole);
  }
}
