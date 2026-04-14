import { Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Select } from 'primeng/select';

interface NavItem {
  label: string;
  route: string;
  children?: NavItem[];
}

interface NavSection {
  label: string;
  items: NavItem[];
  bottom?: boolean;
}

const NAV_SECTIONS: NavSection[] = [
  {
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
    label: 'Intelligence',
    items: [
      { label: 'Events', route: 'events' },
      { label: 'Catalysts', route: 'catalysts' },
    ],
  },
  {
    label: 'Manage',
    items: [
      { label: 'Companies', route: 'manage/companies' },
      { label: 'Products', route: 'manage/products' },
      { label: 'Trials', route: 'manage/trials' },
    ],
  },
  {
    label: 'Settings',
    bottom: true,
    items: [
      { label: 'Taxonomies', route: 'settings/taxonomies' },
      { label: 'Marker Types', route: 'settings/marker-types' },
      { label: 'Organization', route: 'settings/organization' },
      { label: 'Spaces', route: 'settings/spaces' },
    ],
  },
];

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [FormsModule, Select],
  template: `
    <div
      class="sidebar-container"
      [class.sidebar-overlay]="expanded() && !pinned()"
      [class.sidebar-pinned]="pinned()"
      [class.sidebar-hidden]="!expanded() && !pinned()"
      role="complementary"
      aria-label="Navigation sidebar"
      (mouseenter)="mouseEnter.emit()"
      (mouseleave)="mouseLeave.emit()"
    >
      <!-- Header: org/space picker + pin button -->
      <div class="sidebar-header">
        <div class="org-space-area">
          @if (tenants().length >= 2) {
            <p-select
              [options]="tenants()"
              [ngModel]="currentTenantId()"
              (ngModelChange)="tenantChange.emit($event)"
              optionLabel="name"
              optionValue="id"
              styleClass="sidebar-select"
              [style]="{ width: '100%' }"
            />
          } @else {
            <div class="org-name">{{ tenantName() }}</div>
          }

          <button
            type="button"
            class="space-picker-btn"
            (click)="spacePickerOpen = !spacePickerOpen"
            [attr.aria-expanded]="spacePickerOpen"
            aria-label="Switch space"
          >
            <span class="space-name-text">{{ spaceName() || 'No space selected' }}</span>
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              aria-hidden="true"
              class="space-chevron"
              [class.space-chevron--open]="spacePickerOpen"
            >
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>

          @if (spacePickerOpen && spaces().length > 0) {
            <div class="space-dropdown">
              @for (space of spaces(); track space.id) {
                <button
                  type="button"
                  class="space-dropdown-item"
                  [class.space-dropdown-item--active]="space.id === currentSpaceId()"
                  (click)="selectSpace(space.id)"
                >
                  {{ space.name }}
                </button>
              }
            </div>
          }
        </div>

        <!-- Pin button -->
        @if (expanded() || pinned()) {
          <button
            type="button"
            class="pin-btn"
            [class.pin-btn--pinned]="pinned()"
            (click)="pinToggle.emit()"
            [attr.aria-label]="pinned() ? 'Unpin sidebar' : 'Pin sidebar'"
            [attr.aria-pressed]="pinned()"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 1.5L12.5 4L11 7.5V10H5V7.5L3.5 4L6 1.5H10Z" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linejoin="round"/>
              <line x1="8" y1="10" x2="8" y2="14.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
            </svg>
          </button>
        }
      </div>

      <!-- Nav sections -->
        <nav class="sidebar-nav" aria-label="Section navigation">
          @for (section of visibleSections(); track section.label) {
            <div
              class="nav-section"
              [class.nav-section--bottom]="section.bottom"
            >
              <div
                class="section-header"
                role="heading"
                aria-level="2"
              >
                {{ section.label }}
              </div>

              @for (item of section.items; track item.route) {
                @if (item.children) {
                  <!-- Expandable parent item (Bullseye) -->
                  <button
                    type="button"
                    class="nav-item"
                    [class.nav-item--active]="isActive(item.route)"
                    [attr.aria-current]="isActive(item.route) ? 'page' : null"
                    (click)="onNavClick(item.route)"
                  >
                    {{ item.label }}
                  </button>

                  @if (bullseyeExpanded()) {
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
                    {{ item.label }}
                  </button>
                }
              }
            </div>
          }
        </nav>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        position: relative;
      }

      .sidebar-container {
        width: 220px;
        min-width: 220px;
        height: 100%;
        background: #0f172a;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .sidebar-overlay {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        z-index: 40;
        box-shadow: 4px 0 24px rgba(0, 0, 0, 0.2);
        transform: translateX(0);
        transition: transform 200ms ease-out;
      }

      .sidebar-pinned {
        position: relative;
      }

      .sidebar-hidden {
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        z-index: 40;
        transform: translateX(-100%);
        transition: transform 200ms ease-out;
        pointer-events: none;
      }

      @media (prefers-reduced-motion: reduce) {
        .sidebar-overlay,
        .sidebar-hidden {
          transition: none;
        }
      }

      /* Header */
      .sidebar-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        padding: 16px 12px 12px;
        border-bottom: 1px solid #1e293b;
        gap: 8px;
        flex-shrink: 0;
      }

      .org-space-area {
        flex: 1;
        min-width: 0;
        position: relative;
      }

      .org-name {
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 4px;
      }

      .space-picker-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        background: transparent;
        border: none;
        cursor: pointer;
        padding: 0;
        color: #64748b;
        margin-top: 4px;
        outline: none;
        max-width: 100%;
      }

      .space-picker-btn:hover {
        color: #94a3b8;
      }

      .space-picker-btn:focus-visible {
        outline: 2px solid #0d9488;
        outline-offset: 2px;
        border-radius: 3px;
      }

      .space-name-text {
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 140px;
      }

      .space-chevron {
        flex-shrink: 0;
        transition: transform 150ms ease;
      }

      .space-chevron--open {
        transform: rotate(180deg);
      }

      @media (prefers-reduced-motion: reduce) {
        .space-chevron {
          transition: none;
        }
      }

      .space-dropdown {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: #1e293b;
        border: 1px solid #334155;
        border-radius: 6px;
        z-index: 50;
        margin-top: 4px;
        overflow: hidden;
      }

      .space-dropdown-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 12px;
        font-size: 12px;
        color: #94a3b8;
        background: transparent;
        border: none;
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        outline: none;
      }

      .space-dropdown-item:hover {
        color: #e2e8f0;
        background: #293548;
      }

      .space-dropdown-item:focus-visible {
        outline: 2px solid #0d9488;
        outline-offset: -2px;
      }

      .space-dropdown-item--active {
        color: #0d9488;
      }

      /* Pin button */
      .pin-btn {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        color: #475569;
        padding: 0;
        margin-top: 2px;
        transition:
          color 150ms ease,
          background-color 150ms ease,
          transform 150ms ease;
        outline: none;
      }

      .pin-btn:hover {
        color: #94a3b8;
        background: #1e293b;
      }

      .pin-btn:focus-visible {
        outline: 2px solid #0d9488;
        outline-offset: 2px;
      }

      .pin-btn--pinned {
        color: #0d9488;
        transform: rotate(45deg);
      }

      .pin-btn--pinned:hover {
        color: #14b8a6;
      }

      @media (prefers-reduced-motion: reduce) {
        .pin-btn {
          transition: none;
        }
      }

      /* Nav */
      .sidebar-nav {
        display: flex;
        flex-direction: column;
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 8px 0 16px;
        scrollbar-width: thin;
        scrollbar-color: #1e293b transparent;
      }

      .sidebar-nav::-webkit-scrollbar {
        width: 4px;
      }

      .sidebar-nav::-webkit-scrollbar-track {
        background: transparent;
      }

      .sidebar-nav::-webkit-scrollbar-thumb {
        background: #1e293b;
        border-radius: 2px;
      }

      /* Nav section */
      .nav-section {
        padding-bottom: 8px;
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

      /* Nav items */
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
        outline: 2px solid #0d9488;
        outline-offset: -2px;
        border-radius: 0 5px 5px 0;
      }

      .nav-item--active {
        color: #0d9488;
        background: rgba(13, 148, 136, 0.15);
        border-left-color: #0d9488;
        border-radius: 0 5px 5px 0;
        font-weight: 500;
      }

      .nav-item--active:hover {
        color: #0d9488;
        background: rgba(13, 148, 136, 0.2);
      }

      /* Child nav items (Bullseye sub-items) */
      .nav-item--child {
        padding-left: 40px;
        font-size: 11px;
      }

      /* PrimeNG Select override for dark background */
      :host ::ng-deep .sidebar-select .p-select {
        background: transparent;
        border: 1px solid #334155;
        border-radius: 4px;
      }

      :host ::ng-deep .sidebar-select .p-select:hover {
        border-color: #475569;
      }

      :host ::ng-deep .sidebar-select .p-select .p-select-label {
        font-size: 13px;
        font-weight: 700;
        color: #ffffff;
        padding: 4px 8px;
      }

      :host ::ng-deep .sidebar-select .p-select .p-select-dropdown {
        color: #64748b;
      }
    `,
  ],
})
export class SidebarComponent {
  readonly expanded = input<boolean>(false);
  readonly pinned = input<boolean>(false);
  readonly activeRoute = input<string>('');

  readonly tenantName = input<string>('');
  readonly tenants = input<{ id: string; name: string }[]>([]);
  readonly currentTenantId = input<string>('');

  readonly spaceName = input<string>('');
  readonly spaces = input<{ id: string; name: string }[]>([]);
  readonly currentSpaceId = input<string>('');

  readonly hasSpace = input<boolean>(false);

  readonly pinToggle = output<void>();
  readonly navItemClick = output<string>();
  readonly tenantChange = output<string>();
  readonly spaceChange = output<string>();
  readonly mouseEnter = output<void>();
  readonly mouseLeave = output<void>();

  private readonly allSections: NavSection[] = NAV_SECTIONS;

  private readonly orgOnlySections: NavSection[] = [
    {
      label: 'Settings',
      bottom: true,
      items: [
        { label: 'Organization', route: 'settings/organization' },
        { label: 'Spaces', route: 'settings/spaces' },
      ],
    },
  ];

  readonly visibleSections = computed(() =>
    this.hasSpace() ? this.allSections : this.orgOnlySections
  );

  spacePickerOpen = false;

  readonly bullseyeExpanded = computed(() => this.activeRoute().startsWith('bullseye'));

  isActive(route: string): boolean {
    return this.activeRoute() === route;
  }

  onNavClick(route: string): void {
    this.navItemClick.emit(route);
  }

  selectSpace(spaceId: string): void {
    this.spacePickerOpen = false;
    this.spaceChange.emit(spaceId);
  }
}
