import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { PngExportService } from '../../../core/services/png-export.service';

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [FormsModule, Dialog, SelectButton, ButtonModule, MessageModule, ProgressSpinner],
  template: `
    <p-dialog
      [header]="headerLabel()"
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
              [attr.aria-label]="generatingLabel()"
            />
            <span class="text-[11px] uppercase tracking-wider text-slate-400">
              {{ generatingLabel() }}
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
          [icon]="exportIcon()"
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
  private pngService = inject(PngExportService);

  /** Which renderer this dialog drives. Excel bypasses the dialog entirely. */
  readonly format = input<'pptx' | 'png'>('pptx');

  protected readonly headerLabel = computed(() =>
    this.format() === 'png' ? 'Export image' : 'Export to PowerPoint'
  );
  protected readonly generatingLabel = computed(() =>
    this.format() === 'png' ? 'Generating image' : 'Generating PowerPoint'
  );
  protected readonly exportIcon = computed(() =>
    this.format() === 'png' ? 'fa-solid fa-image' : 'fa-solid fa-file-powerpoint'
  );

  readonly companies = input.required<Company[]>();
  readonly startYear = input.required<number>();
  readonly endYear = input.required<number>();
  readonly showMoaColumn = input(true);
  readonly showRoaColumn = input(true);
  readonly showNotesColumn = input(true);
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

    const options = {
      zoomLevel: this.selectedZoom(),
      startYear: this.startYear(),
      endYear: this.endYear(),
      showMoaColumn: this.showMoaColumn(),
      showRoaColumn: this.showRoaColumn(),
      showNotesColumn: this.showNotesColumn(),
    };

    try {
      if (this.format() === 'png') {
        await this.pngService.exportDashboard(this.companies(), options);
      } else {
        await this.pptxService.exportDashboard(this.companies(), options);
      }
      this.visible.set(false);
      this.closed.emit();
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not generate the export. Check your connection and try again.'
      );
    } finally {
      this.exporting.set(false);
    }
  }
}
