import { Component, computed, input, output } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';

interface NavItem {
  label: string;
  route: string;
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
      { label: 'Timeline', route: '' },
      {
        label: 'Bullseye',
        route: 'bullseye',
        children: [
          { label: 'Therapy Area', route: 'bullseye/by-therapy-area' },
          { label: 'Company', route: 'bullseye/by-company' },
          { label: 'MOA', route: 'bullseye/by-moa' },
          { label: 'ROA', route: 'bullseye/by-roa' },
        ],
      },
      { label: 'Positioning', route: 'positioning' },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { label: 'Events', route: 'events' },
      { label: 'Catalysts', route: 'catalysts' },
    ],
  },
  {
    id: 'manage',
    label: 'Manage',
    items: [
      { label: 'Companies', route: 'manage/companies' },
      { label: 'Products', route: 'manage/products' },
      { label: 'Trials', route: 'manage/trials' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    bottom: true,
    items: [
      { label: 'General', route: 'settings/general' },
      { label: 'Members', route: 'settings/members' },
      { label: 'Taxonomies', route: 'settings/taxonomies' },
      { label: 'Marker Types', route: 'settings/marker-types' },
    ],
  },
];

const ORG_ONLY_SECTIONS: NavSection[] = [];

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [Tooltip],
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
          aria-label="Go to home"
          (click)="logoClick.emit()"
        >
          <div class="logo-square">C</div>
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
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 1.5L12.5 4L11 7.5V10H5V7.5L3.5 4L6 1.5H10Z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
              <line x1="8" y1="10" x2="8" y2="14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
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
                  <button type="button" class="nav-item"
                    [class.nav-item--active]="isActive(item.route)"
                    [attr.aria-current]="isActive(item.route) ? 'page' : null"
                    (click)="onNavClick(item.route)">
                    {{ item.label }}
                  </button>
                  @if (bullseyeExpanded()) {
                    @for (child of item.children; track child.route) {
                      <button type="button" class="nav-item nav-item--child"
                        [class.nav-item--active]="isActive(child.route)"
                        [attr.aria-current]="isActive(child.route) ? 'page' : null"
                        (click)="onNavClick(child.route)">
                        {{ child.label }}
                      </button>
                    }
                  }
                } @else {
                  <button type="button" class="nav-item"
                    [class.nav-item--active]="isActive(item.route)"
                    [attr.aria-current]="isActive(item.route) ? 'page' : null"
                    (click)="onNavClick(item.route)">
                    {{ item.label }}
                  </button>
                }
              }
            } @else {
              <!-- Collapsed: section icon only -->
              <button type="button" class="icon-btn"
                [class.icon-btn--active]="isSectionActive(section.id)"
                [attr.aria-label]="section.label"
                [attr.aria-current]="isSectionActive(section.id) ? 'true' : null"
                [pTooltip]="section.label"
                tooltipPosition="right"
                (click)="onSectionClick(section.id)">
                @if (isSectionActive(section.id)) {
                  <span class="active-indicator" aria-hidden="true"></span>
                }
                <!-- Section icons -->
                @if (section.id === 'landscape') {
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <rect x="2" y="4" width="16" height="2.5" rx="1.25" [attr.fill]="iconColor(section.id)"/>
                    <rect x="2" y="9" width="16" height="2.5" rx="1.25" [attr.fill]="iconColor(section.id)"/>
                    <rect x="2" y="14" width="16" height="2.5" rx="1.25" [attr.fill]="iconColor(section.id)"/>
                  </svg>
                }
                @if (section.id === 'intelligence') {
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <path d="M10 3L12 7.5H16.5L13 10L14 14.5L10 12L6 14.5L7 10L3.5 7.5H8L10 3Z" [attr.stroke]="iconColor(section.id)" stroke-width="1.5" fill="none" stroke-linejoin="round"/>
                  </svg>
                }
                @if (section.id === 'manage') {
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <rect x="3" y="3" width="14" height="14" rx="2.5" [attr.stroke]="iconColor(section.id)" stroke-width="1.5" fill="none"/>
                    <path d="M6 7.5h8M6 10h8M6 12.5h5" [attr.stroke]="iconColor(section.id)" stroke-width="1.2" stroke-linecap="round"/>
                  </svg>
                }
                @if (section.id === 'settings') {
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                    <circle cx="10" cy="10" r="3" [attr.stroke]="iconColor(section.id)" stroke-width="1.5" fill="none"/>
                    <path d="M10 2v2M10 16v2M2 10h2M16 10h2M4.93 4.93l1.41 1.41M13.66 13.66l1.41 1.41M4.93 15.07l1.41-1.41M13.66 6.34l1.41-1.41" [attr.stroke]="iconColor(section.id)" stroke-width="1.3" stroke-linecap="round"/>
                  </svg>
                }
              </button>
            }
          </div>
        }
      </div>

      <!-- User avatar -->
      <div class="sidebar__footer">
        <button type="button" class="avatar-btn"
          [attr.aria-label]="'User account: ' + userInitials()"
          [pTooltip]="isExpanded() ? '' : 'Account'"
          tooltipPosition="right"
          (click)="avatarClick.emit()">
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
        outline: 2px solid #0d9488;
        outline-offset: 2px;
        border-radius: 8px;
      }

      .logo-square {
        width: 28px;
        height: 28px;
        background: #0d9488;
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        line-height: 1;
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
        padding: 0;
        margin-top: 4px;
        transition: color 150ms ease, transform 150ms ease;
        outline: none;
      }
      .pin-btn:hover { color: #94a3b8; background: #1e293b; }
      .pin-btn:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }
      .pin-btn--pinned { color: #0d9488; transform: rotate(45deg); }

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

      .nav-section { padding-bottom: 8px; }
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
        display: block;
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
        transition: color 120ms ease, background-color 120ms ease;
        outline: none;
      }
      .nav-item:hover { color: #e2e8f0; background: #1e293b; }
      .nav-item:focus-visible { outline: 2px solid #0d9488; outline-offset: -2px; border-radius: 0 5px 5px 0; }
      .nav-item--active {
        color: #0d9488;
        background: rgba(13, 148, 136, 0.15);
        border-left-color: #0d9488;
        border-radius: 0 5px 5px 0;
        font-weight: 500;
      }
      .nav-item--active:hover { color: #0d9488; background: rgba(13, 148, 136, 0.2); }
      .nav-item--child { padding-left: 40px; font-size: 11px; }

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
        transition: background-color 150ms ease;
        outline: none;
      }
      .icon-btn:hover { background: #1e293b; }
      .icon-btn--active { background: rgba(13, 148, 136, 0.15); }
      .icon-btn:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }

      .active-indicator {
        position: absolute;
        left: -6px;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 18px;
        background: #0d9488;
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
        background: rgba(13, 148, 136, 0.15);
        border: 1.5px solid rgba(13, 148, 136, 0.4);
        border-radius: 50%;
        color: #0d9488;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        padding: 0;
        outline: none;
        user-select: none;
      }
      .avatar-btn:hover { background: rgba(13, 148, 136, 0.25); border-color: rgba(13, 148, 136, 0.7); }
      .avatar-btn:focus-visible { outline: 2px solid #0d9488; outline-offset: 2px; }

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
  readonly expanded = input<boolean>(false);
  readonly pinned = input<boolean>(false);
  readonly activeRoute = input<string>('');
  readonly hasSpace = input<boolean>(false);
  readonly userInitials = input<string>('');
  readonly userEmail = input<string>('');

  readonly pinToggle = output<void>();
  readonly navItemClick = output<string>();
  readonly logoClick = output<void>();
  readonly avatarClick = output<void>();
  readonly sectionClick = output<string>();
  readonly hoverChange = output<boolean>();

  readonly isExpanded = computed(() => this.expanded() || this.pinned());

  readonly visibleSections = computed(() =>
    this.hasSpace() ? NAV_SECTIONS : ORG_ONLY_SECTIONS
  );

  readonly bullseyeExpanded = computed(() => this.activeRoute().startsWith('bullseye'));

  readonly activeSection = computed(() => {
    const route = this.activeRoute();
    if (route.startsWith('manage/')) return 'manage';
    if (route.startsWith('settings/')) return 'settings';
    if (route === 'events' || route === 'catalysts') return 'intelligence';
    return 'landscape';
  });

  isActive(route: string): boolean {
    return this.activeRoute() === route;
  }

  isSectionActive(sectionId: string): boolean {
    return this.activeSection() === sectionId;
  }

  iconColor(sectionId: string): string {
    return this.isSectionActive(sectionId) ? '#0d9488' : '#64748b';
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
