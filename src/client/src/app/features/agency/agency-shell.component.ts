import { Component, computed, HostListener, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ButtonModule } from 'primeng/button';

import { BrandContextService } from '../../core/services/brand-context.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { AgencyService } from '../../core/services/agency.service';
import { Agency } from '../../core/models/agency.model';

interface AgencyNavItem {
  label: string;
  icon: string;
  routerLink: string;
  match: (url: string) => boolean;
}

@Component({
  selector: 'app-agency-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, ButtonModule],
  template: `
    <div class="agency-shell">
      <!-- Topbar -->
      <header class="agency-topbar">
        <div class="flex items-center gap-3">
          @if (brand.logoUrl()) {
            <img
              [src]="brand.logoUrl()"
              [alt]="brand.appDisplayName() + ' logo'"
              class="h-7 w-7 rounded object-contain"
            />
          }
          <div class="flex flex-col">
            <span
              class="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400"
              >Agency portal</span
            >
            <span class="text-sm font-semibold text-slate-900">
              {{ currentAgency()?.name || brand.appDisplayName() }}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <span class="text-xs text-slate-500">{{ user()?.email }}</span>
          <button
            type="button"
            class="text-xs text-slate-500 hover:text-slate-900"
            (click)="onSignOut()"
          >
            Sign out
          </button>
        </div>
      </header>

      <div class="agency-body">
        <!-- Side nav -->
        <nav class="agency-sidenav" aria-label="Agency navigation">
          @for (item of navItems; track item.routerLink) {
            <a
              [routerLink]="item.routerLink"
              class="agency-nav-item"
              [class.is-active]="item.match(currentUrl())"
            >
              <i [class]="item.icon" aria-hidden="true"></i>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>

        <!-- Main content -->
        <main class="agency-content">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      .agency-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #f8fafc;
      }
      .agency-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 24px;
        border-bottom: 1px solid #e2e8f0;
        background: #ffffff;
        flex-shrink: 0;
      }
      .agency-body {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .agency-sidenav {
        width: 200px;
        border-right: 1px solid #e2e8f0;
        background: #ffffff;
        padding: 16px 8px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex-shrink: 0;
      }
      .agency-nav-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border-radius: 4px;
        font-size: 13px;
        color: #475569;
        text-decoration: none;
        transition: background-color 120ms ease, color 120ms ease;
      }
      .agency-nav-item:hover {
        background: #f1f5f9;
        color: #0f172a;
      }
      .agency-nav-item.is-active {
        background: var(--brand-50, #f0fdfa);
        color: var(--brand-700, #0f766e);
        font-weight: 600;
      }
      .agency-nav-item i {
        width: 14px;
        font-size: 12px;
        text-align: center;
        opacity: 0.85;
      }
      .agency-content {
        flex: 1;
        min-width: 0;
        overflow: auto;
      }
      @media (max-width: 767px) {
        .agency-topbar {
          padding: 10px 12px;
          gap: 8px;
        }
        .agency-topbar > div:last-child {
          gap: 8px;
        }
        .agency-topbar .text-xs {
          max-width: 11rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .agency-body {
          flex-direction: column;
        }
        .agency-sidenav {
          width: 100%;
          flex-direction: row;
          border-right: none;
          border-bottom: 1px solid #e2e8f0;
          padding: 8px 12px;
          gap: 4px;
          overflow-x: auto;
        }
        .agency-nav-item {
          flex-shrink: 0;
          white-space: nowrap;
        }
      }
    `,
  ],
})
export class AgencyShellComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  private readonly agencyService = inject(AgencyService);
  protected readonly brand = inject(BrandContextService);

  readonly user = this.supabase.currentUser;
  readonly currentAgency = signal<Agency | null>(null);
  private readonly _currentUrl = signal<string>(this.router.url);
  readonly currentUrl = computed(() => this._currentUrl());

  readonly navItems: AgencyNavItem[] = [
    {
      label: 'Tenants',
      icon: 'fa-solid fa-building',
      routerLink: '/admin/tenants',
      match: (url) => url.startsWith('/admin/tenants'),
    },
    {
      label: 'Members',
      icon: 'fa-solid fa-user-group',
      routerLink: '/admin/members',
      match: (url) => url.startsWith('/admin/members'),
    },
    {
      label: 'Branding',
      icon: 'fa-solid fa-palette',
      routerLink: '/admin/branding',
      match: (url) => url.startsWith('/admin/branding'),
    },
  ];

  async ngOnInit(): Promise<void> {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((event) => {
      this._currentUrl.set((event as NavigationEnd).urlAfterRedirects);
    });
    await this.loadAgency();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // Reserved for modal handling at children.
  }

  async onSignOut(): Promise<void> {
    await this.supabase.signOut();
    this.router.navigate(['/login']);
  }

  private async loadAgency(): Promise<void> {
    try {
      const agencies = await this.agencyService.listMyAgencies();
      // BrandContext.id may identify the current agency host. Pick the matching
      // one if present, otherwise fall back to the first.
      const brandId = this.brand.brand().id;
      const match = brandId ? agencies.find((a) => a.id === brandId) : null;
      this.currentAgency.set(match ?? agencies[0] ?? null);
    } catch (e) {
      console.error('agency-shell: failed to load agencies', e);
    }
  }
}
