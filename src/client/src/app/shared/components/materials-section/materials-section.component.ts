import { Component, computed, effect, inject, input, OnInit, signal } from '@angular/core';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  MATERIAL_TYPE_LABEL,
  Material,
  MaterialEntityType,
  MaterialType,
} from '../../../core/models/material.model';
import { errorMessage } from '../../../core/utils/error-message';
import { MaterialService } from '../../../core/services/material.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { confirmDelete } from '../../utils/confirm-delete';
import { MaterialRowComponent } from '../material-row/material-row.component';
import { MaterialUploadZoneComponent } from '../material-upload-zone/material-upload-zone.component';

type MaterialFilter = MaterialType | 'all';

/**
 * Entity-level Materials section. Drops onto trial / company / product /
 * marker detail pages. Loads via list_materials_for_entity, supports a
 * type-filter chip strip (All / Briefing / Priority Notice / Ad Hoc),
 * and exposes an upload zone. Each row has inline download + delete.
 */
@Component({
  selector: 'app-materials-section',
  standalone: true,
  imports: [MaterialRowComponent, MaterialUploadZoneComponent],
  templateUrl: './materials-section.component.html',
})
export class MaterialsSectionComponent implements OnInit {
  private readonly materialService = inject(MaterialService);
  private readonly messageService = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);
  protected readonly spaceRole = inject(SpaceRoleService);

  readonly entityType = input.required<MaterialEntityType>();
  readonly entityId = input.required<string>();
  readonly spaceId = input.required<string>();

  protected readonly materials = signal<Material[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly activeFilter = signal<MaterialFilter>('all');

  protected readonly typeFilters: { label: string; value: MaterialFilter }[] = [
    { label: 'All', value: 'all' },
    { label: MATERIAL_TYPE_LABEL.briefing, value: 'briefing' },
    { label: MATERIAL_TYPE_LABEL.conference_report, value: 'conference_report' },
    { label: MATERIAL_TYPE_LABEL.priority_notice, value: 'priority_notice' },
    { label: MATERIAL_TYPE_LABEL.ad_hoc, value: 'ad_hoc' },
  ];

  protected readonly visibleMaterials = computed(() => {
    const filter = this.activeFilter();
    const all = this.materials();
    if (filter === 'all') return all;
    return all.filter((m) => m.material_type === filter);
  });

  protected readonly canUpload = computed(() => this.spaceRole.canEdit());

  // Reload whenever the anchor entity changes. Guards against the
  // template binding to a fresh entity (e.g. trial detail navigation
  // between trials) without remounting.
  private readonly loadOnEntityChange = effect(() => {
    const eId = this.entityId();
    const eType = this.entityType();
    if (eId && eType) {
      void this.load();
    }
  });

  ngOnInit(): void {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.materialService.listForEntity({
        entityType: this.entityType(),
        entityId: this.entityId(),
      });
      this.materials.set(result.rows ?? []);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.materials.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected setFilter(next: MaterialFilter): void {
    this.activeFilter.set(next);
  }

  protected async onUploaded(): Promise<void> {
    await this.load();
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
      await this.load();
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
