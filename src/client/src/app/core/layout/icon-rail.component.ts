import { Component, computed, input, output } from '@angular/core';
import { Tooltip } from 'primeng/tooltip';
import { NAV_ICONS } from '../../shared/constants/nav-icons';

type Section = 'landscape' | 'intelligence' | 'manage' | 'settings';

interface NavSection {
  id: Section;
  label: string;
}

@Component({
  selector: 'app-icon-rail',
  standalone: true,
  imports: [Tooltip],
  template: `
    <div
      class="rail-inner"
      role="navigation"
      aria-label="Main navigation"
      (mouseenter)="hoverStart.emit()"
      (mouseleave)="hoverEnd.emit()"
    >
      <!-- App logo -->
      <button
        type="button"
        class="logo-btn"
        aria-label="Go to home"
        (click)="logoClick.emit()"
        (keydown.enter)="logoClick.emit()"
        (keydown.space)="logoClick.emit()"
      >
        <div class="logo-square">C</div>
      </button>

      <!-- Section icons -->
      <div class="section-icons">
        @for (section of sections(); track section.id) {
          <button
            type="button"
            role="button"
            class="icon-btn"
            [class.icon-btn--active]="activeSection() === section.id"
            [tabindex]="0"
            [attr.aria-label]="section.label"
            [attr.aria-current]="activeSection() === section.id ? 'true' : null"
            [pTooltip]="section.label"
            tooltipPosition="right"
            (click)="sectionClick.emit(section.id)"
            (keydown.enter)="sectionClick.emit(section.id)"
            (keydown.space)="$event.preventDefault(); sectionClick.emit(section.id)"
          >
            @if (activeSection() === section.id) {
              <span class="active-indicator" aria-hidden="true"></span>
            }

            <i
              [class]="sectionIcon(section.id)"
              [style.color]="iconColor(section.id)"
              aria-hidden="true"
            ></i>
          </button>
        }
      </div>

      <!-- User avatar -->
      <button
        type="button"
        class="avatar-btn"
        [attr.aria-label]="'User account: ' + userInitials()"
        (click)="avatarClick.emit()"
        (keydown.enter)="avatarClick.emit()"
        (keydown.space)="$event.preventDefault(); avatarClick.emit()"
      >
        {{ userInitials() }}
      </button>
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 48px;
        min-width: 48px;
        background: #0f172a;
        padding: 12px 0;
        height: 100%;
        z-index: 50;
      }

      .rail-inner {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        height: 100%;
      }

      .logo-btn {
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
        margin-bottom: 16px;
        transition: opacity 150ms ease;
        outline: none;
      }

      .logo-btn:hover {
        opacity: 0.85;
      }

      .logo-btn:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }

      .logo-square {
        width: 28px;
        height: 28px;
        background: var(--brand-600);
        border-radius: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-size: 14px;
        font-weight: 700;
        letter-spacing: -0.02em;
        line-height: 1;
        user-select: none;
      }

      .section-icons {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 4px;
        flex: 1;
      }

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
        font-size: 14px;
        transition:
          background-color 150ms ease,
          color 150ms ease;
        outline: none;
      }

      .icon-btn:hover {
        background: #1e293b;
      }

      .icon-btn--active {
        background: rgb(from var(--brand-600) r g b / 0.15);
      }

      .icon-btn:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }

      .active-indicator {
        position: absolute;
        left: -6px;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 18px;
        background: var(--brand-600);
        border-radius: 0 2px 2px 0;
      }

      .avatar-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: rgb(from var(--brand-600) r g b / 0.15);
        border: 1.5px solid rgb(from var(--brand-600) r g b / 0.4);
        border-radius: 50%;
        color: var(--brand-600);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        padding: 0;
        margin-top: 12px;
        transition:
          background-color 150ms ease,
          border-color 150ms ease;
        outline: none;
        user-select: none;
      }

      .avatar-btn:hover {
        background: rgb(from var(--brand-600) r g b / 0.25);
        border-color: rgb(from var(--brand-600) r g b / 0.7);
      }

      .avatar-btn:focus-visible {
        outline: 2px solid var(--brand-600);
        outline-offset: 2px;
      }
    `,
  ],
})
export class IconRailComponent {
  readonly activeSection = input<Section>('landscape');
  readonly userInitials = input<string>('');
  readonly hasSpace = input<boolean>(false);

  readonly sectionClick = output<Section>();
  readonly logoClick = output<void>();
  readonly avatarClick = output<void>();
  readonly hoverStart = output<void>();
  readonly hoverEnd = output<void>();

  readonly allSections: NavSection[] = [
    { id: 'landscape', label: 'Landscape' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'manage', label: 'Manage' },
    { id: 'settings', label: 'Settings' },
  ];

  readonly sections = computed(() =>
    this.hasSpace() ? this.allSections : this.allSections.filter((s) => s.id === 'settings')
  );

  sectionIcon(sectionId: Section): string {
    return NAV_ICONS[sectionId] ?? '';
  }

  iconColor(sectionId: Section): string {
    return this.activeSection() === sectionId ? 'var(--brand-600)' : '#64748b';
  }
}
