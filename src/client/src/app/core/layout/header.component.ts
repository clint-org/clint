import {
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import {
  NavigationEnd,
  Router,
  RouterLink,
  RouterLinkActive,
  ActivatedRoute,
} from '@angular/router';
import { filter } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';
import { ButtonModule } from 'primeng/button';
import { SupabaseService } from '../services/supabase.service';
import { SpaceService } from '../services/space.service';
import { TenantService } from '../services/tenant.service';
import { Space } from '../models/space.model';
import { Tenant } from '../models/tenant.model';
import { NotificationBellComponent } from './notification-bell.component';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, FormsModule, Select, ButtonModule, NotificationBellComponent],
  template: `
    <header class="border-b border-slate-200 bg-white">
      <div class="h-0.5 bg-brand-500"></div>
      <div class="flex items-center justify-between px-6 py-2.5">
        <!-- Left: brand + org / space selectors -->
        <div class="flex items-center gap-3">
          <a
            [routerLink]="tenantId() ? ['/t', tenantId(), 'spaces'] : ['/']"
            class="text-sm font-semibold tracking-tight text-slate-900"
          >
            Clint
          </a>

          @if (tenants().length > 1) {
            <span class="text-slate-200">/</span>
            <p-select
              [options]="tenants()"
              [ngModel]="tenantId()"
              (ngModelChange)="switchTenant($event)"
              optionLabel="name"
              optionValue="id"
              [style]="{ width: '10rem' }"
              size="small"
              placeholder="Organization"
            />
          } @else if (tenants().length === 1) {
            <span class="text-slate-200">/</span>
            <span class="text-xs font-medium uppercase tracking-wider text-slate-500">
              {{ tenants()[0].name }}
            </span>
          }

          @if (spaces().length > 0 && spaceId()) {
            <span class="text-slate-200">/</span>
            <p-select
              [options]="spaces()"
              [ngModel]="spaceId()"
              (ngModelChange)="switchSpace($event)"
              optionLabel="name"
              optionValue="id"
              [style]="{ width: '11rem' }"
              size="small"
            />
          }
        </div>

        <!-- Center: primary nav (space-scoped) -->
        @if (spaceId()) {
          <nav class="flex items-center gap-7">
            <a
              [routerLink]="spaceBase()"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Landscape
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'companies')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Companies
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'products')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Products
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'trials')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Trials
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'marker-types')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Markers
            </a>
            <a
              [routerLink]="spaceBase().concat('manage', 'therapeutic-areas')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Areas
            </a>
            <a
              [routerLink]="spaceBase().concat('events')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Events
            </a>
            <a
              [routerLink]="spaceBase().concat('catalysts')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Catalysts
            </a>
          </nav>
        }

        <!-- Right: settings + account menu -->
        <div class="flex items-center gap-3">
          @if (tenantId()) {
            <a
              [routerLink]="['/t', tenantId(), 'settings']"
              class="flex h-7 w-7 items-center justify-center text-slate-400 transition-colors hover:text-slate-900"
              aria-label="Organization settings"
            >
              <i class="fa-solid fa-gear text-xs"></i>
            </a>
          }
          @if (spaceId()) {
            <app-notification-bell [spaceId]="spaceId()" />
          }
          @if (user()) {
            <div class="relative">
              <button
                type="button"
                class="flex h-7 w-7 items-center justify-center border border-slate-200 bg-slate-50 text-[10px] font-semibold uppercase tracking-wider text-slate-600 transition-colors hover:border-brand-400 hover:text-slate-900"
                (click)="toggleAccount($event)"
                [attr.aria-label]="user()?.email ?? 'Account menu'"
                [attr.aria-expanded]="accountOpen()"
              >
                {{ initials() }}
              </button>
              @if (accountOpen()) {
                <div
                  class="absolute right-0 top-full z-50 mt-1 w-56 border border-slate-200 bg-white shadow-sm"
                  role="menu"
                >
                  <div class="border-b border-slate-100 px-3 py-2">
                    <p class="text-[9px] font-semibold uppercase tracking-wider text-slate-400">
                      Signed in as
                    </p>
                    <p class="mt-0.5 truncate text-xs text-slate-700">{{ user()?.email }}</p>
                  </div>
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:bg-slate-50"
                    (click)="onSignOut()"
                    role="menuitem"
                  >
                    <i class="fa-solid fa-right-from-bracket text-[11px] text-slate-400"></i>
                    Sign out
                  </button>
                </div>
              }
            </div>
          }
        </div>
      </div>
    </header>
  `,
  styles: [
    `
      .nav-link {
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgb(100 116 139); /* slate-500 */
        padding-bottom: 2px;
        border-bottom: 2px solid transparent;
        transition:
          color 120ms ease-out,
          border-color 120ms ease-out;
      }
      .nav-link:hover {
        color: rgb(15 23 42); /* slate-900 */
      }
      .nav-active {
        color: rgb(15 23 42); /* slate-900 */
        border-bottom-color: var(--brand-600);
      }
    `,
  ],
})
export class HeaderComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly spaceService = inject(SpaceService);
  private readonly tenantService = inject(TenantService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly user = this.supabase.currentUser;
  tenantId = signal('');
  spaceId = signal('');
  spaces = signal<Space[]>([]);
  tenants = signal<Tenant[]>([]);
  accountOpen = signal(false);

  readonly initials = computed(() => {
    const email = this.user()?.email ?? '';
    if (!email) return '--';
    const name = email.split('@')[0];
    const parts = name.split(/[._-]/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return (name[0] ?? '?').toUpperCase();
  });

  async ngOnInit(): Promise<void> {
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.extractRouteParams();
      this.accountOpen.set(false);
    });
    this.extractRouteParams();

    try {
      const tenants = await this.tenantService.listMyTenants();
      this.tenants.set(tenants);
    } catch {
      this.tenants.set([]);
    }
  }

  toggleAccount(event: MouseEvent): void {
    event.stopPropagation();
    this.accountOpen.update((v) => !v);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.accountOpen()) return;
    const target = event.target as Node;
    if (!this.host.nativeElement.contains(target)) {
      this.accountOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.accountOpen()) {
      this.accountOpen.set(false);
    }
  }

  spaceBase(): string[] {
    return ['/t', this.tenantId(), 's', this.spaceId()];
  }

  switchTenant(newTenantId: string): void {
    localStorage.setItem('lastTenantId', newTenantId);
    this.router.navigate(['/t', newTenantId, 'spaces']);
  }

  switchSpace(newSpaceId: string): void {
    localStorage.setItem('lastSpaceId', newSpaceId);
    this.router.navigate(['/t', this.tenantId(), 's', newSpaceId]);
  }

  async onSignOut(): Promise<void> {
    this.accountOpen.set(false);
    await this.supabase.signOut();
    this.router.navigate(['/login']);
  }

  private extractRouteParams(): void {
    let r = this.route.root;
    const params: Record<string, string> = {};
    while (r) {
      if (r.snapshot?.params) {
        Object.assign(params, r.snapshot.params);
      }
      r = r.firstChild!;
    }
    if (params['tenantId'] && params['tenantId'] !== this.tenantId()) {
      this.tenantId.set(params['tenantId']);
      this.loadSpaces(params['tenantId']);
    }
    if (params['spaceId']) {
      this.spaceId.set(params['spaceId']);
    }
  }

  private async loadSpaces(tenantId: string): Promise<void> {
    try {
      const spaces = await this.spaceService.listSpaces(tenantId);
      this.spaces.set(spaces);
    } catch {
      this.spaces.set([]);
    }
  }
}
