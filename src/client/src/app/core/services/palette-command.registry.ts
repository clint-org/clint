import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { PaletteCommand } from '../models/palette.model';
import { SupabaseService } from './supabase.service';
import { filterCommands } from '../util/filter-commands';

export { filterCommands } from '../util/filter-commands';

@Injectable({ providedIn: 'root' })
export class PaletteCommandRegistry {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);

  list(currentTenantId: string, currentSpaceId: string): PaletteCommand[] {
    const cmds: PaletteCommand[] = [
      {
        id: 'go-home',
        label: 'Go to Home',
        hint: 'Navigation',
        run: () => void this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}`),
      },
      {
        id: 'go-timeline',
        label: 'Go to Timeline',
        hint: 'Navigation',
        run: () =>
          void this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/timeline`),
      },
      {
        id: 'go-bullseye',
        label: 'Go to Bullseye',
        hint: 'Navigation',
        run: () => void this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/bullseye/by-therapy-area`),
      },
      {
        id: 'go-positioning',
        label: 'Go to Positioning',
        hint: 'Navigation',
        run: () => void this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/positioning/by-moa`),
      },
      {
        id: 'go-catalysts',
        label: 'Go to Future Catalysts',
        hint: 'Navigation',
        run: () => void this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/catalysts`),
      },
      {
        id: 'go-events',
        label: 'Go to Events',
        hint: 'Navigation',
        run: () => void this.router.navigateByUrl(`/t/${currentTenantId}/s/${currentSpaceId}/events`),
      },
      {
        id: 'go-spaces',
        label: 'Switch space...',
        hint: 'Navigation',
        run: () => void this.router.navigateByUrl(`/t/${currentTenantId}/spaces`),
      },
      {
        id: 'go-tenant-settings',
        label: 'Tenant settings',
        hint: 'Navigation',
        run: () => void this.router.navigateByUrl(`/t/${currentTenantId}/settings`),
      },
      {
        id: 'sign-out',
        label: 'Sign out',
        hint: 'Account',
        run: async () => {
          await this.supabase.client.auth.signOut();
          this.router.navigateByUrl('/login');
        },
      },
    ];
    return filterCommands(cmds);
  }
}
