import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { SectionHeaderComponent } from '../../shared/components/section-header/section-header.component';
import { LoaderComponent } from '../../shared/components/loader/loader.component';
import { MaterialRowComponent } from '../../shared/components/material-row/material-row.component';
import { MaterialUploadZoneComponent } from '../../shared/components/material-upload-zone/material-upload-zone.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../core/services/space-role.service';
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
  imports: [
    FormsModule,
    ButtonModule,
    ManagePageShellComponent,
    SectionHeaderComponent,
    MaterialRowComponent,
    MaterialUploadZoneComponent,
    LoaderComponent,
  ],
  template: `
    <app-manage-page-shell>
      <div class="border-b border-slate-200 bg-slate-50/60 px-5 py-3">
        <app-section-header
          label="Materials"
          [detail]="rows().length.toString()"
          [bordered]="false"
          class="mb-2.5 block"
        >
          @if (canUpload()) {
            <p-button
              actions
              label="Upload material"
              icon="fa-solid fa-cloud-arrow-up"
              size="small"
              [outlined]="registerOpen()"
              (onClick)="toggleRegister()"
            />
          }
        </app-section-header>
        <div class="flex flex-wrap items-center gap-1.5">
          <span
            class="mr-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400"
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
          <span class="mx-1.5 h-4 w-px bg-slate-200" aria-hidden="true"></span>
          <span
            class="mr-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400"
          >
            Linked to
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
        </div>
      </div>

      <!--
        Page-level register flow. Materials are entity-scoped, so we reuse the
        per-entity upload zone in its space scope: the embedded linked-entities
        picker (inside the zone's dialog) lets the user attach the file to a
        trial / asset / company / marker. No parallel upload path, no
        duplicated form.
      -->
      @if (canUpload() && registerOpen()) {
        <div class="border border-t-0 border-slate-200 bg-slate-50/40 px-4 py-3">
          <p class="mb-2 text-[11px] text-slate-500">
            Drop or browse a file, then attach it to the trials, assets, companies, or markers it
            covers.
          </p>
          <app-material-upload-zone
            entityType="space"
            [entityId]="spaceId()"
            [spaceId]="spaceId()"
            (uploaded)="onRegistered()"
          />
        </div>
      }

      <div class="border border-t-0 border-slate-200 bg-white" aria-live="polite">
        @if (loading()) {
          <app-loader class="px-4 py-4" [size]="20" label="Loading materials" />
        } @else if (error()) {
          <p class="px-4 py-4 text-xs text-red-600">{{ error() }}</p>
        } @else if (rows().length === 0) {
          <p class="px-4 py-4 text-xs text-slate-400">
            @if (isFiltered()) {
              No materials match the current filters.
            } @else if (canUpload()) {
              No materials in this space yet. Register a briefing, conference report, or priority
              notice and attach it to a trial, asset, company, or marker.
            } @else {
              No materials in this space yet. An owner or editor can register them.
            }
          </p>
        } @else {
          <ul class="flex flex-col gap-2.5 px-4 py-3">
            @for (material of rows(); track material.id) {
              <li>
                <app-material-row
                  [material]="material"
                  [showLinks]="true"
                  [tenantId]="tenantId()"
                  [spaceId]="spaceId()"
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
  private readonly spaceRole = inject(SpaceRoleService);

  protected readonly spaceId = signal('');
  protected readonly tenantId = signal('');
  protected readonly typeFilter = signal<MaterialFilter>('all');
  protected readonly entityFilter = signal<EntityFilter>('all');

  protected readonly rows = signal<Material[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /** Owners and editors register materials; mirrors the per-entity gate. */
  protected readonly canUpload = computed(() => this.spaceRole.canEdit());
  protected readonly isFiltered = computed(
    () => this.typeFilter() !== 'all' || this.entityFilter() !== 'all'
  );
  protected readonly registerOpen = signal(false);

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
    { label: 'Space', value: 'space' },
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
    this.tenantId.set(this.findRouteParam('tenantId'));
    this.topbarState.entityTitle.set('All materials');
  }

  /** Walk the route ancestry for a parameter (tenant id lives on a parent). */
  private findRouteParam(name: string): string {
    let snap = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(name);
      if (v) return v;
      if (!snap.parent) break;
      snap = snap.parent;
    }
    return '';
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

  protected toggleRegister(): void {
    this.registerOpen.update((open) => !open);
  }

  protected async onRegistered(): Promise<void> {
    this.registerOpen.set(false);
    const sid = this.spaceId();
    if (sid) await this.load(sid, this.typeFilter(), this.entityFilter());
  }

  protected async onDownloadClick(material: Material): Promise<void> {
    if (material.is_sample) {
      this.messageService.add({
        severity: 'info',
        summary: 'Sample material',
        detail: 'This is a sample. No file is attached to download.',
      });
      return;
    }
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
    // Material has a name (title) we can use as the typed value. No preview
    // RPC: the R2 delete-queue + material_links cascade handle cleanup.
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete material',
      entityLabel: material.title,
      message:
        `Delete "${material.title}"? The file and all of its links will be ` +
        `permanently removed.`,
      requireTypedConfirmation: true,
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
