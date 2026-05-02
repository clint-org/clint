import { Component, computed, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { MultiSelectModule } from 'primeng/multiselect';
import { Select } from 'primeng/select';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  MATERIAL_ENTITY_LABEL,
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
import {
  BrowseFilterBarComponent,
  BrowseFilterChip,
} from '../../shared/components/browse-filter-bar/browse-filter-bar.component';

const TYPE_OPTIONS: { label: string; value: MaterialType }[] = [
  { label: MATERIAL_TYPE_LABEL.briefing, value: 'briefing' },
  { label: MATERIAL_TYPE_LABEL.conference_report, value: 'conference_report' },
  { label: MATERIAL_TYPE_LABEL.priority_notice, value: 'priority_notice' },
  { label: MATERIAL_TYPE_LABEL.ad_hoc, value: 'ad_hoc' },
];

const ENTITY_OPTIONS: { label: string; value: MaterialEntityType }[] = [
  { label: MATERIAL_ENTITY_LABEL.trial, value: 'trial' },
  { label: MATERIAL_ENTITY_LABEL.marker, value: 'marker' },
  { label: MATERIAL_ENTITY_LABEL.company, value: 'company' },
  { label: MATERIAL_ENTITY_LABEL.product, value: 'product' },
  { label: MATERIAL_ENTITY_LABEL.space, value: 'space' },
];

/**
 * Cross-cutting "All materials" page at /t/:tenant/s/:space/materials.
 * Recency-ordered, filterable by type (multi), entity (single), and a
 * client-side title search. Each row has inline download + delete.
 */
@Component({
  selector: 'app-materials-browse-page',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    MultiSelectModule,
    Select,
    ManagePageShellComponent,
    MaterialRowComponent,
    BrowseFilterBarComponent,
  ],
  template: `
    <app-manage-page-shell>
      <app-browse-filter-bar
        ariaLabel="Materials filters"
        [chips]="activeChips()"
        [hasActive]="hasAnyActive()"
        [resultLabel]="resultLabel()"
        (chipRemove)="onChipRemove($event)"
        (clearAll)="onClearAll()"
      >
        <input
          pInputText
          type="search"
          [ngModel]="query()"
          (ngModelChange)="query.set($event)"
          placeholder="Search title"
          aria-label="Search title"
          class="!h-8 w-56"
        />
        <p-multiSelect
          [options]="typeOptions"
          [ngModel]="materialTypes()"
          (ngModelChange)="materialTypes.set($event ?? [])"
          optionLabel="label"
          optionValue="value"
          placeholder="Type"
          ariaLabel="Filter by material type"
          [showClear]="true"
          appendTo="body"
          [styleClass]="'w-fit' + (materialTypes().length ? ' has-value' : '')"
          size="small"
          [maxSelectedLabels]="0"
          [selectedItemsLabel]="'Type (' + materialTypes().length + ')'"
        />
        <p-select
          [options]="entityOptions"
          [ngModel]="entityType()"
          (ngModelChange)="entityType.set($event)"
          optionLabel="label"
          optionValue="value"
          placeholder="Any entity"
          ariaLabel="Filter by entity type"
          [showClear]="true"
          appendTo="body"
          [styleClass]="'w-fit' + (entityType() ? ' has-value' : '')"
          size="small"
        />
      </app-browse-filter-bar>

      <div class="border-x border-b border-slate-200 bg-white" aria-live="polite">
        @if (loading()) {
          <p class="px-4 py-4 text-xs text-slate-400">Loading materials...</p>
        } @else if (error()) {
          <p class="px-4 py-4 text-xs text-red-600">{{ error() }}</p>
        } @else if (visibleRows().length === 0) {
          <p class="px-4 py-4 text-xs text-slate-400">No materials match the current filters.</p>
        } @else {
          <ul class="divide-y divide-slate-100">
            @for (material of visibleRows(); track material.id) {
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
})
export class MaterialsBrowsePageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly materialService = inject(MaterialService);
  private readonly topbarState = inject(TopbarStateService);
  private readonly messageService = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  protected readonly typeOptions = TYPE_OPTIONS;
  protected readonly entityOptions = ENTITY_OPTIONS;

  protected readonly spaceId = signal('');
  protected readonly materialTypes = signal<MaterialType[]>([]);
  protected readonly entityType = signal<MaterialEntityType | null>(null);
  protected readonly query = signal<string>('');

  protected readonly rows = signal<Material[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /**
   * Title search runs client-side; type / entity are server-filtered (the
   * RPC re-runs on those changes). visibleRows() reapplies the title
   * filter on top of whatever the server returned.
   */
  protected readonly visibleRows = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.rows();
    return this.rows().filter((m) => (m.title ?? '').toLowerCase().includes(q));
  });

  protected readonly resultLabel = computed(() => {
    const n = this.visibleRows().length;
    return n === 1 ? '1 material' : `${n} materials`;
  });

  protected readonly hasAnyActive = computed(() => {
    return (
      this.materialTypes().length > 0 ||
      this.entityType() !== null ||
      this.query().trim().length > 0
    );
  });

  protected readonly activeChips = computed<BrowseFilterChip[]>(() => {
    const chips: BrowseFilterChip[] = [];
    const q = this.query().trim();
    if (q) chips.push({ field: 'query', header: 'Search', value: q, id: 'query' });
    const typeLabels = new Map(TYPE_OPTIONS.map((o) => [o.value, o.label]));
    for (const t of this.materialTypes()) {
      chips.push({
        field: 'materialTypes',
        header: 'Type',
        value: typeLabels.get(t) ?? t,
        id: t,
      });
    }
    const entity = this.entityType();
    if (entity) {
      chips.push({
        field: 'entityType',
        header: 'Entity',
        value: MATERIAL_ENTITY_LABEL[entity] ?? entity,
        id: entity,
      });
    }
    return chips;
  });

  // Reload from the server when type or entity filters change. The query
  // signal is intentionally not in this dependency set -- title search is
  // applied client-side via visibleRows().
  private readonly reloadEffect = effect(() => {
    const sid = this.spaceId();
    if (!sid) return;
    const types = this.materialTypes();
    const entity = this.entityType();
    void this.load(sid, types, entity);
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
    types: MaterialType[],
    entity: MaterialEntityType | null
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.materialService.listForSpace({
        spaceId,
        materialTypes: types.length > 0 ? types : null,
        entityType: entity,
      });
      this.rows.set(result.rows ?? []);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected onChipRemove(chip: BrowseFilterChip): void {
    if (chip.field === 'query') {
      this.query.set('');
    } else if (chip.field === 'materialTypes') {
      this.materialTypes.update((ts) => ts.filter((t) => t !== (chip.id as MaterialType)));
    } else if (chip.field === 'entityType') {
      this.entityType.set(null);
    }
  }

  protected onClearAll(): void {
    this.query.set('');
    this.materialTypes.set([]);
    this.entityType.set(null);
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
      if (sid) await this.load(sid, this.materialTypes(), this.entityType());
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
