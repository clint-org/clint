import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { ConfirmationService, MessageService } from 'primeng/api';

import { Material } from '../../../core/models/material.model';
import { MaterialService } from '../../../core/services/material.service';
import { errorMessage } from '../../../core/utils/error-message';
import { MaterialRowComponent } from '../../../shared/components/material-row/material-row.component';
import { SkeletonComponent } from '../../../shared/components/skeleton/skeleton.component';
import { confirmDelete } from '../../../shared/utils/confirm-delete';

/**
 * Recent materials feed for the engagement landing. Calls
 * list_recent_materials_for_space and renders a stack of
 * <app-material-row> cards with inline download + delete. Hidden
 * automatically when there are no materials and no error.
 */
@Component({
  selector: 'app-recent-materials-widget',
  standalone: true,
  imports: [MaterialRowComponent, SkeletonComponent],
  template: `
    @if (visible() && (loading() || error() || rows().length > 0)) {
      <section aria-label="Recent materials" [attr.aria-busy]="loading() || null">
        <header class="mb-2 flex items-center justify-between border-b border-slate-200 pb-2.5">
          <h2
            class="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Recent materials
          </h2>
          <a [href]="allMaterialsLink()" class="section-action-link"> All materials </a>
        </header>
        <div class="materials-section__list">
          @if (loading()) {
            <ul class="divide-y divide-slate-100" aria-hidden="true">
              @for (i of skeletonRows; track i) {
                <li class="flex items-center gap-3 px-4 py-2.5">
                  <app-skeleton w="28px" h="36px" />
                  <div class="min-w-0 flex-1">
                    <div class="flex items-baseline gap-2">
                      <app-skeleton w="44%" h="14px" />
                      <app-skeleton w="28px" h="10px" />
                    </div>
                    <div class="mt-1.5">
                      <app-skeleton w="58%" h="11px" />
                    </div>
                  </div>
                </li>
              }
            </ul>
          } @else if (error()) {
            <p class="px-4 py-3 text-xs text-red-600">{{ error() }}</p>
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
      </section>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecentMaterialsWidgetComponent {
  private readonly materialService = inject(MaterialService);
  private readonly messageService = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);

  readonly spaceId = input.required<string>();
  readonly tenantId = input<string | null>(null);
  /**
   * When true, the widget renders even before list_recent_materials_for_space
   * has resolved. Pass false to hide the widget entirely (Phase 1 default
   * before the registry shipped).
   */
  readonly visible = input<boolean>(true);
  readonly limit = input<number>(3);

  protected readonly rows = signal<Material[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly skeletonRows = [0, 1, 2];

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
    this.error.set(null);
    try {
      const rows = await this.materialService.listRecentForSpace(spaceId, limit);
      this.rows.set(rows);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
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
      if (sid) await this.load(sid, this.limit());
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
