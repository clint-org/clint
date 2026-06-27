import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { Tooltip } from 'primeng/tooltip';
import { PLATFORM_OPERATOR } from '../models/legal-content';
import { ClintLogoComponent } from '../../shared/components/clint-logo.component';
import { BrandContextService } from '../services/brand-context.service';
import { NAV_SECTIONS, ORG_ONLY_SECTIONS, filterNavSections } from './sidebar-nav';
import type { SidebarSectionId } from './sidebar-nav';

export type { SidebarSectionId } from './sidebar-nav';

@Component({
  selector: 'app-sidebar',
  imports: [Tooltip, ClintLogoComponent, NgOptimizedImage],
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
      <!-- Logo row: the product identity is always Clint (the platform name,
           never the tenant: the tenant lives in the topbar chooser). The
           agency credit is a colophon at the sidebar's bottom edge. -->
      <div class="sidebar__logo">
        <button
          type="button"
          class="logo-btn"
          [attr.aria-label]="logoLabel()"
          [pTooltip]="isExpanded() ? '' : logoTooltip()"
          tooltipPosition="right"
          (click)="logoClick.emit()"
        >
          @if (isExpanded()) {
            <span class="identity-lockup">
              <app-clint-logo [size]="20" [dark]="true" />
              <span class="identity-wordmark">{{ wordmark }}</span>
            </span>
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
              <!-- Collapsed: section label + individual item icons -->
              <span class="collapsed-label" aria-hidden="true">{{ section.label }}</span>
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
          [class]="
            userAvatarUrl()
              ? 'avatar-btn overflow-hidden border-transparent bg-transparent p-0 hover:bg-transparent'
              : 'avatar-btn'
          "
          [attr.aria-label]="'User account: ' + userInitials()"
          [pTooltip]="isExpanded() ? '' : 'Account'"
          tooltipPosition="right"
          (click)="avatarClick.emit()"
        >
          @if (userAvatarUrl(); as url) {
            <img
              [ngSrc]="url"
              [alt]="userInitials()"
              width="28"
              height="28"
              class="size-full rounded-full object-cover"
              referrerpolicy="no-referrer"
            />
          } @else {
            {{ userInitials() }}
          }
        </button>
        @if (isExpanded()) {
          <span class="avatar-email">{{ userEmail() }}</span>
        }
      </div>

      <!-- Agency colophon: passive signage at the true bottom edge, on every
           page (the sidebar is global chrome). Expanded only: the 52px rail
           has no room for a third bottom row. -->
      @if (isExpanded()) {
        @if (agencyBrand(); as ag) {
          <div class="agency-credit">
            <span class="agency-credit__label">Intelligence by</span>
            @if (ag.logo_url) {
              <img
                [ngSrc]="ag.logo_url"
                [alt]="ag.name"
                width="140"
                height="28"
                class="agency-credit__logo"
              />
            } @else {
              <span class="agency-credit__name">{{ ag.name }}</span>
            }
          </div>
        }
      }
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
        align-items: center;
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

      .identity-lockup {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .identity-wordmark {
        color: #e2e8f0;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 0.28em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      /* Agency colophon at the bottom edge. Agency wordmarks tend to be
         dark-on-light, so the logo sits on a near-white tile to stay legible
         against the slate-900 sidebar. */
      .agency-credit {
        display: flex;
        align-items: center;
        gap: 6px;
        border-top: 1px solid #1e293b;
        margin-top: 8px;
        padding: 10px 12px 14px;
      }

      .agency-credit__label {
        color: #64748b;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 8.5px;
        font-weight: 600;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        white-space: nowrap;
      }

      .agency-credit__logo {
        height: 16px;
        max-width: 104px;
        width: auto;
        object-fit: contain;
        background: #f8fafc;
        border-radius: 3px;
        padding: 1px 4px;
        box-sizing: content-box;
      }

      .agency-credit__name {
        color: #cbd5e1;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
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

      .collapsed-label {
        display: none;
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  private readonly brandContext = inject(BrandContextService);

  readonly expanded = input<boolean>(false);
  readonly pinned = input<boolean>(false);
  readonly activeRoute = input<string>('');
  readonly hasSpace = input<boolean>(false);
  readonly canEdit = input<boolean>(true);
  readonly isOwner = input<boolean>(false);
  readonly userInitials = input<string>('');
  readonly userEmail = input<string>('');
  readonly userAvatarUrl = input<string | null>(null);

  /**
   * Agency for the bottom-edge colophon ("Intelligence by ..."). Null on
   * tenant hosts without an agency, and on default / super-admin hosts.
   * The top identity slot is always the Clint lockup: the tenant lives in
   * the topbar chooser, never in the sidebar.
   */
  readonly agencyBrand = this.brandContext.agency;
  /** Product wordmark: the platform name, tracked uppercase via CSS. */
  protected readonly wordmark = PLATFORM_OPERATOR;
  readonly logoLabel = computed(() => 'Go to home');
  readonly logoTooltip = computed(() => (this.hasSpace() ? 'Space home' : 'Spaces'));

  readonly pinToggle = output<void>();
  readonly navItemClick = output<string>();
  readonly logoClick = output<void>();
  readonly avatarClick = output<void>();
  readonly sectionClick = output<SidebarSectionId>();
  readonly hoverChange = output<boolean>();

  readonly isExpanded = computed(() => this.expanded() || this.pinned());

  readonly visibleSections = computed(() => {
    if (!this.hasSpace()) return ORG_ONLY_SECTIONS;
    return filterNavSections(NAV_SECTIONS, this.canEdit(), this.isOwner());
  });

  isParentExpanded(route: string): boolean {
    return this.activeRoute().startsWith(route);
  }

  readonly activeSection = computed(() => {
    const route = this.activeRoute();
    if (route === 'profiles/engagement') return 'intelligence';
    if (route.startsWith('profiles/')) return 'profiles';
    if (route.startsWith('settings/')) return 'settings';
    if (route.startsWith('help/')) return 'reference';
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

  onSectionClick(sectionId: SidebarSectionId): void {
    this.sectionClick.emit(sectionId);
  }

  onMouseEnter(): void {
    this.hoverChange.emit(true);
  }

  onMouseLeave(): void {
    this.hoverChange.emit(false);
  }
}
