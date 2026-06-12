import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { Menu } from 'primeng/menu';
import type { MenuItem } from 'primeng/api';

export interface ExportAction {
  label: string;
  format: 'png' | 'pptx' | 'xlsx';
  run: () => Promise<void>;
}

/**
 * Shared export trigger. One action renders a direct button; two or more render
 * a menu. Owns loading (button disabled while a run() is in flight) and inline
 * error state. The host decides the format(s); this component is format-blind.
 */
@Component({
  selector: 'app-export-button',
  imports: [ButtonModule, Menu],
  template: `
    @if (actions().length === 1) {
      <p-button
        [label]="loading() ? 'Exporting…' : 'Export'"
        icon="fa-solid fa-file-arrow-down"
        severity="secondary"
        size="small"
        [text]="true"
        [loading]="loading()"
        [disabled]="loading()"
        (onClick)="runAction(actions()[0])"
        [attr.aria-label]="'Export ' + actions()[0].label"
      />
    } @else {
      <p-button
        [label]="loading() ? 'Exporting…' : 'Export'"
        icon="fa-solid fa-file-arrow-down"
        severity="secondary"
        size="small"
        [text]="true"
        [loading]="loading()"
        [disabled]="loading()"
        (onClick)="menu.toggle($event)"
        aria-haspopup="true"
        aria-label="Export options"
      />
      <p-menu #menu [model]="menuItems()" [popup]="true" appendTo="body" />
    }
    @if (error(); as e) {
      <span class="ml-2 text-[11px] text-red-600" role="alert">{{ e }}</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportButtonComponent {
  readonly actions = input.required<ExportAction[]>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  protected readonly menuItems = computed<MenuItem[]>(() =>
    this.actions().map((a) => ({
      label: a.label,
      command: () => void this.runAction(a),
    })),
  );

  async runAction(action: ExportAction): Promise<void> {
    if (this.loading()) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await action.run();
    } catch {
      this.error.set('Export failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
