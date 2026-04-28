import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { ButtonModule } from 'primeng/button';

import { BrandContextService } from '../../core/services/brand-context.service';
import { SupabaseService } from '../../core/services/supabase.service';

interface SuperAdminNavItem {
  label: string;
  icon: string;
  routerLink: string;
  match: (url: string) => boolean;
}

@Component({
  selector: 'app-super-admin-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, ButtonModule],
  template: `
    <div class="sa-shell">
      <!-- Topbar with super-admin badge -->
      <header class="sa-topbar">
        <div class="flex items-center gap-3">
          <div class="sa-brandmark" aria-hidden="true">
            <i class="fa-solid fa-shield-halved"></i>
          </div>
          <div class="flex flex-col">
            <span class="sa-eyebrow">Platform owner</span>
            <span class="text-sm font-semibold text-slate-900">
              {{ brand.appDisplayName() }} super-admin
            </span>
          </div>
          <span class="sa-badge" aria-label="Super-admin context">SUPER-ADMIN</span>
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

      <div class="sa-body">
        <nav class="sa-sidenav" aria-label="Super-admin navigation">
          @for (item of navItems; track item.routerLink) {
            <a
              [routerLink]="item.routerLink"
              class="sa-nav-item"
              [class.is-active]="item.match(currentUrl())"
            >
              <i [class]="item.icon" aria-hidden="true"></i>
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>

        <main class="sa-content">
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
      .sa-shell {
        display: flex;
        flex-direction: column;
        height: 100%;
        background: #f8fafc;
      }
      .sa-topbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 24px;
        /* Distinct slate-900 hairline for super-admin chrome. */
        border-bottom: 1px solid #0f172a;
        background: #ffffff;
        flex-shrink: 0;
      }
      .sa-brandmark {
        height: 28px;
        width: 28px;
        border-radius: 4px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: #0f172a;
        color: #f8fafc;
        font-size: 13px;
      }
      .sa-eyebrow {
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: #64748b;
      }
      .sa-badge {
        margin-left: 8px;
        padding: 2px 6px;
        border-radius: 2px;
        background: #0f172a;
        color: #f8fafc;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.12em;
        font-variant-numeric: tabular-nums;
      }
      .sa-body {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .sa-sidenav {
        width: 200px;
        border-right: 1px solid #e2e8f0;
        background: #ffffff;
        padding: 16px 8px;
        display: flex;
        flex-direction: column;
        gap: 2px;
        flex-shrink: 0;
      }
      .sa-nav-item {
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
      .sa-nav-item:hover {
        background: #f1f5f9;
        color: #0f172a;
      }
      .sa-nav-item.is-active {
        background: #0f172a;
        color: #f8fafc;
        font-weight: 600;
      }
      .sa-nav-item i {
        width: 14px;
        font-size: 12px;
        text-align: center;
        opacity: 0.85;
      }
      .sa-content {
        flex: 1;
        min-width: 0;
        overflow: auto;
      }
      @media (max-width: 767px) {
        .sa-topbar {
          padding: 10px 12px;
          gap: 8px;
        }
        .sa-topbar .text-xs {
          max-width: 11rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .sa-body {
          flex-direction: column;
        }
        .sa-sidenav {
          width: 100%;
          flex-direction: row;
          border-right: none;
          border-bottom: 1px solid #e2e8f0;
          padding: 8px 12px;
          gap: 4px;
          overflow-x: auto;
        }
        .sa-nav-item {
          flex-shrink: 0;
          white-space: nowrap;
        }
      }
    `,
  ],
})
export class SuperAdminShellComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  protected readonly brand = inject(BrandContextService);

  readonly user = this.supabase.currentUser;
  private readonly _currentUrl = signal<string>(this.router.url);
  readonly currentUrl = computed(() => this._currentUrl());

  readonly navItems: SuperAdminNavItem[] = [
    {
      label: 'Agencies',
      icon: 'fa-solid fa-building-columns',
      routerLink: '/super-admin/agencies',
      match: (url) => url.startsWith('/super-admin/agencies'),
    },
    {
      label: 'Tenants',
      icon: 'fa-solid fa-building',
      routerLink: '/super-admin/tenants',
      match: (url) => url.startsWith('/super-admin/tenants'),
    },
    {
      label: 'Domains',
      icon: 'fa-solid fa-globe',
      routerLink: '/super-admin/domains',
      match: (url) => url.startsWith('/super-admin/domains'),
    },
  ];

  ngOnInit(): void {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((event) => {
      this._currentUrl.set((event as NavigationEnd).urlAfterRedirects);
    });
  }

  async onSignOut(): Promise<void> {
    await this.supabase.signOut();
    this.router.navigate(['/login']);
  }
}
