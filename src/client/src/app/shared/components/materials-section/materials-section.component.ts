import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
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
import { materialsSectionHidden } from './materials-section-visibility';
import { MaterialRowComponent } from '../material-row/material-row.component';
import { MaterialUploadZoneComponent } from '../material-upload-zone/material-upload-zone.component';
import { LoaderComponent } from '../loader/loader.component';

type MaterialFilter = MaterialType | 'all';

/**
 * Entity-level Materials section. Drops onto trial / company / asset /
 * marker detail pages. Loads via list_materials_for_entity, supports a
 * type-filter chip strip (All / Briefing / Priority Notice / Ad Hoc),
 * and exposes an upload zone. Each row has inline download + delete.
 */
@Component({
  selector: 'app-materials-section',
  standalone: true,
  imports: [MaterialRowComponent, MaterialUploadZoneComponent, LoaderComponent],
  templateUrl: './materials-section.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialsSectionComponent implements OnInit {
  private readonly materialService = inject(MaterialService);
  private readonly messageService = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);
  protected readonly spaceRole = inject(SpaceRoleService);

  readonly entityType = input.required<MaterialEntityType>();
  readonly entityId = input.required<string>();
  readonly spaceId = input.required<string>();
  /**
   * Tenant context for linked-entity chip routes in each row. Optional: when
   * not supplied (the detail-page hosts), the row derives it from the route
   * ancestry, which always carries :tenantId beneath /t/:tenantId/s/:spaceId.
   */
  readonly tenantId = input<string | null>(null);
  /**
   * Optional section heading the component renders at its top. When empty
   * (default) the parent owns the heading and nothing changes for existing
   * call sites. The marker pane passes "Materials" so the section can own
   * its own label when it is conditionally hidden.
   */
  readonly heading = input<string>('');
  /**
   * When true, the section renders nothing once it has settled into an empty
   * read-only state: not loading, no error, no materials, and the user cannot
   * upload. Editors who can upload still see the (empty) section so they can
   * add the first material. Default false keeps every other host unchanged.
   */
  readonly hideWhenEmpty = input<boolean>(false);
  /**
   * When true, the material list caps its height and scrolls internally so a
   * long list never pushes the pinned upload zone off-screen. Used by the
   * fixed-width sidebar cards (asset / trial / company); full-width hosts leave
   * it false so the list grows naturally.
   */
  readonly scrollList = input<boolean>(false);

  /** Emits the loaded material count after each fetch (0 on empty or error) so
   *  the surrounding section-card can show it in the header badge. */
  readonly loaded = output<number>();

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

  /**
   * Whether the whole section collapses to nothing. When a host opts in via
   * hideWhenEmpty (e.g. a transient detail pane that is not an upload surface),
   * the section disappears once the fetch settles with no materials AND the
   * viewer cannot upload. An editor who can upload keeps the (empty) section so
   * they can register the first material; the drop zone is their only entry
   * point on that surface. While loading or on error we still render so the
   * user is never left with a silent gap. Hosts that are the contextual upload
   * surface (entity detail pages) simply do not set hideWhenEmpty, so they keep
   * the zone regardless. The rule lives in materialsSectionHidden() so it can be
   * unit-tested without a DOM.
   */
  protected readonly hidden = computed(() =>
    materialsSectionHidden({
      hideWhenEmpty: this.hideWhenEmpty(),
      loading: this.loading(),
      error: this.error() !== null,
      isEmpty: this.materials().length === 0,
      canUpload: this.canUpload(),
    })
  );

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
      this.loaded.emit(this.materials().length);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.materials.set([]);
      this.loaded.emit(0);
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
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete material',
      message:
        `Delete "${material.title}"?\n\n` +
        `The file and all of its links will be permanently removed. ` +
        `This cannot be undone.`,
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
