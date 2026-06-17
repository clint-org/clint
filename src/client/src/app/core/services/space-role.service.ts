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
  private readonly _isAgencyMember = signal(false);

  /** In-flight fetch for the current space; lets guards await the result. */
  private pending: Promise<void> | null = null;
  /** Space id whose role fetch has completed (success or error). */
  private fetchedSpaceId: string | null = null;

  readonly spaceId = this._spaceId.asReadonly();
  readonly currentUserRole = this._role.asReadonly();

  readonly isOwner = computed(() => this._role() === 'owner');
  readonly canEdit = computed(() => {
    const r = this._role();
    return r === 'owner' || r === 'editor';
  });
  readonly canRead = computed(() => this._role() !== null);

  /**
   * Whether the current user is an agency member of the active space's tenant
   * (the `is_agency_member_of_space` gate). Primary intelligence is the
   * agency's deliverable: only agency members can author/publish it, so its
   * write affordances gate on this, NOT on `canEdit()` (a space editor can
   * edit trial data but cannot publish intelligence). (Persona fix P1.3b.)
   */
  readonly isAgencyMember = this._isAgencyMember.asReadonly();

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
      this.pending = this.fetchRole(id);
    } else {
      this._role.set(null);
      this._isAgencyMember.set(false);
      this.pending = null;
      this.fetchedSpaceId = null;
    }
  }

  /**
   * Resolve the role for a space, fetching if needed. Route guards run
   * before NavigationEnd, so reading `canEdit()` synchronously there races
   * the fetch and misreads members as role-less (bounced a space owner off
   * /import; UI review 2026-06-12, item 3). Guards await this instead.
   */
  async ensureRole(spaceId: string): Promise<SpaceRole> {
    if (this._spaceId() === spaceId) {
      if (this.pending) await this.pending;
      if (this.fetchedSpaceId === spaceId) return this._role();
    }
    this._spaceId.set(spaceId);
    this.pending = this.fetchRole(spaceId);
    await this.pending;
    return this._role();
  }

  private extractSpaceId(url: string): string | null {
    // Match /t/<tenant>/s/<space>/...; both ids are uuids but we only need
    // the second path segment after `/s/`.
    const match = url.match(/\/s\/([0-9a-f-]{36})(\/|$|\?)/i);
    return match ? match[1] : null;
  }

  private async fetchRole(spaceId: string): Promise<void> {
    try {
      const userId = this.supabase.currentUser()?.id;
      if (!userId) {
        this._role.set(null);
        this._isAgencyMember.set(false);
        return;
      }
      const [roleRes, agencyRes] = await Promise.all([
        this.supabase.client
          .from('space_members')
          .select('role')
          .eq('space_id', spaceId)
          .eq('user_id', userId)
          .maybeSingle(),
        this.supabase.client.rpc('is_agency_member_of_space', { p_space_id: spaceId }),
      ]);
      this._isAgencyMember.set(!agencyRes.error && agencyRes.data === true);
      if (roleRes.error || !roleRes.data) {
        this._role.set(null);
        return;
      }
      this._role.set(roleRes.data.role as SpaceRole);
    } finally {
      this.fetchedSpaceId = spaceId;
      this.pending = null;
    }
  }
}
