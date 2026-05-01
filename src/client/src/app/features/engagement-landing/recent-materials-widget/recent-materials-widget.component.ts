import { Component, computed, effect, inject, input, signal } from '@angular/core';

import { Material } from '../../../core/models/material.model';
import { MaterialService } from '../../../core/services/material.service';
import { MaterialRowComponent } from '../../../shared/components/material-row/material-row.component';
import { MaterialPreviewDrawerComponent } from '../../../shared/components/material-preview-drawer/material-preview-drawer.component';

/**
 * Recent materials feed for the engagement landing. Calls
 * list_recent_materials_for_space and renders a stack of
 * <app-material-row> cards. Hidden automatically when there are no
 * materials.
 */
@Component({
  selector: 'app-recent-materials-widget',
  standalone: true,
  imports: [MaterialRowComponent, MaterialPreviewDrawerComponent],
  template: `
    @if (visible() && (loading() || rows().length > 0)) {
      <section class="border border-slate-200 bg-white" aria-label="Recent materials">
        <header class="flex items-center justify-between border-b border-slate-200 bg-slate-50/60 px-4 py-2">
          <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Recent materials
          </h2>
          <a
            [href]="allMaterialsLink()"
            class="font-mono text-[10px] uppercase tracking-wider text-brand-700 hover:underline"
          >
            All materials
          </a>
        </header>
        <div class="materials-section__list">
          @if (loading()) {
            <p class="px-4 py-3 text-xs text-slate-400">Loading...</p>
          } @else {
            <ul class="divide-y divide-slate-100">
              @for (material of rows(); track material.id) {
                <li>
                  <app-material-row
                    [material]="material"
                    [showLinks]="true"
                    (rowClick)="onRowClick($event)"
                    (downloadClick)="onDownloadClick($event)"
                  />
                </li>
              }
            </ul>
          }
        </div>
      </section>

      <app-material-preview-drawer
        [visible]="previewVisible()"
        [material]="previewMaterial()"
        (closed)="onPreviewClosed()"
        (deleted)="onPreviewDeleted()"
      />
    }
  `,
})
export class RecentMaterialsWidgetComponent {
  private readonly materialService = inject(MaterialService);

  readonly spaceId = input.required<string>();
  readonly tenantId = input<string | null>(null);
  /**
   * When true, the widget renders even before list_recent_materials_for_space
   * has resolved. Pass false to hide the widget entirely (Phase 1 default
   * before the registry shipped).
   */
  readonly visible = input<boolean>(true);
  readonly limit = input<number>(5);

  protected readonly rows = signal<Material[]>([]);
  protected readonly loading = signal(true);
  protected readonly previewMaterial = signal<Material | null>(null);
  protected readonly previewVisible = signal(false);

  protected readonly allMaterialsLink = computed(() => {
    const t = this.tenantId();
    const s = this.spaceId();
    if (!t || !s) return '#';
    return `/t/${t}/s/${s}/materials`;
  });

  private readonly loadEffect = effect(() => {
    const sid = this.spaceId();
    const lim = this.limit();
    if (!sid) return;
    void this.load(sid, lim);
  });

  private async load(spaceId: string, limit: number): Promise<void> {
    this.loading.set(true);
    try {
      const rows = await this.materialService.listRecentForSpace(spaceId, limit);
      this.rows.set(rows);
    } catch {
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected onRowClick(material: Material): void {
    this.previewMaterial.set(material);
    this.previewVisible.set(true);
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
    } catch {
      this.previewMaterial.set(material);
      this.previewVisible.set(true);
    }
  }

  protected onPreviewClosed(): void {
    this.previewVisible.set(false);
    this.previewMaterial.set(null);
  }

  protected async onPreviewDeleted(): Promise<void> {
    this.previewVisible.set(false);
    this.previewMaterial.set(null);
    const sid = this.spaceId();
    if (sid) await this.load(sid, this.limit());
  }
}
