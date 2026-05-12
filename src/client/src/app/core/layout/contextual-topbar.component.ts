import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { TopbarAction } from '../services/topbar-state.service';
import { PaletteHotkeyService } from '../services/palette-hotkey.service';
import { NAV_ICONS } from '../../shared/constants/nav-icons';

export interface TopbarTab {
  label: string;
  value: string;
  active: boolean;
  icon?: string;
}

@Component({
  selector: 'app-contextual-topbar',
  standalone: true,
  imports: [ButtonModule, NgOptimizedImage, Tooltip],
  template: `
    <div class="topbar" role="banner">
      <!-- Tenant/Space breadcrumb -->
      <div class="breadcrumb">
        <!-- Tenant badge + name -->
        <div class="tenant-trigger" [class.interactive]="tenants().length > 1">
          @if (tenants().length > 1) {
            <button
              class="tenant-button"
              (click)="toggleTenantDropdown()"
              [attr.aria-expanded]="tenantDropdownOpen()"
              aria-haspopup="listbox"
              aria-label="Switch tenant"
            >
              @if (tenantLogoUrl()) {
                <img
                  [ngSrc]="tenantLogoUrl()!"
                  width="20"
                  height="20"
                  class="tenant-badge-img"
                  alt=""
                />
              } @else {
                <span class="tenant-badge" aria-hidden="true">{{ tenantInitial() }}</span>
              }
              <span class="tenant-display-name">{{ tenantName() }}</span>
              <span class="dropdown-chevron" aria-hidden="true">&#9662;</span>
            </button>
            @if (tenantDropdownOpen()) {
              <div class="dropdown tenant-dropdown" role="listbox" aria-label="Tenants">
                @for (t of tenants(); track t.id) {
                  <button
                    class="dropdown-item"
                    role="option"
                    [attr.aria-selected]="t.id === currentTenantId()"
                    [class.active]="t.id === currentTenantId()"
                    (click)="selectTenant(t.id)"
                  >
                    {{ t.name }}
                  </button>
                }
                <div class="dropdown-footer">
                  <button
                    type="button"
                    class="dropdown-item dropdown-item--footer"
                    (click)="onTenantSettingsClick()"
                  >
                    <i class="fa-solid fa-gear text-[10px]"></i> Tenant settings
                  </button>
                  <button
                    type="button"
                    class="dropdown-item dropdown-item--footer"
                    (click)="onJoinTenantClick()"
                  >
                    <i class="fa-solid fa-user-plus text-[10px]"></i> Join with code
                  </button>
                </div>
              </div>
            }
          } @else {
            <div class="tenant-switcher">
              <button
                type="button"
                class="tenant-btn"
                (click)="tenantDropdownOpen.set(!tenantDropdownOpen())"
                [attr.aria-expanded]="tenantDropdownOpen()"
              >
                @if (tenantLogoUrl()) {
                  <img
                    [ngSrc]="tenantLogoUrl()!"
                    width="20"
                    height="20"
                    class="tenant-badge-img"
                    alt=""
                  />
                } @else {
                  <span class="tenant-badge">{{ tenantInitial() }}</span>
                }
                <span class="tenant-display-name">{{ tenantName() }}</span>
                <i class="fa-solid fa-chevron-down chevron" aria-hidden="true"></i>
              </button>
              @if (tenantDropdownOpen()) {
                <div class="dropdown" role="listbox">
                  <button
                    type="button"
                    class="dropdown-item dropdown-item--footer"
                    (click)="onTenantSettingsClick()"
                  >
                    <i class="fa-solid fa-gear text-[10px]"></i> Tenant settings
                  </button>
                  <button
                    type="button"
                    class="dropdown-item dropdown-item--footer"
                    (click)="onJoinTenantClick()"
                  >
                    <i class="fa-solid fa-user-plus text-[10px]"></i> Join with code
                  </button>
                </div>
              }
            </div>
          }
        </div>

        <span class="breadcrumb-sep" aria-hidden="true">/</span>

        <!-- Space selector -->
        <div class="space-trigger">
          @if (hasSpace()) {
            <button
              class="space-pill"
              (click)="toggleSpaceDropdown()"
              [attr.aria-expanded]="spaceDropdownOpen()"
              aria-haspopup="listbox"
              aria-label="Switch space"
            >
              <span>{{ spaceName() }}</span>
              <span class="dropdown-chevron" aria-hidden="true">&#9662;</span>
            </button>
          } @else {
            <button
              class="space-pill muted"
              (click)="toggleSpaceDropdown()"
              [attr.aria-expanded]="spaceDropdownOpen()"
              aria-haspopup="listbox"
              aria-label="Select space"
            >
              <span>Select space</span>
              <span class="dropdown-chevron" aria-hidden="true">&#9662;</span>
            </button>
          }
          @if (spaceDropdownOpen()) {
            <div class="dropdown space-dropdown" role="listbox" aria-label="Spaces">
              @for (s of spaces(); track s.id) {
                <button
                  class="dropdown-item"
                  role="option"
                  [attr.aria-selected]="s.id === currentSpaceId()"
                  [class.active]="s.id === currentSpaceId()"
                  (click)="selectSpace(s.id)"
                >
                  {{ s.name }}
                </button>
              }
              <div class="dropdown-footer">
                <button
                  type="button"
                  class="dropdown-item dropdown-item--footer"
                  (click)="onSpaceSettingsClick()"
                >
                  <i class="fa-solid fa-gear text-[10px]"></i> Space settings
                </button>
                <button
                  type="button"
                  class="dropdown-item dropdown-item--footer"
                  (click)="onNewSpaceClick()"
                >
                  <i class="fa-solid fa-plus text-[10px]"></i> New space
                </button>
              </div>
            </div>
          }
        </div>

        <button
          type="button"
          class="palette-hint"
          pTooltip="Open command palette"
          tooltipPosition="bottom"
          aria-label="Open command palette"
          (click)="onPaletteHintClick()"
        >
          <kbd>{{ paletteShortcut() }}</kbd>
        </button>
      </div>

      <!-- Page-specific content (horizontal scroll on overflow, kept in its
           own container so .topbar itself can let dropdowns escape vertically) -->
      <div class="topbar-scroll">
        @switch (pageType()) {
          @case ('landscape') {
            <div class="topbar-divider" aria-hidden="true"></div>
            <span class="topbar-section-label">{{ sectionLabel() }}</span>
            <div class="topbar-divider" aria-hidden="true"></div>
            <div role="tablist" class="flex items-center">
              @for (tab of tabs(); track tab.value) {
                <div class="topbar-tab-wrap">
                  <button
                    role="tab"
                    [attr.aria-selected]="tab.active"
                    [class]="tab.active ? 'topbar-tab active' : 'topbar-tab'"
                    (click)="onTabClick(tab.value)"
                  >
                    @if (tab.icon) {
                      <i [class]="tab.icon + ' topbar-tab__icon'" aria-hidden="true"></i>
                    }
                    {{ tab.label }}
                  </button>
                  @if (tab.value === 'timeline' && timelineHintVisible()) {
                    <div
                      class="topbar-hint"
                      role="status"
                      aria-live="polite"
                      aria-label="Onboarding hint"
                    >
                      <p class="topbar-hint__copy">Your timeline is now under the Timeline tab.</p>
                      <button
                        type="button"
                        class="topbar-hint__dismiss"
                        (click)="onTimelineHintDismiss()"
                        aria-label="Dismiss"
                      >
                        Got it
                      </button>
                    </div>
                  }
                </div>
              }
            </div>
            @if (subTabs().length) {
              <div class="topbar-divider" aria-hidden="true"></div>
              <div role="tablist" class="flex items-center" aria-label="View dimension">
                @for (sub of subTabs(); track sub.value) {
                  <button
                    role="tab"
                    [attr.aria-selected]="sub.active"
                    [class]="sub.active ? 'topbar-subtab active' : 'topbar-subtab'"
                    (click)="onSubTabClick(sub.value)"
                  >
                    {{ sub.label }}
                  </button>
                }
              </div>
            }
          }
          @case ('list') {
            <div class="topbar-divider" aria-hidden="true"></div>
            @if (listIcon()) {
              <i [class]="listIcon() + ' topbar-list-icon'" aria-hidden="true"></i>
            }
            <span class="topbar-list-title">{{ listTitle() }}</span>
            @if (recordCount()) {
              <span class="topbar-record-count">{{ recordCount() }}</span>
            }
          }
          @case ('detail') {
            <div class="topbar-divider" aria-hidden="true"></div>
            <button
              class="topbar-back"
              (click)="onBackClick()"
              [attr.aria-label]="'Go back to ' + backLabel()"
            >
              <span aria-hidden="true">&larr;</span>
              <span>{{ backLabel() }}</span>
            </button>
            <div class="topbar-divider" aria-hidden="true"></div>
            <div class="flex flex-col justify-center">
              @if (entityContext()) {
                <span class="topbar-eyebrow">{{ entityContext() }}</span>
              }
              @if (entityTitle()) {
                <span class="topbar-detail-title">{{ entityTitle() }}</span>
              }
            </div>
          }
          @default {
            <!-- blank: no page-specific content -->
          }
        }
      </div>

      <!-- Right-side actions -->
      <div class="topbar-actions">
        @for (action of actionButtons(); track action.label) {
          <p-button
            [label]="action.label"
            [icon]="action.icon"
            [severity]="action.severity ?? null"
            [outlined]="action.outlined ?? false"
            [text]="action.text ?? false"
            size="small"
            (click)="action.callback()"
          />
        }
        <ng-content select="[topbar-actions]" />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
        /* Above the content area below so breadcrumb dropdowns stack on top
           rather than being covered by page content. */
        z-index: 30;
      }

      .topbar {
        display: flex;
        align-items: center;
        height: 42px;
        padding: 0 16px;
        background: white;
        border-bottom: 1px solid #e2e8f0;
        min-width: 0;
        /* No overflow here -- breadcrumb dropdowns must escape vertically.
           Horizontal overflow is handled by .topbar-scroll below. */
      }

      /* Tabs and section labels can be wider than the viewport on mobile.
         Scroll them inside this inner container so .topbar can stay
         overflow:visible and dropdowns are not clipped. */
      .topbar-scroll {
        display: flex;
        align-items: center;
        flex: 1 1 auto;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
      }
      .topbar-scroll::-webkit-scrollbar {
        height: 0;
      }

      @media (max-width: 767px) {
        .topbar {
          padding: 0 8px;
          gap: 4px;
        }
      }

      /* ---- Breadcrumb ---- */

      .breadcrumb {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .breadcrumb-sep {
        font-size: 11px;
        color: #cbd5e1;
        user-select: none;
      }

      /* Subtle ⌘K hint advertising the command palette. Click opens it.
         Hidden on small viewports where the keyboard isn't the primary
         input. */
      .palette-hint {
        margin-left: 8px;
        padding: 0;
        background: none;
        border: none;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
      }
      .palette-hint kbd {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 10px;
        color: #64748b;
        background: #f1f5f9;
        border: 1px solid #e2e8f0;
        border-radius: 3px;
        padding: 1px 5px;
        line-height: 1.4;
        transition: color 120ms ease-out, background 120ms ease-out;
      }
      .palette-hint:hover kbd {
        color: #0f172a;
        background: #e2e8f0;
      }
      .palette-hint:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
        border-radius: 4px;
      }
      @media (max-width: 767px) {
        .palette-hint {
          display: none;
        }
      }

      /* Tenant */

      .tenant-trigger {
        position: relative;
        display: flex;
        align-items: center;
      }

      .tenant-button {
        display: flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        padding: 2px 4px 2px 0;
        cursor: pointer;
        border-radius: 4px;
      }

      .tenant-button:hover {
        background: #f8fafc;
      }

      .tenant-button:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }

      .tenant-badge {
        width: 20px;
        height: 20px;
        border-radius: 4px;
        background: var(--brand-600);
        color: white;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        text-transform: uppercase;
        flex-shrink: 0;
      }

      .tenant-display-name {
        font-size: 11px;
        color: #64748b;
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .dropdown-chevron {
        font-size: 8px;
        color: #94a3b8;
        line-height: 1;
      }

      /* Space */

      .space-trigger {
        position: relative;
        display: flex;
        align-items: center;
      }

      .space-pill {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: #0f172a;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 5px;
        padding: 3px 8px;
        cursor: pointer;
        white-space: nowrap;
      }

      .space-pill:hover {
        background: #f1f5f9;
      }

      .space-pill:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }

      .space-pill.muted {
        color: #94a3b8;
        font-weight: 400;
      }

      /* Dropdowns */

      .dropdown {
        position: absolute;
        top: calc(100% + 4px);
        left: 0;
        min-width: 180px;
        background: white;
        border: 1px solid #e2e8f0;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
        z-index: 50;
        padding: 4px 0;
      }

      .dropdown-item {
        display: block;
        width: 100%;
        text-align: left;
        font-size: 12px;
        color: #475569;
        background: none;
        border: none;
        padding: 6px 12px;
        cursor: pointer;
        white-space: nowrap;
      }

      .dropdown-item:hover {
        background: #f8fafc;
      }

      .dropdown-item:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: -2px;
      }

      .dropdown-item.active {
        color: var(--brand-600);
        font-weight: 500;
      }

      /* ---- Page-specific ---- */

      .topbar-divider {
        width: 1px;
        height: 16px;
        background: #e2e8f0;
        margin: 0 12px;
        flex-shrink: 0;
      }

      .topbar-section-label {
        font-size: 12px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
      }

      .topbar-tab {
        font-size: 11px;
        padding: 11px 0;
        margin-right: 16px;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        color: #64748b;
        background: none;
        border-top: none;
        border-left: none;
        border-right: none;
        transition: color 120ms ease-out;
        white-space: nowrap;
        display: inline-flex;
        align-items: center;
        gap: 5px;
      }

      .topbar-tab__icon {
        font-size: 10px;
        opacity: 0.7;
      }

      .topbar-tab.active .topbar-tab__icon {
        opacity: 1;
      }

      .topbar-tab:hover {
        color: #0f172a;
      }

      .topbar-tab.active {
        color: var(--brand-600);
        font-weight: 500;
        border-bottom-color: var(--brand-600);
      }

      .topbar-tab:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }

      /* Onboarding tooltip pinned to a topbar tab. Renders below the tab,
         pointing up. Dismissed via the inline button or by clicking the
         tab itself. Aria-live so screen readers announce it once. */
      .topbar-tab-wrap {
        position: relative;
        display: inline-flex;
        align-items: center;
      }

      .topbar-hint {
        position: absolute;
        top: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%);
        z-index: 40;
        background: #0f172a;
        color: white;
        padding: 8px 10px 8px 12px;
        border-radius: 4px;
        box-shadow: 0 6px 18px -8px rgba(15, 23, 42, 0.4);
        display: flex;
        align-items: center;
        gap: 10px;
        white-space: nowrap;
      }

      .topbar-hint::before {
        content: '';
        position: absolute;
        top: -5px;
        left: 50%;
        transform: translateX(-50%) rotate(45deg);
        width: 10px;
        height: 10px;
        background: #0f172a;
      }

      .topbar-hint__copy {
        margin: 0;
        font-size: 11px;
        font-weight: 500;
        line-height: 1.4;
      }

      .topbar-hint__dismiss {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.04em;
        color: var(--brand-300, #5eead4);
        background: none;
        border: none;
        padding: 2px 4px;
        cursor: pointer;
        text-transform: uppercase;
      }

      .topbar-hint__dismiss:hover {
        color: white;
      }

      .topbar-hint__dismiss:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
        border-radius: 2px;
      }

      .topbar-subtab {
        font-size: 10px;
        padding: 3px 8px;
        cursor: pointer;
        border-radius: 4px;
        color: #64748b;
        background: none;
        border: 1px solid transparent;
        transition:
          color 120ms ease-out,
          background 120ms ease-out;
        white-space: nowrap;
        margin-right: 2px;
      }

      .topbar-subtab:hover {
        color: #0f172a;
        background: #f1f5f9;
      }

      .topbar-subtab.active {
        color: var(--brand-600);
        background: rgb(from var(--brand-600) r g b / 0.08);
        border-color: rgb(from var(--brand-600) r g b / 0.2);
        font-weight: 500;
      }

      .topbar-subtab:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }

      .topbar-list-icon {
        font-size: 11px;
        color: #94a3b8;
        margin-right: 6px;
      }

      .topbar-list-title {
        font-size: 13px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
      }

      .topbar-back {
        font-size: 11px;
        color: #94a3b8;
        cursor: pointer;
        background: none;
        border: none;
        padding: 0;
        display: flex;
        align-items: center;
        gap: 4px;
        white-space: nowrap;
        transition: color 120ms ease-out;
      }

      .topbar-back:hover {
        color: #64748b;
      }

      .topbar-back:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }

      .topbar-eyebrow {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #94a3b8;
        line-height: 1;
      }

      .topbar-detail-title {
        font-size: 12px;
        font-weight: 600;
        color: #0f172a;
        line-height: 1.4;
      }

      /* ---- Actions ---- */

      .topbar-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .topbar-record-count {
        font-size: 11px;
        color: #94a3b8;
        margin-left: 6px;
      }

      :host ::ng-deep .topbar-actions .p-button {
        font-size: 11px;
        padding: 4px 10px;
        height: 26px;
      }

      :host ::ng-deep .topbar-actions .p-button .p-button-icon {
        font-size: 11px;
      }

      /* ---- Dropdown footer ---- */

      .dropdown-footer {
        border-top: 1px solid #e2e8f0;
      }

      .dropdown-item--footer {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #64748b;
        font-size: 11px;
      }
      .dropdown-item--footer:hover {
        color: #0f172a;
      }

      .tenant-badge-img {
        width: 20px;
        height: 20px;
        border-radius: 5px;
        object-fit: cover;
        flex-shrink: 0;
      }

      /* Single-tenant switcher */

      .tenant-switcher {
        position: relative;
        display: flex;
        align-items: center;
      }

      .tenant-btn {
        display: flex;
        align-items: center;
        gap: 4px;
        background: none;
        border: none;
        padding: 2px 4px 2px 0;
        cursor: pointer;
        border-radius: 4px;
      }

      .tenant-btn:hover {
        background: #f8fafc;
      }

      .tenant-btn:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }

      .chevron {
        font-size: 8px;
        color: #94a3b8;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextualTopbarComponent {
  // ---- Tenant/Space inputs ----
  readonly tenantName = input<string>('');
  readonly tenantLogoUrl = input<string | null>(null);
  readonly tenants = input<{ id: string; name: string }[]>([]);
  readonly currentTenantId = input<string>('');
  readonly spaceName = input<string>('');
  readonly spaces = input<{ id: string; name: string }[]>([]);
  readonly currentSpaceId = input<string>('');
  readonly hasSpace = input<boolean>(false);

  // ---- Page type ----
  readonly pageType = input<'landscape' | 'list' | 'detail' | 'blank'>('blank');

  // ---- Tabbed section mode ----
  readonly sectionLabel = input<string>('');
  readonly tabs = input<TopbarTab[]>([]);
  readonly subTabs = input<TopbarTab[]>([]);

  // ---- List mode ----
  readonly listTitle = input<string>('');
  readonly recordCount = input<string>('');

  // ---- Detail mode ----
  readonly backLabel = input<string>('');
  readonly entityContext = input<string>('');
  readonly entityTitle = input<string>('');

  // ---- Actions ----
  readonly actionButtons = input<TopbarAction[]>([]);

  // ---- Onboarding tooltip pinned to Timeline tab ----
  readonly timelineHintVisible = input<boolean>(false);

  // ---- Outputs ----
  readonly tabClick = output<string>();
  readonly subTabClick = output<string>();
  readonly backClick = output<void>();
  readonly tenantChange = output<string>();
  readonly spaceChange = output<string>();
  readonly tenantSettingsClick = output<void>();
  readonly spaceSettingsClick = output<void>();
  readonly newSpaceClick = output<void>();
  readonly joinTenantClick = output<void>();
  readonly timelineHintDismiss = output<void>();

  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly paletteHotkey = inject(PaletteHotkeyService);

  readonly paletteShortcut = computed(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    return /Mac|iPhone|iPad/i.test(ua) ? '⌘K' : 'Ctrl K';
  });

  onPaletteHintClick(): void {
    this.paletteHotkey.open();
  }

  // ---- Internal state ----
  readonly tenantDropdownOpen = signal(false);
  readonly spaceDropdownOpen = signal(false);

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.tenantDropdownOpen() && !this.spaceDropdownOpen()) return;
    const target = event.target as Node;
    if (!this.host.nativeElement.contains(target)) {
      this.tenantDropdownOpen.set(false);
      this.spaceDropdownOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.tenantDropdownOpen() || this.spaceDropdownOpen()) {
      this.tenantDropdownOpen.set(false);
      this.spaceDropdownOpen.set(false);
    }
  }

  readonly tenantInitial = computed(() => {
    const name = this.tenantName();
    return name ? name.charAt(0).toUpperCase() : '';
  });

  readonly listIcon = computed(() => {
    const title = this.listTitle().toLowerCase().replace(/\s+/g, '-');
    return NAV_ICONS[title] ?? '';
  });

  // ---- Methods ----

  toggleTenantDropdown(): void {
    this.spaceDropdownOpen.set(false);
    this.tenantDropdownOpen.update((v) => !v);
  }

  toggleSpaceDropdown(): void {
    this.tenantDropdownOpen.set(false);
    this.spaceDropdownOpen.update((v) => !v);
  }

  selectTenant(id: string): void {
    this.tenantDropdownOpen.set(false);
    this.tenantChange.emit(id);
  }

  selectSpace(id: string): void {
    this.spaceDropdownOpen.set(false);
    this.spaceChange.emit(id);
  }

  onTabClick(value: string): void {
    if (value === 'timeline' && this.timelineHintVisible()) {
      this.timelineHintDismiss.emit();
    }
    this.tabClick.emit(value);
  }

  onTimelineHintDismiss(): void {
    this.timelineHintDismiss.emit();
  }

  onSubTabClick(value: string): void {
    this.subTabClick.emit(value);
  }

  onBackClick(): void {
    this.backClick.emit();
  }

  onTenantSettingsClick(): void {
    this.tenantDropdownOpen.set(false);
    this.tenantSettingsClick.emit();
  }

  onSpaceSettingsClick(): void {
    this.spaceDropdownOpen.set(false);
    this.spaceSettingsClick.emit();
  }

  onNewSpaceClick(): void {
    this.spaceDropdownOpen.set(false);
    this.newSpaceClick.emit();
  }

  onJoinTenantClick(): void {
    this.tenantDropdownOpen.set(false);
    this.joinTenantClick.emit();
  }
}
