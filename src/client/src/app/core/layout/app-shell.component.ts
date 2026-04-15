import {
  Component,
  computed,
  HostListener,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterOutlet, ActivatedRoute } from '@angular/router';
import { filter } from 'rxjs';
import { SupabaseService } from '../services/supabase.service';
import { SpaceService } from '../services/space.service';
import { TenantService } from '../services/tenant.service';
import { Space } from '../models/space.model';
import { Tenant } from '../models/tenant.model';
import { SidebarComponent } from './sidebar.component';
import { ContextualTopbarComponent, TopbarTab } from './contextual-topbar.component';
import { NotificationBellComponent } from './notification-bell.component';
import { TopbarStateService } from '../services/topbar-state.service';

type Section = 'landscape' | 'intelligence' | 'manage' | 'settings';
type PageType = 'landscape' | 'list' | 'detail' | 'blank';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    ContextualTopbarComponent,
    NotificationBellComponent,
  ],
  template: `
    <div class="shell">
      <!-- Sidebar (collapsed: 48px icons, expanded: 220px full nav) -->
      <app-sidebar
        [expanded]="sidebarHovering()"
        [pinned]="sidebarPinned()"
        [activeRoute]="activeSpaceRoute()"
        [hasSpace]="!!spaceId()"
        [userInitials]="initials()"
        [userEmail]="user()?.email ?? ''"
        (pinToggle)="togglePin()"
        (navItemClick)="onNavItemClick($event)"
        (logoClick)="onLogoClick()"
        (avatarClick)="toggleAccount()"
        (sectionClick)="onSectionClick($any($event))"
        (hoverChange)="onSidebarHoverChange($event)"
      />

      <!-- Main content area -->
      <div class="main-area">
        <!-- Contextual Topbar -->
        <app-contextual-topbar
          [pageType]="pageType()"
          [tenantName]="currentTenantName()"
          [tenants]="tenants()"
          [currentTenantId]="tenantId()"
          [spaceName]="currentSpaceName()"
          [spaces]="spaces()"
          [currentSpaceId]="spaceId()"
          [hasSpace]="!!spaceId()"
          [tabs]="landscapeTabs()"
          [listTitle]="topbarListTitle()"
          [recordCount]="topbarState.recordCount()"
          [backLabel]="topbarBackLabel()"
          [entityContext]="topbarState.entityContext()"
          [entityTitle]="topbarState.entityTitle()"
          [actionButtons]="topbarState.actions()"
          (tabClick)="onLandscapeTabClick($event)"
          (backClick)="onBackClick()"
          (tenantChange)="switchTenant($event)"
          (spaceChange)="switchSpace($event)"
        >
          <div topbar-actions class="flex items-center gap-3">
            @if (spaceId()) {
              <app-notification-bell [spaceId]="spaceId()" />
            }
          </div>
        </app-contextual-topbar>

        <!-- Page content -->
        <div class="content-area">
          <router-outlet />
        </div>
      </div>

      <!-- Account menu overlay -->
      @if (accountOpen()) {
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <div class="account-backdrop" (click)="accountOpen.set(false)"></div>
        <div class="account-menu" role="menu">
          <div class="account-menu__header">
            <p class="account-menu__label">Signed in as</p>
            <p class="account-menu__email">{{ user()?.email }}</p>
          </div>
          <button
            type="button"
            class="account-menu__item"
            (click)="onSignOut()"
            role="menuitem"
          >
            Sign out
          </button>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .shell {
        display: flex;
        height: 100%;
        position: relative;
      }

      .main-area {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        height: 100%;
      }

      .content-area {
        flex: 1;
        min-height: 0;
        overflow: auto;
        background: #f8fafc;
      }

      .account-backdrop {
        position: fixed;
        inset: 0;
        z-index: 55;
      }

      .account-menu {
        position: absolute;
        left: 8px;
        bottom: 48px;
        z-index: 60;
        pointer-events: auto;
        width: 220px;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 10px 24px -12px rgba(15, 23, 42, 0.3);
      }

      .account-menu__header {
        padding: 10px 14px;
        border-bottom: 1px solid #334155;
      }

      .account-menu__label {
        font-size: 9px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #475569;
        margin: 0;
      }

      .account-menu__email {
        font-size: 12px;
        color: #e2e8f0;
        margin: 4px 0 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .account-menu__item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 10px 14px;
        font-size: 12px;
        color: #94a3b8;
        background: transparent;
        border: none;
        cursor: pointer;
        transition: color 120ms ease, background-color 120ms ease;
      }

      .account-menu__item:hover {
        color: #e2e8f0;
        background: #293548;
      }
    `,
  ],
})
export class AppShellComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly spaceService = inject(SpaceService);
  private readonly tenantService = inject(TenantService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly topbarState = inject(TopbarStateService);
  readonly user = this.supabase.currentUser;
  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly spaces = signal<Space[]>([]);
  readonly tenants = signal<Tenant[]>([]);
  readonly accountOpen = signal(false);

  // Sidebar state
  readonly sidebarHovering = signal(false);
  readonly sidebarPinned = signal(false);
  private hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  // The space-relative route path (e.g., 'manage/companies', 'events', 'bullseye/by-therapy-area')
  readonly activeSpaceRoute = signal('');

  // Current URL segments after spaceId for determining page context
  private fullUrl = signal('');

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

  readonly currentTenantName = computed(() => {
    const id = this.tenantId();
    const tenant = this.tenants().find((t) => t.id === id);
    return tenant?.name ?? '';
  });

  readonly currentSpaceName = computed(() => {
    const id = this.spaceId();
    const space = this.spaces().find((s) => s.id === id);
    return space?.name ?? '';
  });

  // Determine which section is active from the route
  readonly activeSection = computed<Section>(() => {
    const route = this.activeSpaceRoute();
    if (route.startsWith('manage/')) return 'manage';
    if (route.startsWith('settings/')) return 'settings';
    if (route === 'events' || route === 'catalysts') return 'intelligence';
    return 'landscape';
  });

  // Determine page type for the topbar
  readonly pageType = computed<PageType>(() => {
    const route = this.activeSpaceRoute();
    if (!this.spaceId()) return 'blank';
    // Landscape views
    if (
      route === '' ||
      route.startsWith('bullseye') ||
      route === 'positioning'
    ) {
      return 'landscape';
    }
    // Trial detail
    if (route.match(/^manage\/trials\/[^/]+$/)) {
      return 'detail';
    }
    // List pages
    if (
      route.startsWith('manage/') ||
      route === 'events' ||
      route === 'catalysts' ||
      route.startsWith('settings/')
    ) {
      return 'list';
    }
    return 'blank';
  });

  // Landscape tabs
  readonly landscapeTabs = computed<TopbarTab[]>(() => {
    if (this.pageType() !== 'landscape') return [];
    const route = this.activeSpaceRoute();
    return [
      { label: 'Timeline', value: 'timeline', active: route === '' },
      { label: 'Bullseye', value: 'bullseye', active: route.startsWith('bullseye') },
      { label: 'Positioning', value: 'positioning', active: route === 'positioning' },
    ];
  });

  // Topbar metadata for list pages
  readonly topbarListTitle = computed(() => {
    const route = this.activeSpaceRoute();
    const titleMap: Record<string, string> = {
      'manage/companies': 'Companies',
      'manage/products': 'Products',
      'manage/trials': 'Trials',
      events: 'Events',
      catalysts: 'Catalysts',
      'settings/taxonomies': 'Taxonomies',
      'settings/marker-types': 'Marker Types',
      'settings/organization': 'Organization',
      'settings/spaces': 'Spaces',
    };
    return titleMap[route] ?? this.topbarState.title();
  });

  // Detail page metadata
  readonly topbarBackLabel = computed(() => {
    const route = this.activeSpaceRoute();
    if (route.match(/^manage\/trials\/[^/]+$/)) return 'Trials';
    return '';
  });

  async ngOnInit(): Promise<void> {
    // Restore pinned state
    const pinned = localStorage.getItem('clint-sidebar-pinned');
    if (pinned === 'true') {
      this.sidebarPinned.set(true);
    }

    // Listen to route changes
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((event) => {
      this.fullUrl.set((event as NavigationEnd).urlAfterRedirects);
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

  // --- Sidebar hover behavior ---

  onSidebarHoverChange(hovering: boolean): void {
    if (this.sidebarPinned()) return;
    if (this.hoverTimeout) {
      clearTimeout(this.hoverTimeout);
      this.hoverTimeout = null;
    }
    if (hovering) {
      this.sidebarHovering.set(true);
    } else {
      this.hoverTimeout = setTimeout(() => {
        if (!this.sidebarPinned()) {
          this.sidebarHovering.set(false);
        }
      }, 200);
    }
  }

  togglePin(): void {
    const newValue = !this.sidebarPinned();
    this.sidebarPinned.set(newValue);
    localStorage.setItem('clint-sidebar-pinned', String(newValue));
    if (newValue) {
      // When pinning, stop the hover state
      this.sidebarHovering.set(false);
    }
  }

  // --- Navigation ---

  onSectionClick(section: Section): void {
    const defaultRoutes: Record<Section, string> = {
      landscape: '',
      intelligence: 'events',
      manage: 'manage/companies',
      settings: 'settings/taxonomies',
    };
    this.navigateToSpaceRoute(defaultRoutes[section]);
  }

  onLogoClick(): void {
    if (this.spaceId()) {
      this.navigateToSpaceRoute('');
    } else if (this.tenantId()) {
      this.router.navigate(['/t', this.tenantId(), 'spaces']);
    }
  }

  onNavItemClick(route: string): void {
    // Organization and Spaces are tenant-level routes
    if (route === 'settings/organization') {
      this.router.navigate(['/t', this.tenantId(), 'settings']);
      return;
    }
    if (route === 'settings/spaces') {
      this.router.navigate(['/t', this.tenantId(), 'spaces']);
      return;
    }
    this.navigateToSpaceRoute(route);
  }

  onLandscapeTabClick(tab: string): void {
    switch (tab) {
      case 'timeline':
        this.navigateToSpaceRoute('');
        break;
      case 'bullseye':
        this.navigateToSpaceRoute('bullseye/by-therapy-area');
        break;
      case 'positioning':
        this.navigateToSpaceRoute('positioning');
        break;
    }
  }

  onBackClick(): void {
    const route = this.activeSpaceRoute();
    if (route.match(/^manage\/trials\/[^/]+$/)) {
      this.navigateToSpaceRoute('manage/trials');
    }
  }

  // --- Tenant / Space ---

  switchTenant(newTenantId: string): void {
    localStorage.setItem('lastTenantId', newTenantId);
    this.router.navigate(['/t', newTenantId, 'spaces']);
  }

  switchSpace(newSpaceId: string): void {
    localStorage.setItem('lastSpaceId', newSpaceId);
    this.router.navigate(['/t', this.tenantId(), 's', newSpaceId]);
  }

  // --- Account ---

  toggleAccount(event?: Event): void {
    event?.stopPropagation();
    this.accountOpen.update((v) => !v);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.accountOpen()) {
      this.accountOpen.set(false);
    }
  }

  onSignOut(): void {
    this.accountOpen.set(false);
    this.supabase.signOut();
  }

  // --- Helpers ---

  private navigateToSpaceRoute(route: string): void {
    const base = ['/t', this.tenantId(), 's', this.spaceId()];
    if (route) {
      this.router.navigate([...base, ...route.split('/')]);
    } else {
      this.router.navigate(base);
    }
  }

  private extractRouteParams(): void {
    let r = this.route.root;
    const params: Record<string, string> = {};
    const segments: string[] = [];

    while (r) {
      if (r.snapshot?.params) {
        Object.assign(params, r.snapshot.params);
      }
      if (r.snapshot?.url) {
        for (const seg of r.snapshot.url) {
          segments.push(seg.path);
        }
      }
      r = r.firstChild!;
    }

    if (params['tenantId'] && params['tenantId'] !== this.tenantId()) {
      this.tenantId.set(params['tenantId']);
      this.loadSpaces(params['tenantId']);
    }
    if (params['spaceId']) {
      this.spaceId.set(params['spaceId']);
    } else {
      this.spaceId.set('');
    }

    // Extract space-relative route
    if (params['spaceId']) {
      const spaceIdIndex = segments.indexOf(params['spaceId']);
      if (spaceIdIndex >= 0) {
        const afterSpace = segments.slice(spaceIdIndex + 1);
        // Filter out route params that are IDs
        this.activeSpaceRoute.set(afterSpace.join('/'));
      }
    } else {
      this.activeSpaceRoute.set('');
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
