import { Component, effect, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { SelectButton } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { ProgressSpinner } from 'primeng/progressspinner';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { PptxExportService } from '../../../core/services/pptx-export.service';

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [FormsModule, Dialog, SelectButton, ButtonModule, ProgressSpinner],
  template: `
    <p-dialog
      header="Export to PowerPoint"
      [(visible)]="visible"
      [modal]="true"
      [style]="{ width: '24rem' }"
      (onHide)="closed.emit()"
    >
      <div class="flex flex-col gap-4">
        <div>
          <span class="block text-sm font-medium text-slate-700 mb-2">Zoom Level</span>
          <p-selectbutton
            [options]="zoomOptions"
            [(ngModel)]="selectedZoom"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
          />
        </div>

        @if (exporting()) {
          <div class="flex items-center justify-center gap-2 py-2">
            <p-progressspinner strokeWidth="4" [style]="{ width: '1.5rem', height: '1.5rem' }" />
            <span class="text-sm text-slate-500">Generating PowerPoint...</span>
          </div>
        }

        @if (error()) {
          <p class="text-sm text-red-600">{{ error() }}</p>
        }
      </div>

      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="closed.emit()" />
        <p-button
          label="Export"
          icon="fa-solid fa-file-powerpoint"
          (onClick)="doExport()"
          [loading]="exporting()"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class ExportDialogComponent {
  private pptxService = inject(PptxExportService);

  companies = input.required<Company[]>();
  startYear = input.required<number>();
  endYear = input.required<number>();
  open = input(false);
  visible = signal(false);
  closed = output<void>();

  constructor() {
    effect(() => this.visible.set(this.open()));
  }

  exporting = signal(false);
  error = signal<string | null>(null);
  selectedZoom: ZoomLevel = 'yearly';

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
        zoomLevel: this.selectedZoom,
        startYear: this.startYear(),
        endYear: this.endYear(),
      });
      this.visible.set(false);
      this.closed.emit();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Export failed');
    } finally {
      this.exporting.set(false);
    }
  }
}
