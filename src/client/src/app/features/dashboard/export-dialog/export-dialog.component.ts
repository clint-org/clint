import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { SelectButton } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { ProgressSpinner } from 'primeng/progressspinner';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { PptxExportService } from '../../../core/services/pptx-export.service';

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [FormsModule, Dialog, SelectButton, ButtonModule, MessageModule, ProgressSpinner],
  template: `
    <p-dialog
      header="Export to PowerPoint"
      [(visible)]="visible"
      [modal]="true"
      styleClass="!w-[24rem]"
      (onHide)="closed.emit()"
    >
      <div class="flex flex-col gap-4">
        <div>
          <span
            class="mb-2 block text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500"
          >
            Zoom level
          </span>
          <p-selectbutton
            [options]="zoomOptions"
            [ngModel]="selectedZoom()"
            (ngModelChange)="selectedZoom.set($event)"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
          />
        </div>

        @if (exporting()) {
          <div class="flex items-center justify-center gap-2 py-2">
            <p-progressspinner
              strokeWidth="4"
              styleClass="w-[1.25rem] h-[1.25rem]"
              aria-label="Exporting to PowerPoint"
            />
            <span class="text-[11px] uppercase tracking-wider text-slate-400">
              Generating PowerPoint
            </span>
          </div>
        }

        @if (error()) {
          <p-message severity="error" [closable]="false">{{ error() }}</p-message>
        }
      </div>

      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          size="small"
          (onClick)="closed.emit()"
        />
        <p-button
          label="Export"
          icon="fa-solid fa-file-powerpoint"
          [outlined]="true"
          size="small"
          (onClick)="doExport()"
          [loading]="exporting()"
        />
      </ng-template>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportDialogComponent {
  private pptxService = inject(PptxExportService);

  readonly companies = input.required<Company[]>();
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();
  readonly open = input(false);
  readonly visible = signal(false);
  readonly closed = output<void>();

  constructor() {
    effect(() => this.visible.set(this.open()));
  }

  readonly exporting = signal(false);
  readonly error = signal<string | null>(null);
  readonly selectedZoom = signal<ZoomLevel>('yearly');

  readonly zoomOptions = [
    { label: 'Year', value: 'yearly' as ZoomLevel },
    { label: 'Quarter', value: 'quarterly' as ZoomLevel },
    { label: 'Month', value: 'monthly' as ZoomLevel },
    { label: 'Day', value: 'daily' as ZoomLevel },
  ];

  async doExport(): Promise<void> {
    this.exporting.set(true);
    this.error.set(null);

    try {
      await this.pptxService.exportDashboard(this.companies(), {
        zoomLevel: this.selectedZoom(),
        startYear: this.startYear(),
        endYear: this.endYear(),
      });
      this.visible.set(false);
      this.closed.emit();
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not generate PowerPoint file. Check your connection and try again.'
      );
    } finally {
      this.exporting.set(false);
    }
  }
}
