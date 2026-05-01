import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';
import { ConfirmationService, MessageService } from 'primeng/api';

import {
  MATERIAL_ENTITY_LABEL,
  MATERIAL_TYPE_LABEL,
  Material,
  MaterialFileKind,
  classifyMaterialMime,
} from '../../../core/models/material.model';
import { MaterialService } from '../../../core/services/material.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { confirmDelete } from '../../utils/confirm-delete';

/**
 * Side drawer rendering the material's metadata, a file-type icon, and a
 * Download button. v1 omits inline preview rendering (deferred to v2);
 * the user clicks Download to fetch a signed URL and grab the file.
 */
@Component({
  selector: 'app-material-preview-drawer',
  standalone: true,
  imports: [ButtonModule, DrawerModule],
  template: `
    <p-drawer
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      position="right"
      styleClass="!w-full md:!w-[440px]"
      [modal]="true"
      [dismissible]="true"
      [closeOnEscape]="true"
      [header]="material()?.title ?? 'Material'"
      (onHide)="closed.emit()"
    >
      @if (material(); as m) {
        <div class="space-y-5">
          <!-- File-type icon -->
          <div class="flex items-center gap-3">
            <span
              class="flex h-14 w-11 items-center justify-center rounded-sm text-xs font-bold uppercase tracking-wider"
              [class]="iconClasses()"
            >
              {{ kindLabel() }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-slate-900">{{ m.file_name }}</p>
              <p class="font-mono text-[11px] tabular-nums text-slate-500">
                {{ formattedSize() }}
              </p>
            </div>
          </div>

          <!-- Metadata grid -->
          <dl class="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-100 pt-4 text-xs">
            <div>
              <dt class="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                Type
              </dt>
              <dd class="text-slate-700">{{ typeLabel() }}</dd>
            </div>
            <div>
              <dt class="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                Uploaded
              </dt>
              <dd class="font-mono tabular-nums text-slate-700">{{ formattedDate() }}</dd>
            </div>
          </dl>

          @if (m.links.length > 0) {
            <div class="border-t border-slate-100 pt-4">
              <p class="mb-2 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                Linked entities
              </p>
              <ul class="space-y-1.5">
                @for (link of m.links; track link.entity_type + link.entity_id) {
                  <li class="flex items-center gap-2 text-xs text-slate-600">
                    <span
                      class="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-500"
                    >
                      {{ entityLabel(link.entity_type) }}
                    </span>
                    <span class="font-mono text-[10px] text-slate-400">
                      {{ truncateId(link.entity_id) }}
                    </span>
                  </li>
                }
              </ul>
            </div>
          }

          <!-- Actions -->
          <div class="flex items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <p-button
              label="Download"
              icon="fa-solid fa-arrow-down"
              [loading]="downloading()"
              (onClick)="download()"
            />
            @if (canDelete()) {
              <p-button
                label="Delete"
                icon="fa-solid fa-trash"
                severity="danger"
                [outlined]="true"
                size="small"
                [loading]="deleting()"
                (onClick)="confirmDeletion()"
              />
            }
          </div>

          @if (downloadError()) {
            <p class="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {{ downloadError() }}
            </p>
          }
        </div>
      } @else {
        <p class="px-2 py-4 text-sm text-slate-500">No material selected.</p>
      }
    </p-drawer>
  `,
})
export class MaterialPreviewDrawerComponent {
  private readonly materialService = inject(MaterialService);
  private readonly messageService = inject(MessageService);
  private readonly confirmation = inject(ConfirmationService);
  private readonly supabase = inject(SupabaseService);

  readonly visible = input<boolean>(false);
  readonly material = input<Material | null>(null);

  readonly closed = output<void>();
  readonly deleted = output<string>();

  protected readonly downloading = signal(false);
  protected readonly deleting = signal(false);
  protected readonly downloadError = signal<string | null>(null);

  protected readonly kind = computed<MaterialFileKind>(() => {
    const m = this.material();
    if (!m) return 'other';
    return classifyMaterialMime(m.mime_type, m.file_name);
  });

  protected readonly kindLabel = computed(() => {
    switch (this.kind()) {
      case 'pptx':
        return 'PPT';
      case 'pdf':
        return 'PDF';
      case 'docx':
        return 'DOC';
      default:
        return 'FILE';
    }
  });

  protected readonly iconClasses = computed(() => {
    switch (this.kind()) {
      case 'pptx':
        return 'border border-amber-300 bg-amber-50 text-amber-700';
      case 'pdf':
        return 'border border-red-300 bg-red-50 text-red-700';
      case 'docx':
        return 'border border-blue-300 bg-blue-50 text-blue-700';
      default:
        return 'border border-slate-300 bg-slate-50 text-slate-600';
    }
  });

  protected readonly typeLabel = computed(() => {
    const m = this.material();
    return m ? MATERIAL_TYPE_LABEL[m.material_type] : '';
  });

  protected readonly formattedDate = computed(() => {
    const m = this.material();
    if (!m) return '';
    const d = new Date(m.uploaded_at);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  });

  protected readonly formattedSize = computed(() => {
    const m = this.material();
    if (!m) return '';
    const bytes = m.file_size_bytes;
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  });

  protected readonly canDelete = computed(() => {
    const m = this.material();
    const userId = this.supabase.currentUser()?.id;
    return !!m && !!userId && m.uploaded_by === userId;
  });

  protected entityLabel(t: string): string {
    return MATERIAL_ENTITY_LABEL[t as keyof typeof MATERIAL_ENTITY_LABEL] ?? t;
  }

  protected truncateId(id: string): string {
    return id.length > 12 ? `${id.slice(0, 8)}...` : id;
  }

  protected onVisibleChange(next: boolean): void {
    if (!next) this.closed.emit();
  }

  protected async download(): Promise<void> {
    const m = this.material();
    if (!m) return;
    this.downloading.set(true);
    this.downloadError.set(null);
    try {
      const { url } = await this.materialService.getDownloadUrl(m.id);
      // Trigger browser download via a transient anchor.
      const a = document.createElement('a');
      a.href = url;
      a.download = m.file_name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      this.downloadError.set(e instanceof Error ? e.message : 'Download failed.');
    } finally {
      this.downloading.set(false);
    }
  }

  protected async confirmDeletion(): Promise<void> {
    const m = this.material();
    if (!m) return;
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete material',
      message:
        `Delete "${m.title}"? The file and all of its links will be ` +
        `permanently removed. This cannot be undone.`,
    });
    if (!ok) return;

    this.deleting.set(true);
    try {
      await this.materialService.delete(m.id);
      this.messageService.add({
        severity: 'success',
        summary: 'Material deleted.',
        life: 3000,
      });
      this.deleted.emit(m.id);
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not delete material',
        detail: e instanceof Error ? e.message : 'Try again.',
        life: 4000,
      });
    } finally {
      this.deleting.set(false);
    }
  }
}
