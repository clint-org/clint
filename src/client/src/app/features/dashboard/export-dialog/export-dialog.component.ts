import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injector,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { SelectButton } from 'primeng/selectbutton';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { PptxExportService } from '../../../core/services/pptx-export.service';
import { TenantService } from '../../../core/services/tenant.service';
import { PngExportService, type PngExportSnapshot } from '../export/png-export.service';

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [FormsModule, Dialog, SelectButton, ButtonModule, MessageModule, LoaderComponent],
  template: `
    <p-dialog
      [header]="headerLabel()"
      [(visible)]="visible"
      [modal]="true"
      styleClass="!w-[24rem]"
      (onHide)="closed.emit()"
    >
      <div class="flex flex-col gap-4">
        @if (showsPptxOptions()) {
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
        } @else {
          <p class="text-xs leading-5 text-slate-500">
            The image matches the timeline exactly as shown on screen, at full extent.
          </p>
        }

        @if (exporting()) {
          <div class="flex items-center justify-center py-2">
            <app-loader [size]="20" [label]="generatingLabel()" />
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
          [disabled]="exporting()"
        />
      </ng-template>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportDialogComponent {
  private pptxService = inject(PptxExportService);
  private pngService = inject(PngExportService);
  /**
   * Handed to PngExportService so the off-screen grid resolves the same
   * LandscapeStateService instance (providedIn: 'any') as the live view.
   */
  private readonly injector = inject(Injector);
  private readonly tenantService = inject(TenantService);

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

  /** Live grid state, forwarded untouched into the PNG snapshot (capture as-is). */
  readonly liveZoomLevel = input<ZoomLevel>('yearly');
  readonly spaceId = input('');
  readonly tenantId = input('');
  readonly hideCompanyColumn = input(false);
  readonly hideAssetColumn = input(false);
  readonly hideTrialColumn = input(false);
  readonly hideMoaColumn = input(false);
  readonly hideRoaColumn = input(false);
  readonly hideNotesColumn = input(false);

  readonly showsPptxOptions = computed(() => this.format() === 'pptx');

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
      // Resolve the workspace tenant for the export footer's "Prepared for"
      // segment. Failure degrades the footer to two parties; never block export.
      let tenant: { name: string; logoUrl: string | null } | null = null;
      if (this.tenantId()) {
        try {
          const t = await this.tenantService.getTenant(this.tenantId());
          tenant = { name: t.name, logoUrl: t.logo_url ?? null };
        } catch {
          tenant = null;
        }
      }

      if (this.format() === 'png') {
        const snapshot: PngExportSnapshot = {
          companies: this.companies(),
          zoomLevel: this.liveZoomLevel(),
          startYear: this.startYear(),
          endYear: this.endYear(),
          hideCompanyColumn: this.hideCompanyColumn(),
          hideAssetColumn: this.hideAssetColumn(),
          hideTrialColumn: this.hideTrialColumn(),
          hideMoaColumn: this.hideMoaColumn(),
          hideRoaColumn: this.hideRoaColumn(),
          hideNotesColumn: this.hideNotesColumn(),
          spaceId: this.spaceId(),
          tenantName: tenant?.name ?? '',
          tenantLogoUrl: tenant?.logoUrl ?? null,
        };
        await this.pngService.exportDashboard(snapshot, this.injector);
      } else {
        await this.pptxService.exportDashboard(this.companies(), {
          zoomLevel: this.selectedZoom(),
          startYear: this.startYear(),
          endYear: this.endYear(),
          showMoaColumn: this.showMoaColumn(),
          showRoaColumn: this.showRoaColumn(),
          showNotesColumn: this.showNotesColumn(),
          tenant,
        });
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
