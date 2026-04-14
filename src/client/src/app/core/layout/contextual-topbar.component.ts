import { Component, input, output } from '@angular/core';

export interface TopbarTab {
  label: string;
  value: string;
  active: boolean;
}

@Component({
  selector: 'app-contextual-topbar',
  standalone: true,
  imports: [],
  template: `
    <div class="topbar" role="banner">
      @switch (pageType()) {
        @case ('landscape') {
          <span class="topbar-section-label">Landscape</span>
          <div class="topbar-divider" aria-hidden="true"></div>
          <div role="tablist" class="flex items-center">
            @for (tab of tabs(); track tab.value) {
              <button
                role="tab"
                [attr.aria-selected]="tab.active"
                [class]="tab.active ? 'topbar-tab active' : 'topbar-tab'"
                (click)="onTabClick(tab.value)"
              >
                {{ tab.label }}
              </button>
            }
          </div>
        }
        @case ('list') {
          <div class="flex flex-col justify-center">
            @if (eyebrow()) {
              <span class="topbar-eyebrow">{{ eyebrow() }}</span>
            }
            @if (title()) {
              <span class="topbar-title">{{ title() }}</span>
            }
          </div>
        }
        @case ('detail') {
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
              <span class="topbar-title">{{ entityTitle() }}</span>
            }
          </div>
        }
        @default {
          <!-- blank: bar with border only -->
        }
      }

      <div class="topbar-actions">
        @if (pageType() === 'list' && recordCount()) {
          <span class="topbar-record-count">{{ recordCount() }}</span>
        }
        <ng-content select="[topbar-actions]"></ng-content>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .topbar {
        display: flex;
        align-items: center;
        height: 42px;
        padding: 0 16px;
        background: white;
        border-bottom: 1px solid #e2e8f0;
      }

      .topbar-section-label {
        font-size: 12px;
        font-weight: 600;
        color: #0f172a;
        white-space: nowrap;
      }

      .topbar-divider {
        width: 1px;
        height: 16px;
        background: #e2e8f0;
        margin: 0 16px;
        flex-shrink: 0;
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
      }

      .topbar-tab:hover {
        color: #0f172a;
      }

      .topbar-tab.active {
        color: #0d9488;
        font-weight: 500;
        border-bottom-color: #0d9488;
      }

      .topbar-tab:focus-visible {
        outline: 2px solid #0d9488;
        outline-offset: 2px;
      }

      .topbar-eyebrow {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 1px;
        color: #94a3b8;
        line-height: 1;
      }

      .topbar-title {
        font-size: 13px;
        font-weight: 600;
        color: #0f172a;
        line-height: 1.4;
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
        outline: 2px solid #0d9488;
        outline-offset: 2px;
      }

      .topbar-actions {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .topbar-record-count {
        font-size: 11px;
        color: #94a3b8;
      }
    `,
  ],
})
export class ContextualTopbarComponent {
  // Page type selector
  readonly pageType = input<'landscape' | 'list' | 'detail' | 'blank'>('blank');

  // Landscape mode
  readonly tabs = input<TopbarTab[]>([]);

  // List mode
  readonly eyebrow = input<string>('');
  readonly title = input<string>('');
  readonly recordCount = input<string>('');

  // Detail mode
  readonly backLabel = input<string>('');
  readonly entityContext = input<string>('');
  readonly entityTitle = input<string>('');

  // Outputs
  readonly tabClick = output<string>();
  readonly backClick = output<void>();

  onTabClick(value: string): void {
    this.tabClick.emit(value);
  }

  onBackClick(): void {
    this.backClick.emit();
  }
}
