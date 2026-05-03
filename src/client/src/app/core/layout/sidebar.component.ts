import { Component, computed, inject, input, output } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';
import { ClintLogoComponent } from '../../shared/components/clint-logo.component';
import { NAV_ICONS } from '../../shared/constants/nav-icons';
import { BrandContextService } from '../services/brand-context.service';

interface NavItem {
  label: string;
  route: string;
  icon?: string;
  children?: NavItem[];
}

interface NavSection {
  id: string;
  label: string;
  items: NavItem[];
  bottom?: boolean;
}

const NAV_SECTIONS: NavSection[] = [
  {
    id: 'landscape',
    label: 'Landscape',
    items: [
      { label: 'Home', route: '', icon: NAV_ICONS['home'] },
      { label: 'Timeline', route: 'timeline', icon: NAV_ICONS['timeline'] },
      {
        label: 'Bullseye',
        route: 'bullseye',
        icon: NAV_ICONS['bullseye'],
        children: [
          { label: 'Therapy Area', route: 'bullseye/by-therapy-area' },
          { label: 'Company', route: 'bullseye/by-company' },
          { label: 'MOA', route: 'bullseye/by-moa' },
          { label: 'ROA', route: 'bullseye/by-roa' },
        ],
      },
      {
        label: 'Positioning',
        route: 'positioning',
        icon: NAV_ICONS['positioning'],
        children: [
          { label: 'MOA', route: 'positioning/by-moa' },
          { label: 'Therapy Area', route: 'positioning/by-therapy-area' },
          { label: 'MOA + TA', route: 'positioning/by-moa-therapy-area' },
          { label: 'Company', route: 'positioning/by-company' },
          { label: 'ROA', route: 'positioning/by-roa' },
        ],
      },
      { label: 'Future Catalysts', route: 'catalysts', icon: NAV_ICONS['catalysts'] },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      {
        label: 'Intelligence Feed',
        route: 'intelligence',
        icon: NAV_ICONS['intelligence-feed'],
      },
      { label: 'Materials', route: 'materials', icon: NAV_ICONS['materials'] },
      { label: 'Events', route: 'events', icon: NAV_ICONS['events'] },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { label: 'Companies', route: 'manage/companies', icon: NAV_ICONS['companies'] },
      { label: 'Products', route: 'manage/products', icon: NAV_ICONS['products'] },
      { label: 'Trials', route: 'manage/trials', icon: NAV_ICONS['trials'] },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    bottom: true,
    items: [
      { label: 'General', route: 'settings/general', icon: NAV_ICONS['general'] },
      { label: 'Members', route: 'settings/members', icon: NAV_ICONS['members'] },
      { label: 'Fields', route: 'settings/fields', icon: NAV_ICONS['fields'] },
      { label: 'Taxonomies', route: 'settings/taxonomies', icon: NAV_ICONS['taxonomies'] },
      { label: 'Marker Types', route: 'settings/marker-types', icon: NAV_ICONS['marker-types'] },
    ],
  },
];

const ORG_ONLY_SECTIONS: NavSection[] = [];

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [Tooltip, ClintLogoComponent],
  template: `
    <div
      class="sidebar"
      [class.sidebar--expanded]="isExpanded()"
      [class.sidebar--collapsed]="!isExpanded()"
      [class.sidebar--pinned]="pinned()"
      role="navigation"
      aria-label="Main navigation"
      (mouseenter)="onMouseEnter()"
      (mouseleave)="onMouseLeave()"
    >
      <!-- Logo row -->
      <div class="sidebar__logo">
        <button
          type="button"
          class="logo-btn"
          [attr.aria-label]="logoLabel()"
          (click)="logoClick.emit()"
        >
          @if (agencyBrand(); as ag) {
            @if (isExpanded() && ag.logo_url) {
              <img [src]="ag.logo_url" [alt]="ag.name" class="agency-wordmark" />
            } @else {
              <span class="agency-initial" aria-hidden="true">{{ agencyInitial() }}</span>
            }
          } @else {
            <app-clint-logo [size]="24" [dark]="true" />
          }
        </button>

        @if (isExpanded()) {
          <div class="flex-1"></div>
          <!-- Pin button -->
          <button
            type="button"
            class="pin-btn"
            [class.pin-btn--pinned]="pinned()"
            (click)="pinToggle.emit()"
            [attr.aria-label]="pinned() ? 'Unpin sidebar' : 'Pin sidebar'"
            [attr.aria-pressed]="pinned()"
          >
            <i class="fa-solid fa-thumbtack" aria-hidden="true"></i>
          </button>
        }
      </div>

      <!-- Section icons (collapsed) / full nav (expanded) -->
      <div class="sidebar__nav">
        @for (section of visibleSections(); track section.id) {
          <div class="nav-section" [class.nav-section--bottom]="section.bottom">
            @if (isExpanded()) {
              <!-- Expanded: section header + nav items -->
              <div class="section-header" role="heading" aria-level="2">{{ section.label }}</div>
              @for (item of section.items; track item.route) {
                @if (item.children) {
                  <button
                    type="button"
                    class="nav-item"
                    [class.nav-item--active]="isActive(item.route)"
                    [attr.aria-current]="isActive(item.route) ? 'page' : null"
                    (click)="onNavClick(item.route)"
                  >
                    @if (item.icon) {
                      <i [class]="item.icon + ' nav-item__icon'" aria-hidden="true"></i>
                    }
                    {{ item.label }}
                  </button>
                  @if (isParentExpanded(item.route)) {
                    @for (child of item.children; track child.route) {
                      <button
                        type="button"
                        class="nav-item nav-item--child"
                        [class.nav-item--active]="isActive(child.route)"
                        [attr.aria-current]="isActive(child.route) ? 'page' : null"
                        (click)="onNavClick(child.route)"
                      >
                        {{ child.label }}
                      </button>
                    }
                  }
                } @else {
                  <button
                    type="button"
                    class="nav-item"
                    [class.nav-item--active]="isActive(item.route)"
                    [attr.aria-current]="isActive(item.route) ? 'page' : null"
                    (click)="onNavClick(item.route)"
                  >
                    @if (item.icon) {
                      <i [class]="item.icon + ' nav-item__icon'" aria-hidden="true"></i>
                    }
                    {{ item.label }}
                  </button>
                }
              }
            } @else {
              <!-- Collapsed: individual item icons with section dividers -->
              @for (item of section.items; track item.route) {
                <button
                  type="button"
                  class="icon-btn"
                  [class.icon-btn--active]="isActive(item.route)"
                  [attr.aria-label]="item.label"
                  [attr.aria-current]="isActive(item.route) ? 'page' : null"
                  [pTooltip]="item.label"
                  tooltipPosition="right"
                  (click)="onNavClick(item.route)"
                >
                  @if (isActive(item.route)) {
                    <span class="active-indicator" aria-hidden="true"></span>
                  }
                  @if (item.icon) {
                    <i
                      [class]="item.icon"
                      [style.color]="isActive(item.route) ? 'var(--brand-on-dark)' : '#64748b'"
                      aria-hidden="true"
                    ></i>
                  }
                </button>
              }
            }
          </div>
        }
      </div>

      <!-- User avatar -->
      <div class="sidebar__footer">
        <button
          type="button"
          class="avatar-btn"
          [attr.aria-label]="'User account: ' + userInitials()"
          [pTooltip]="isExpanded() ? '' : 'Account'"
          tooltipPosition="right"
          (click)="avatarClick.emit()"
        >
          {{ userInitials() }}
        </button>
        @if (isExpanded()) {
          <span class="avatar-email">{{ userEmail() }}</span>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        flex-shrink: 0;
      }

      .sidebar {
        height: 100%;
        background: #0f172a;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        transition: width 200ms ease-out;
      }

      /* On mobile the shell uses natural body scroll (height: auto +
         min-height: 100vh), so percentage heights collapse. Drop the
         explicit height and let the flex container stretch the sidebar
         to match the shell's actual height -- which grows with content. */
      @media (max-width: 767px) {
        :host {
          height: auto;
          align-self: stretch;
        }
        .sidebar {
          height: auto;
          min-height: 100%;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .sidebar {
          transition: none;
        }
      }

      .sidebar--collapsed {
        width: 48px;
      }

      .sidebar--expanded {
        width: 220px;
      }

      /* Logo row */
      .sidebar__logo {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 12px;
        border-bottom: 1px solid #1e293b;
        flex-shrink: 0;
      }

      .sidebar--collapsed .sidebar__logo {
        justify-content: center;
        padding: 12px 0;
      }

      .logo-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0;
        outline: none;
      }

      .logo-btn:focus-visible {
        outline: 2px solid var(--brand-on-dark);
        outline-offset: 2px;
        border-radius: 8px;
      }

      /* Agency mark in expanded sidebar: agency-uploaded wordmarks tend to
         be dark-on-light, so render them on a near-white tile to stay
         legible against the slate-900 sidebar. Cap height + width so any
         aspect ratio fits the column without crowding the pin button. */
      .agency-wordmark {
        height: 24px;
        max-width: 156px;
        width: auto;
        object-fit: contain;
        background: #f8fafc;
        border-radius: 4px;
        padding: 2px 6px;
        box-sizing: content-box;
      }

      /* Collapsed-state badge (and fallback when an agency has no logo).
         Initial letter on a brand-tinted square -- the same visual idiom
         tenant badges use elsewhere in the app. */
      .agency-initial {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        border-radius: 5px;
        background: rgb(from var(--brand-on-dark) r g b / 0.15);
        color: var(--brand-on-dark);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        user-select: none;
      }

      .pin-btn {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 24px;
        height: 24px;
        background: transparent;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        color: #475569;
        font-size: 11px;
        padding: 0;
        margin-top: 4px;
        transition:
          color 150ms ease,
          transform 150ms ease;
        outline: none;
      }
      .pin-btn:hover {
        color: #94a3b8;
        background: #1e293b;
      }
      .pin-btn:focus-visible {
        outline: 2px solid var(--brand-on-dark);
        outline-offset: 2px;
      }
      .pin-btn--pinned {
        color: var(--brand-on-dark);
        transform: rotate(45deg);
      }

      /* Nav area */
      .sidebar__nav {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 8px 0;
        scrollbar-width: thin;
        scrollbar-color: #1e293b transparent;
      }

      .sidebar--collapsed .sidebar__nav {
        align-items: center;
        gap: 4px;
        padding: 12px 0;
      }

      .nav-section {
        padding-bottom: 8px;
      }
      .sidebar--collapsed .nav-section + .nav-section {
        border-top: 1px solid #1e293b;
        padding-top: 8px;
      }
      .nav-section--bottom {
        margin-top: auto;
        border-top: 1px solid #1e293b;
        padding-top: 8px;
      }

      .section-header {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 1.5px;
        color: #475569;
        padding: 8px 20px 4px;
        margin-bottom: 2px;
        user-select: none;
      }

      /* Nav items (expanded) */
      .nav-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        text-align: left;
        padding: 6px 20px;
        font-size: 12px;
        font-weight: 400;
        color: #94a3b8;
        background: transparent;
        border: none;
        border-left: 2px solid transparent;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition:
          color 120ms ease,
          background-color 120ms ease;
        outline: none;
      }
      .nav-item:hover {
        color: #e2e8f0;
        background: #1e293b;
      }
      .nav-item:focus-visible {
        outline: 2px solid var(--brand-on-dark);
        outline-offset: -2px;
        border-radius: 0 5px 5px 0;
      }
      .nav-item--active {
        color: var(--brand-on-dark);
        background: rgb(from var(--brand-on-dark) r g b / 0.15);
        border-left-color: var(--brand-on-dark);
        border-radius: 0 5px 5px 0;
        font-weight: 500;
      }
      .nav-item--active:hover {
        color: var(--brand-on-dark);
        background: rgb(from var(--brand-on-dark) r g b / 0.2);
      }
      .nav-item__icon {
        width: 14px;
        font-size: 10px;
        text-align: center;
        opacity: 0.6;
        flex-shrink: 0;
      }
      .nav-item--active .nav-item__icon {
        opacity: 1;
      }
      .nav-item--child {
        padding-left: 42px;
        font-size: 11px;
      }

      /* Icon buttons (collapsed) */
      .icon-btn {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: transparent;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        padding: 0;
        font-size: 13px;
        transition: background-color 150ms ease;
        outline: none;
      }
      .icon-btn:hover {
        background: #1e293b;
      }
      .icon-btn--active {
        background: rgb(from var(--brand-on-dark) r g b / 0.15);
      }
      .icon-btn:focus-visible {
        outline: 2px solid var(--brand-on-dark);
        outline-offset: 2px;
      }

      .icon-btn__label {
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        line-height: 1;
        user-select: none;
      }

      .active-indicator {
        position: absolute;
        left: -6px;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 18px;
        background: var(--brand-on-dark);
        border-radius: 0 2px 2px 0;
      }

      /* Footer / avatar */
      .sidebar__footer {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px;
        border-top: 1px solid #1e293b;
        flex-shrink: 0;
      }

      .sidebar--collapsed .sidebar__footer {
        justify-content: center;
        padding: 12px 0;
      }

      .avatar-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        flex-shrink: 0;
        background: rgb(from var(--brand-on-dark) r g b / 0.15);
        border: 1.5px solid rgb(from var(--brand-on-dark) r g b / 0.4);
        border-radius: 50%;
        color: var(--brand-on-dark);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        padding: 0;
        outline: none;
        user-select: none;
      }
      .avatar-btn:hover {
        background: rgb(from var(--brand-on-dark) r g b / 0.25);
        border-color: rgb(from var(--brand-on-dark) r g b / 0.7);
      }
      .avatar-btn:focus-visible {
        outline: 2px solid var(--brand-on-dark);
        outline-offset: 2px;
      }

      .avatar-email {
        font-size: 11px;
        color: #64748b;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
      }
    `,
  ],
})
export class SidebarComponent {
  private readonly brandContext = inject(BrandContextService);

  readonly expanded = input<boolean>(false);
  readonly pinned = input<boolean>(false);
  readonly activeRoute = input<string>('');
  readonly hasSpace = input<boolean>(false);
  readonly userInitials = input<string>('');
  readonly userEmail = input<string>('');

  /**
   * On a tenant host whose tenant was provisioned by an agency, the agency
   * occupies the platform-brand slot (this sidebar) -- they whitelabeled
   * Clint, so they should sit where Clint would. Null on tenant hosts
   * without an agency, and on default / super-admin hosts (the agency
   * portal itself uses its own shell).
   */
  readonly agencyBrand = this.brandContext.agency;
  readonly agencyInitial = computed(() => {
    const name = this.agencyBrand()?.name?.trim() ?? '';
    return name ? name.charAt(0).toUpperCase() : '?';
  });
  readonly logoLabel = computed(() => {
    const ag = this.agencyBrand();
    return ag ? `${ag.name} -- go to home` : 'Go to home';
  });

  readonly pinToggle = output<void>();
  readonly navItemClick = output<string>();
  readonly logoClick = output<void>();
  readonly avatarClick = output<void>();
  readonly sectionClick = output<string>();
  readonly hoverChange = output<boolean>();

  readonly isExpanded = computed(() => this.expanded() || this.pinned());

  readonly visibleSections = computed(() => (this.hasSpace() ? NAV_SECTIONS : ORG_ONLY_SECTIONS));

  isParentExpanded(route: string): boolean {
    return this.activeRoute().startsWith(route);
  }

  readonly activeSection = computed(() => {
    const route = this.activeRoute();
    if (route.startsWith('manage/')) return 'manage';
    if (route.startsWith('settings/')) return 'settings';
    if (route === 'events' || route === 'intelligence' || route === 'materials') {
      return 'intelligence';
    }
    if (route === 'catalysts') return 'landscape';
    return 'landscape';
  });

  isActive(route: string): boolean {
    return this.activeRoute() === route;
  }

  isSectionActive(sectionId: string): boolean {
    return this.activeSection() === sectionId;
  }

  iconColor(sectionId: string): string {
    return this.isSectionActive(sectionId) ? 'var(--brand-on-dark)' : '#64748b';
  }

  onNavClick(route: string): void {
    this.navItemClick.emit(route);
  }

  onSectionClick(sectionId: string): void {
    this.sectionClick.emit(sectionId);
  }

  onMouseEnter(): void {
    this.hoverChange.emit(true);
  }

  onMouseLeave(): void {
    this.hoverChange.emit(false);
  }
}
