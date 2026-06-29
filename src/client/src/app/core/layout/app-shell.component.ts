import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  HostListener,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { NavigationEnd, Router, RouterOutlet, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { filter } from 'rxjs';
import { SupabaseService } from '../services/supabase.service';
import { SpaceService } from '../services/space.service';
import { TenantService } from '../services/tenant.service';
import { Space } from '../models/space.model';
import { Tenant } from '../models/tenant.model';
import { environment } from '../../../environments/environment';
import { NgOptimizedImage } from '@angular/common';

import { APP_VERSION } from '../../../environments/version';
import { userDisplayName } from '../../shared/utils/user-display-name';
import { CommandPaletteComponent } from './command-palette/command-palette.component';
import { SidebarComponent } from './sidebar.component';
import { ContextualTopbarComponent, TopbarTab } from './contextual-topbar.component';
import { TopbarStateService } from '../services/topbar-state.service';
import { OnboardingTooltipService } from '../../features/engagement-landing/onboarding-tooltip.service';
import { SpaceRoleService } from '../services/space-role.service';
import { PrimaryIntelligenceService } from '../services/primary-intelligence.service';
import { NAV_ICONS } from '../../shared/constants/nav-icons';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { routeFadeAnimation } from '../../shared/animations/route-fade.animation';
import {
  backdropFadeAnimation,
  menuSlideUpAnimation,
} from '../../shared/animations/overlay.animation';

type Section = 'landscape' | 'intelligence' | 'profiles' | 'settings' | 'reference';
type PageType = 'landscape' | 'list' | 'detail' | 'blank';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [
    NgOptimizedImage,
    RouterOutlet,
    CommandPaletteComponent,
    SidebarComponent,
    ContextualTopbarComponent,
    ButtonModule,
    Dialog,
    FormsModule,
    InputText,
    Textarea,
    MessageModule,
    FormsModule,
  ],
  animations: [routeFadeAnimation, backdropFadeAnimation, menuSlideUpAnimation],
  template: `
    <div class="shell">
      <!-- Sidebar (collapsed: 48px icons, expanded: 220px full nav) -->
      <app-sidebar
        [expanded]="sidebarHovering()"
        [pinned]="sidebarPinned()"
        [activeRoute]="activeSpaceRoute()"
        [hasSpace]="!!spaceId()"
        [canEdit]="spaceRole.canEdit()"
        [isOwner]="spaceRole.isOwner()"
        [hasEngagement]="hasEngagement()"
        [userInitials]="initials()"
        [userEmail]="user()?.email ?? ''"
        [userAvatarUrl]="avatarUrl()"
        (pinToggle)="togglePin()"
        (navItemClick)="onNavItemClick($event)"
        (logoClick)="onLogoClick()"
        (avatarClick)="toggleAccount()"
        (sectionClick)="onSectionClick($event)"
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
          [sectionLabel]="sectionLabel()"
          [tabs]="sectionTabs()"
          [listTitle]="topbarListTitle()"
          [recordCount]="topbarState.recordCount()"
          [backLabel]="topbarBackLabel()"
          [entityContext]="topbarState.entityContext()"
          [entityTitle]="topbarState.entityTitle()"
          [actionButtons]="topbarState.actions()"
          [exportActions]="topbarState.exportActions()"
          [overflowActions]="topbarState.overflowActions()"
          [tenantLogoUrl]="currentTenantLogoUrl()"
          [timelineHintVisible]="onboardingTooltip.visible()"
          (tabClick)="onSectionTabClick($event)"
          (backClick)="onBackClick()"
          (tenantChange)="switchTenant($event)"
          (spaceChange)="switchSpace($event)"
          (tenantSettingsClick)="onTenantSettingsClick()"
          (spaceSettingsClick)="onSpaceSettingsClick()"
          (newSpaceClick)="onNewSpaceClick()"
          (joinTenantClick)="onJoinTenantClick()"
          (allSpacesClick)="onAllSpacesClick()"
          (timelineHintDismiss)="onboardingTooltip.dismiss()"
        />

        <!-- Page content -->
        <div class="content-area" [@routeFade]="activeSpaceRoute()">
          <router-outlet />
        </div>
      </div>

      <!-- Account menu overlay -->
      @if (accountOpen()) {
        <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
        <div class="account-backdrop" @backdropFade (click)="accountOpen.set(false)"></div>
        <div class="account-menu" @menuSlideUp role="menu">
          <div class="account-menu__header">
            @if (avatarUrl(); as url) {
              <img
                class="account-menu__avatar"
                [ngSrc]="url"
                [alt]="displayName()"
                width="32"
                height="32"
                referrerpolicy="no-referrer"
              />
            } @else {
              <span class="account-menu__avatar account-menu__avatar--initials">{{
                initials()
              }}</span>
            }
            <div class="account-menu__who">
              <p class="account-menu__name">{{ displayName() }}</p>
              <p class="account-menu__email">{{ user()?.email }}</p>
            </div>
          </div>
          <button type="button" class="account-menu__item" (click)="goToHelp()" role="menuitem">
            Help &amp; roles
          </button>
          <button type="button" class="account-menu__item" (click)="onSignOut()" role="menuitem">
            Sign out
          </button>
          <div class="account-menu__footer">
            <span>v{{ appVersion }}</span>
            <span>{{ currentTenantName() }}</span>
          </div>
        </div>
      }

      <!-- Create space dialog -->
      <p-dialog
        header="Create space"
        [(visible)]="createSpaceDialogOpen"
        [modal]="true"
        styleClass="!w-[32rem]"
        (onHide)="resetCreateSpaceForm()"
      >
        <form (ngSubmit)="createSpace()" class="space-y-4">
          <p class="text-xs text-slate-500">
            A space is a workspace for organizing and visualizing a set of clinical trials.
          </p>
          <div>
            <label for="new-space-name" class="mb-1 block text-sm font-medium text-slate-700"
              >Name</label
            >
            <input
              pInputText
              id="new-space-name"
              class="w-full"
              [ngModel]="newSpaceName()"
              (ngModelChange)="newSpaceName.set($event)"
              name="spaceName"
              placeholder="e.g. SGLT2 Pipeline"
              required
            />
          </div>
          <div>
            <label for="new-space-desc" class="mb-1 block text-sm font-medium text-slate-700"
              >Description</label
            >
            <textarea
              pTextarea
              id="new-space-desc"
              class="w-full"
              [ngModel]="newSpaceDesc()"
              (ngModelChange)="newSpaceDesc.set($event)"
              name="spaceDesc"
              rows="2"
              placeholder="Optional description"
            ></textarea>
          </div>
          @if (createSpaceError()) {
            <p-message severity="error" [closable]="false">{{ createSpaceError() }}</p-message>
          }
        </form>
        <ng-template #footer>
          <p-button
            label="Cancel"
            severity="secondary"
            [outlined]="true"
            (onClick)="createSpaceDialogOpen.set(false)"
          />
          <p-button label="Create space" (onClick)="createSpace()" [loading]="creatingSpace()" />
        </ng-template>
      </p-dialog>

      <app-command-palette [spaceName]="currentSpaceName()" />
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
        max-width: 100%;
        display: flex;
        flex-direction: column;
        height: 100%;
        overflow: hidden;
      }

      .content-area {
        flex: 1;
        min-width: 0;
        min-height: 0;
        overflow: auto;
        background: #f8fafc;
      }

      /* On mobile, ditch the bounded inner-scroller in favor of natural
         body scroll. iOS Safari handles momentum scrolling on body well;
         a bounded inner scroller inside an h-screen shell intercepts
         vertical swipes when the inner content is dramatically taller. */
      @media (max-width: 767px) {
        :host {
          height: auto;
          min-height: 100vh;
        }
        .shell {
          height: auto;
          min-height: 100vh;
        }
        .main-area {
          height: auto;
          overflow: visible;
        }
        .content-area {
          overflow: visible;
        }
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
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 14px;
        border-bottom: 1px solid #334155;
      }

      .account-menu__avatar {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        flex-shrink: 0;
        object-fit: cover;
      }

      .account-menu__avatar--initials {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #334155;
        color: #e2e8f0;
        font-size: 12px;
        font-weight: 600;
      }

      .account-menu__who {
        min-width: 0;
      }

      .account-menu__name {
        font-size: 13px;
        font-weight: 600;
        color: #f1f5f9;
        margin: 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .account-menu__email {
        font-size: 11px;
        color: #94a3b8;
        margin: 2px 0 0;
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
        transition:
          color 120ms ease,
          background-color 120ms ease;
      }

      .account-menu__item:hover {
        color: #e2e8f0;
        background: #293548;
      }

      .account-menu__footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 14px;
        border-top: 1px solid #334155;
        font-size: 10px;
        font-family: monospace;
        color: #475569;
        letter-spacing: 0.5px;
      }

      .account-menu__footer span:last-child {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-transform: uppercase;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppShellComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);
  private readonly spaceService = inject(SpaceService);
  private readonly tenantService = inject(TenantService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly topbarState = inject(TopbarStateService);
  readonly onboardingTooltip = inject(OnboardingTooltipService);
  protected readonly spaceRole = inject(SpaceRoleService);
  private readonly primaryIntelligence = inject(PrimaryIntelligenceService);
  protected readonly appVersion = APP_VERSION;
  readonly user = this.supabase.currentUser;
  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly spaces = signal<Space[]>([]);
  readonly tenants = signal<Tenant[]>([]);
  /**
   * Whether the current space has an engagement write-up (published or draft).
   * Gates the Engagement nav item in the sidebar. Refreshed on space change and
   * after any intelligence mutation (via `primaryIntelligence.changed`).
   */
  readonly hasEngagement = signal(false);
  private engagementProbeToken = 0;
  readonly accountOpen = signal(false);

  // Create space dialog state
  readonly createSpaceDialogOpen = signal(false);
  readonly creatingSpace = signal(false);
  readonly createSpaceError = signal<string | null>(null);
  readonly newSpaceName = signal('');
  readonly newSpaceDesc = signal('');

  // Sidebar state
  readonly sidebarHovering = signal(false);
  readonly sidebarPinned = signal(false);
  private hoverTimeout: ReturnType<typeof setTimeout> | null = null;

  // The space-relative route path (e.g., 'profiles/companies', 'events', 'bullseye/by-indication')
  readonly activeSpaceRoute = signal('');

  // Current URL segments after spaceId for determining page context
  private readonly fullUrl = signal('');

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

  readonly avatarUrl = computed(() => {
    const meta = this.user()?.user_metadata;
    return (meta?.['avatar_url'] as string) ?? (meta?.['picture'] as string) ?? null;
  });

  readonly displayName = computed(() => {
    const meta = this.user()?.user_metadata;
    return userDisplayName(
      meta?.['full_name'] as string,
      meta?.['name'] as string,
      this.user()?.email
    );
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

  readonly currentTenantLogoUrl = computed(() => {
    const id = this.tenantId();
    const tenant = this.tenants().find((t) => t.id === id);
    return tenant?.logo_url ?? null;
  });

  // Determine which section is active from the route
  readonly activeSection = computed<Section>(() => {
    const route = this.activeSpaceRoute();
    // Engagement lives under /profiles for routing but belongs to the
    // Intelligence group (matches the nav rail); without this it rendered
    // the Profiles tab set with no tab marked active.
    if (route === 'profiles/engagement') return 'intelligence';
    if (route.startsWith('profiles/')) return 'profiles';
    if (route.startsWith('settings/')) return 'settings';
    if (route.startsWith('help/')) return 'reference';
    if (route === 'activity' || route === 'intelligence' || route === 'materials')
      return 'intelligence';
    if (route === 'future-events') return 'landscape';
    return 'landscape';
  });

  // Determine page type for the topbar
  readonly pageType = computed<PageType>(() => {
    const route = this.activeSpaceRoute();
    if (!this.spaceId()) return 'blank';
    // Tab-based sections: landscape (incl. engagement-landing home), intelligence, profiles
    if (
      route === '' ||
      route === 'timeline' ||
      route.startsWith('bullseye') ||
      route.startsWith('heatmap') ||
      route === 'activity' ||
      route === 'intelligence' ||
      route === 'materials' ||
      route === 'future-events' ||
      route.startsWith('profiles/')
    ) {
      return 'landscape';
    }
    // Settings remains a list
    if (route.startsWith('settings/')) {
      return 'list';
    }
    return 'blank';
  });

  // Section label for the topbar
  readonly sectionLabel = computed(() => {
    const labels: Record<Section, string> = {
      landscape: 'Landscape',
      intelligence: 'Intelligence',
      profiles: 'Profiles',
      settings: 'Settings',
      reference: 'Reference',
    };
    return labels[this.activeSection()] ?? '';
  });

  // Section tabs for the topbar
  readonly sectionTabs = computed<TopbarTab[]>(() => {
    if (this.pageType() !== 'landscape') return [];
    const section = this.activeSection();
    const route = this.activeSpaceRoute();

    switch (section) {
      case 'landscape':
        return [
          {
            label: 'Home',
            value: 'home',
            active: route === '',
            icon: NAV_ICONS['home'],
          },
          {
            label: 'Timeline',
            value: 'timeline',
            active: route === 'timeline',
            icon: NAV_ICONS['timeline'],
          },
          {
            label: 'Bullseye',
            value: 'bullseye',
            active: route.startsWith('bullseye'),
            icon: NAV_ICONS['bullseye'],
          },
          {
            label: 'Heatmap',
            value: 'heatmap',
            active: route.startsWith('heatmap'),
            icon: NAV_ICONS['heatmap'],
          },
          {
            label: 'Future Events',
            value: 'future-events',
            active: route === 'future-events',
            icon: NAV_ICONS['catalysts'],
          },
        ];
      case 'intelligence':
        return [
          {
            label: 'Intelligence Feed',
            value: 'intelligence',
            active: route === 'intelligence',
            icon: NAV_ICONS['intelligence-feed'],
          },
          ...(this.hasEngagement()
            ? [
                {
                  label: 'Engagement',
                  value: 'profiles/engagement',
                  active: route === 'profiles/engagement',
                  icon: NAV_ICONS['engagement'],
                },
              ]
            : []),
          {
            label: 'Activity',
            value: 'activity',
            active: route === 'activity',
            icon: NAV_ICONS['events'],
          },
          {
            label: 'Materials',
            value: 'materials',
            active: route === 'materials',
            icon: NAV_ICONS['materials'],
          },
        ];
      case 'profiles':
        return [
          {
            label: 'Companies',
            value: 'companies',
            active: route === 'profiles/companies',
            icon: NAV_ICONS['companies'],
          },
          {
            label: 'Assets',
            value: 'assets',
            active: route === 'profiles/assets',
            icon: NAV_ICONS['assets'],
          },
          {
            label: 'Trials',
            value: 'trials',
            active: route === 'profiles/trials',
            icon: NAV_ICONS['trials'],
          },
        ];
      default:
        return [];
    }
  });

  // Topbar metadata for list pages
  readonly topbarListTitle = computed(() => {
    const route = this.activeSpaceRoute();
    const titleMap: Record<string, string> = {
      'profiles/companies': 'Companies',
      'profiles/assets': 'Assets',
      'profiles/trials': 'Trials',
      activity: 'Activity',
      'future-events': 'Future Events',
      'settings/taxonomies': 'Taxonomies',
      'settings/spaces': 'Spaces',
      'settings/general': 'General',
      'settings/members': 'Members',
      'settings/fields': 'Fields',
      'settings/audit-log': 'Audit log',
    };
    return titleMap[route] ?? this.topbarState.title();
  });

  // Detail page metadata (no detail-topbar routes currently defined)
  readonly topbarBackLabel = computed(() => '');

  constructor() {
    // Keep the space picker in sync. The list is reloaded both on tenant
    // switch (tenantId changes) and after any space mutation through
    // SpaceService (create / archive / restore / permanent delete), which
    // bumps spacesChanged. Without the latter, mutations within the current
    // tenant would leave the picker showing a stale snapshot.
    effect(() => {
      this.spaceService.spacesChanged();
      const tenantId = this.tenantId();
      if (tenantId) {
        this.loadSpaces(tenantId);
      }
    });

    // Keep the Engagement nav item in sync with whether the current space has a
    // write-up. Re-runs on space change and after any intelligence mutation, so
    // the item appears the moment an editor publishes a space write-up from the
    // Intelligence Feed and disappears again if it is withdrawn.
    effect(() => {
      const spaceId = this.spaceId();
      this.primaryIntelligence.changed();
      this.refreshEngagementPresence(spaceId);
    });
  }

  private async refreshEngagementPresence(spaceId: string): Promise<void> {
    const token = ++this.engagementProbeToken;
    if (!spaceId) {
      this.hasEngagement.set(false);
      return;
    }
    try {
      const bundle = await this.primaryIntelligence.getSpaceIntelligence(spaceId);
      // Ignore a stale probe if the space changed (or another probe started)
      // while this request was in flight.
      if (token !== this.engagementProbeToken) return;
      // Presence mirrors the engagement page's own `hasIntelligence` rule: any
      // brief (published or draft) means there is a write-up to show.
      this.hasEngagement.set((bundle?.briefs.length ?? 0) > 0);
    } catch {
      if (token === this.engagementProbeToken) {
        this.hasEngagement.set(false);
      }
    }
  }

  async ngOnInit(): Promise<void> {
    // Restore pinned state
    const pinned = localStorage.getItem('clint-sidebar-pinned');
    if (pinned === 'true') {
      this.sidebarPinned.set(true);
    }

    // First post-deploy load: surface the one-time hint pinned to the
    // Timeline tab so existing users notice the new home for the timeline
    // (engagement-landing-phase-1).
    this.onboardingTooltip.requestIfUnseen();

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
      intelligence: 'intelligence',
      profiles: 'profiles/companies',
      settings: 'settings/taxonomies',
      reference: 'help/taxonomies',
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
    this.navigateToSpaceRoute(route);
  }

  onSectionTabClick(tab: string): void {
    const section = this.activeSection();
    switch (section) {
      case 'landscape':
        switch (tab) {
          case 'home':
            this.navigateToSpaceRoute('');
            break;
          case 'timeline':
            this.navigateToSpaceRoute('timeline');
            break;
          case 'bullseye':
            this.navigateToSpaceRoute('bullseye/by-indication');
            break;
          case 'heatmap':
            this.navigateToSpaceRoute('heatmap/by-moa');
            break;
          case 'future-events':
            this.navigateToSpaceRoute('future-events');
            break;
        }
        break;
      case 'intelligence':
        this.navigateToSpaceRoute(tab);
        break;
      case 'profiles':
        this.navigateToSpaceRoute(`profiles/${tab}`);
        break;
    }
  }

  onBackClick(): void {
    // No detail-topbar routes currently defined; handler retained for future use.
  }

  // --- Tenant / Space ---

  switchTenant(newTenantId: string): void {
    localStorage.setItem('lastTenantId', newTenantId);

    // Brand resolves from window.location.host pre-bootstrap, so a
    // same-host SPA navigation keeps the OLD tenant's brand when the
    // user picks a tenant that lives on a different subdomain. Detect
    // host change and do a full-page navigation in that case so the
    // bootstrap re-runs against the target host.
    const target = this.tenants().find((t) => t.id === newTenantId);
    if (target && environment.apexDomain) {
      const targetHost = target.custom_domain ?? `${target.subdomain}.${environment.apexDomain}`;
      if (targetHost && targetHost !== window.location.host) {
        window.location.href = `${window.location.protocol}//${targetHost}/t/${newTenantId}/spaces`;
        return;
      }
    }

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

  goToHelp(): void {
    this.accountOpen.set(false);
    this.router.navigate(['/t', this.tenantId(), 'help', 'roles']);
  }

  async onSignOut(): Promise<void> {
    this.accountOpen.set(false);
    await this.supabase.signOut();
    this.router.navigate(['/login']);
  }

  // --- Topbar dropdown actions ---

  onTenantSettingsClick(): void {
    this.router.navigate(['/t', this.tenantId(), 'settings']);
  }

  onSpaceSettingsClick(): void {
    if (this.spaceId()) {
      this.navigateToSpaceRoute('settings/general');
    }
  }

  onNewSpaceClick(): void {
    this.createSpaceDialogOpen.set(true);
  }

  onJoinTenantClick(): void {
    this.router.navigate(['/onboarding'], { queryParams: { tab: 'join' } });
  }

  onAllSpacesClick(): void {
    this.router.navigate(['/t', this.tenantId(), 'spaces']);
  }

  // --- Create space dialog ---

  resetCreateSpaceForm(): void {
    this.newSpaceName.set('');
    this.newSpaceDesc.set('');
    this.createSpaceError.set(null);
  }

  async createSpace(): Promise<void> {
    if (!this.newSpaceName().trim()) return;
    this.creatingSpace.set(true);
    this.createSpaceError.set(null);
    try {
      const space = await this.spaceService.createSpace(
        this.tenantId(),
        this.newSpaceName().trim(),
        this.newSpaceDesc().trim() || undefined
      );
      this.createSpaceDialogOpen.set(false);
      this.resetCreateSpaceForm();
      this.switchSpace(space.id);
    } catch (e) {
      this.createSpaceError.set(e instanceof Error ? e.message : 'Failed to create space');
    } finally {
      this.creatingSpace.set(false);
    }
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
      // Setting tenantId triggers the reload effect (constructor), which
      // calls loadSpaces for the new tenant.
      this.tenantId.set(params['tenantId']);
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
