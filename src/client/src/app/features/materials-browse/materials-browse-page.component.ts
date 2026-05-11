import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  MATERIAL_TYPE_LABEL,
  Material,
  MaterialEntityType,
  MaterialType,
} from '../../core/models/material.model';
import { MaterialService } from '../../core/services/material.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { MaterialRowComponent } from '../../shared/components/material-row/material-row.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { errorMessage } from '../../core/utils/error-message';

type MaterialFilter = MaterialType | 'all';
type EntityFilter = MaterialEntityType | 'all';

/**
 * Cross-cutting "All materials" page at /t/:tenant/s/:space/materials.
 * Recency-ordered, filterable by type and entity type. Each row has
 * inline download + delete.
 */
@Component({
  selector: 'app-materials-browse-page',
  standalone: true,
  imports: [FormsModule, ButtonModule, ManagePageShellComponent, MaterialRowComponent],
  template: `
    <app-manage-page-shell>
      <div
        class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50/50 px-4 py-2"
      >
        <span
          class="font-mono text-[10px] uppercase tracking-wider text-slate-500"
          aria-hidden="true"
        >
          Type
        </span>
        @for (chip of typeFilters; track chip.value) {
          <button
            type="button"
            class="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors focus:outline-none focus:ring-1 focus:ring-brand-500"
            [class.border-brand-300]="typeFilter() === chip.value"
            [class.bg-brand-50]="typeFilter() === chip.value"
            [class.text-brand-700]="typeFilter() === chip.value"
            [class.border-slate-200]="typeFilter() !== chip.value"
            [class.bg-white]="typeFilter() !== chip.value"
            [class.text-slate-500]="typeFilter() !== chip.value"
            [attr.aria-pressed]="typeFilter() === chip.value"
            (click)="setTypeFilter(chip.value)"
          >
            {{ chip.label }}
          </button>
        }
        <span class="ml-3 font-mono text-[10px] uppercase tracking-wider text-slate-500">
          Entity
        </span>
        @for (chip of entityFilters; track chip.value) {
          <button
            type="button"
            class="rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition-colors focus:outline-none focus:ring-1 focus:ring-brand-500"
            [class.border-brand-300]="entityFilter() === chip.value"
            [class.bg-brand-50]="entityFilter() === chip.value"
            [class.text-brand-700]="entityFilter() === chip.value"
            [class.border-slate-200]="entityFilter() !== chip.value"
            [class.bg-white]="entityFilter() !== chip.value"
            [class.text-slate-500]="entityFilter() !== chip.value"
            [attr.aria-pressed]="entityFilter() === chip.value"
            (click)="setEntityFilter(chip.value)"
          >
            {{ chip.label }}
          </button>
        }
        <span class="ml-auto font-mono text-[10px] tabular-nums text-slate-400">
          {{ rows().length }} {{ rows().length === 1 ? 'material' : 'materials' }}
        </span>
      </div>

      <div class="border border-t-0 border-slate-200 bg-white" aria-live="polite">
        @if (loading()) {
          <p class="px-4 py-4 text-xs text-slate-400">Loading materials...</p>
        } @else if (error()) {
          <p class="px-4 py-4 text-xs text-red-600">{{ error() }}</p>
        } @else if (rows().length === 0) {
          <p class="px-4 py-4 text-xs text-slate-400">No materials match the current filters.</p>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (material of rows(); track material.id) {
              <li>
                <app-material-row
                  [material]="material"
                  [showLinks]="true"
                  (downloadClick)="onDownloadClick($event)"
                  (deleteClick)="onDeleteClick($event)"
                />
              </li>
            }
          </ul>
        }
      </div>
    </app-manage-page-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialsBrowsePageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly materialService = inject(MaterialService);
  private readonly topbarState = inject(TopbarStateService);
  private readonly messageService = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly spaceId = signal('');
  protected readonly typeFilter = signal<MaterialFilter>('all');
  protected readonly entityFilter = signal<EntityFilter>('all');

  protected readonly rows = signal<Material[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly typeFilters: { label: string; value: MaterialFilter }[] = [
    { label: 'All', value: 'all' },
    { label: MATERIAL_TYPE_LABEL.briefing, value: 'briefing' },
    { label: MATERIAL_TYPE_LABEL.conference_report, value: 'conference_report' },
    { label: MATERIAL_TYPE_LABEL.priority_notice, value: 'priority_notice' },
    { label: MATERIAL_TYPE_LABEL.ad_hoc, value: 'ad_hoc' },
  ];

  protected readonly entityFilters: { label: string; value: EntityFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Trial', value: 'trial' },
    { label: 'Marker', value: 'marker' },
    { label: 'Company', value: 'company' },
    { label: 'Asset', value: 'product' },
    { label: 'Engagement', value: 'space' },
  ];

  // Reload when any filter changes.
  private readonly reloadEffect = effect(() => {
    const sid = this.spaceId();
    if (!sid) return;
    const t = this.typeFilter();
    const e = this.entityFilter();
    void this.load(sid, t, e);
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('spaceId') ?? '';
    this.spaceId.set(id);
    this.topbarState.entityTitle.set('All materials');
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  private async load(
    spaceId: string,
    typeFilter: MaterialFilter,
    entityFilter: EntityFilter
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.materialService.listForSpace({
        spaceId,
        materialTypes: typeFilter === 'all' ? null : [typeFilter],
        entityType: entityFilter === 'all' ? null : entityFilter,
      });
      this.rows.set(result.rows ?? []);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected setTypeFilter(next: MaterialFilter): void {
    this.typeFilter.set(next);
  }

  protected setEntityFilter(next: EntityFilter): void {
    this.entityFilter.set(next);
  }

  protected async onDownloadClick(material: Material): Promise<void> {
    try {
      const { url } = await this.materialService.getDownloadUrl(material.id);
      const a = document.createElement('a');
      a.href = url;
      a.download = material.file_name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not download material',
        detail: errorMessage(e),
        life: 4000,
      });
    }
  }

  protected async onDeleteClick(material: Material): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete material',
      message:
        `Delete "${material.title}"? The file and all of its links will be ` +
        `permanently removed. This cannot be undone.`,
    });
    if (!ok) return;

    try {
      await this.materialService.delete(material.id);
      this.messageService.add({
        severity: 'success',
        summary: 'Material deleted.',
        life: 3000,
      });
      const sid = this.spaceId();
      if (sid) await this.load(sid, this.typeFilter(), this.entityFilter());
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not delete material',
        detail: errorMessage(e),
        life: 4000,
      });
    }
  }
}
