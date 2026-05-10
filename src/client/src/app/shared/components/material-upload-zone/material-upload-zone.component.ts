import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';

import { errorMessage } from '../../../core/utils/error-message';
import { MaterialService } from '../../../core/services/material.service';
import {
  MATERIAL_DEFAULT_ALLOWED_MIME,
  MATERIAL_TYPE_LABEL,
  Material,
  MaterialEntityType,
  MaterialLink,
  MaterialType,
  classifyMaterialMime,
} from '../../../core/models/material.model';
import { LinkedEntitiesPickerComponent } from '../linked-entities-picker/linked-entities-picker.component';

interface PendingFile {
  file: File;
  title: string;
}

/**
 * Drop / browse + upload dialog. Used inside materials-section as both
 * the empty-state add slot and the per-row "Upload" affordance. Handles
 * the full upload flow: storage put, register_material, optional repath
 * to the canonical material id.
 */
@Component({
  selector: 'app-material-upload-zone',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    Dialog,
    InputText,
    SelectModule,
    LinkedEntitiesPickerComponent,
  ],
  template: `
    <!-- The dialog renders only when open() is true, so the inert state
         is the on-page drop / browse zone above. -->
    <div
      class="flex items-center justify-between gap-3 border-2 border-dashed px-4 py-3 transition-colors"
      [class.border-slate-200]="!dragOver()"
      [class.border-brand-400]="dragOver()"
      [class.bg-slate-50]="!dragOver()"
      [class.bg-brand-50]="dragOver()"
      (dragover)="onDragOver($event)"
      (dragleave)="onDragLeave($event)"
      (drop)="onDrop($event)"
    >
      <div class="flex items-center gap-3 text-xs">
        <i class="fa-solid fa-cloud-arrow-up text-slate-400"></i>
        <span class="text-slate-500">
          Drop a file or
          <button type="button" class="text-brand-700 hover:underline" (click)="fileInput.click()">
            browse
          </button>
          to add a material.
        </span>
      </div>
      <span class="font-mono text-[10px] uppercase tracking-wider text-slate-400">
        PPTX | PDF | DOCX
      </span>

      <input
        #fileInput
        type="file"
        class="hidden"
        [accept]="acceptList()"
        (change)="onFileSelected($event)"
      />
    </div>

    <p-dialog
      header="Upload material"
      [(visible)]="dialogOpen"
      [modal]="true"
      styleClass="!w-[40rem]"
      [closable]="!uploading()"
      [closeOnEscape]="!uploading()"
      [dismissableMask]="!uploading()"
      (onHide)="onDialogClose()"
    >
      @if (pending(); as p) {
        <form (ngSubmit)="upload()" class="space-y-4">
          <!-- File preview -->
          <div
            class="flex items-center gap-3 rounded-sm border border-slate-200 bg-slate-50 px-3 py-2"
          >
            <span
              [class]="
                'flex h-10 w-8 shrink-0 items-center justify-center rounded-sm text-[10px] font-bold uppercase tracking-wider ' +
                kindBadgeClass()
              "
            >
              {{ kindLabel() }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium text-slate-900">
                {{ p.file.name }}
              </p>
              <p class="text-[11px] text-slate-500 font-mono tabular-nums">
                {{ formattedSize() }}
              </p>
            </div>
          </div>

          @if (mimeError()) {
            <p class="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {{ mimeError() }}
            </p>
          }

          <!-- Type select -->
          <div>
            <label
              for="material-type"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Type
            </label>
            <p-select
              inputId="material-type"
              [options]="typeOptions"
              [ngModel]="materialType()"
              (ngModelChange)="materialType.set($event)"
              name="material_type"
              styleClass="w-full"
              appendTo="body"
            />
          </div>

          <!-- Title input -->
          <div>
            <label
              for="material-title"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Title
            </label>
            <input
              pInputText
              id="material-title"
              name="title"
              class="w-full"
              [ngModel]="title()"
              (ngModelChange)="title.set($event)"
              placeholder="Defaults to the filename"
            />
          </div>

          <!-- Linked entities -->
          <div>
            <span
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Linked entities
            </span>
            <app-linked-entities-picker
              [spaceId]="spaceId()"
              [value]="pickerLinks()"
              (valueChange)="onPickerChange($event)"
            />
          </div>

          @if (uploadError()) {
            <p class="rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {{ uploadError() }}
            </p>
          }
        </form>
      }

      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          [disabled]="uploading()"
          (onClick)="closeDialog()"
        />
        <p-button
          label="Upload"
          [loading]="uploading()"
          [disabled]="!canUpload()"
          (onClick)="upload()"
        />
      </ng-template>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MaterialUploadZoneComponent {
  private readonly materialService = inject(MaterialService);
  private readonly messageService = inject(MessageService);

  readonly spaceId = input.required<string>();
  readonly entityType = input.required<MaterialEntityType>();
  readonly entityId = input.required<string>();
  /** Tenant-configured allowlist; falls back to the platform defaults. */
  readonly allowedMimeTypes = input<readonly string[]>(MATERIAL_DEFAULT_ALLOWED_MIME);
  /** Tenant-configured maximum size in bytes; null means use server default. */
  readonly maxSizeBytes = input<number | null>(null);

  readonly uploaded = output<Material>();

  // Local UI state.
  protected readonly dialogOpen = signal(false);
  protected readonly dragOver = signal(false);
  protected readonly pending = signal<PendingFile | null>(null);
  protected readonly title = signal('');
  protected readonly materialType = signal<MaterialType>('briefing');
  protected readonly uploading = signal(false);
  protected readonly uploadError = signal<string | null>(null);
  protected readonly mimeError = signal<string | null>(null);

  // The picker takes the primary-intelligence link shape; we adapt to and
  // from the materials shape.
  // The picker itself is the source of truth while the dialog is open;
  // we mirror the chips back into pickerLinks() so the picker keeps them.
  protected readonly pickerLinks = signal<
    {
      entity_type: 'trial' | 'marker' | 'company' | 'product';
      entity_id: string;
      relationship_type: string;
      gloss: string | null;
      display_order: number;
    }[]
  >([]);

  protected readonly typeOptions = (Object.keys(MATERIAL_TYPE_LABEL) as MaterialType[]).map(
    (k) => ({ label: MATERIAL_TYPE_LABEL[k], value: k })
  );

  protected readonly acceptList = computed(() =>
    [
      ...this.allowedMimeTypes(),
      // Hint extensions for the OS file picker.
      '.pptx',
      '.ppt',
      '.pdf',
      '.docx',
      '.doc',
    ].join(',')
  );

  protected readonly canUpload = computed(() => {
    if (!this.pending() || this.uploading()) return false;
    if (this.mimeError()) return false;
    return this.title().trim().length > 0;
  });

  protected readonly kindLabel = computed(() => {
    const p = this.pending();
    if (!p) return '';
    const k = classifyMaterialMime(p.file.type, p.file.name);
    return k === 'pptx' ? 'PPT' : k === 'pdf' ? 'PDF' : k === 'docx' ? 'DOC' : 'FILE';
  });

  protected readonly kindBadgeClass = computed(() => {
    const p = this.pending();
    if (!p) return '';
    const k = classifyMaterialMime(p.file.type, p.file.name);
    if (k === 'pptx') return 'border border-amber-300 bg-amber-50 text-amber-700';
    if (k === 'pdf') return 'border border-red-300 bg-red-50 text-red-700';
    if (k === 'docx') return 'border border-blue-300 bg-blue-50 text-blue-700';
    return 'border border-slate-300 bg-slate-50 text-slate-600';
  });

  protected readonly formattedSize = computed(() => {
    const p = this.pending();
    if (!p) return '';
    const bytes = p.file.size;
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  });

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragOver.set(false);
    const file = event.dataTransfer?.files?.[0];
    if (file) this.acceptFile(file);
  }

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.acceptFile(file);
    // Reset so re-selecting the same file fires change.
    input.value = '';
  }

  private acceptFile(file: File): void {
    this.uploadError.set(null);
    this.mimeError.set(null);

    const allowed = this.allowedMimeTypes();
    if (allowed.length > 0 && !allowed.includes(file.type)) {
      // Mime type missing or not allowed. Permit upload only if the
      // extension matches a known kind; the server will reject otherwise.
      const kind = classifyMaterialMime(file.type, file.name);
      if (kind === 'other') {
        this.mimeError.set('This file type is not allowed. Upload PPTX, PDF, or DOCX.');
      }
    }

    const max = this.maxSizeBytes();
    if (max && file.size > max) {
      this.mimeError.set(`File is larger than the ${this.humanBytes(max)} limit.`);
    }

    const filenameWithoutExt = file.name.replace(/\.[^.]+$/, '');

    // Pre-select the current entity in the picker, unless it is space-level
    // (the picker can't render space links).
    const initialPickerLinks: {
      entity_type: 'trial' | 'marker' | 'company' | 'product';
      entity_id: string;
      relationship_type: string;
      gloss: string | null;
      display_order: number;
    }[] = [];
    const eType = this.entityType();
    const eId = this.entityId();
    if (eType !== 'space') {
      initialPickerLinks.push({
        entity_type: eType,
        entity_id: eId,
        relationship_type: 'related',
        gloss: null,
        display_order: 0,
      });
    }

    this.pending.set({ file, title: filenameWithoutExt });
    this.title.set(filenameWithoutExt);
    this.materialType.set('briefing');
    this.pickerLinks.set(initialPickerLinks);
    this.dialogOpen.set(true);
  }

  protected onPickerChange(
    next: {
      entity_type: 'trial' | 'marker' | 'company' | 'product';
      entity_id: string;
      relationship_type: string;
      gloss: string | null;
      display_order: number;
    }[]
  ): void {
    this.pickerLinks.set(next);
  }

  protected closeDialog(): void {
    if (this.uploading()) return;
    this.dialogOpen.set(false);
    this.onDialogClose();
  }

  protected onDialogClose(): void {
    if (this.uploading()) return;
    this.pending.set(null);
    this.title.set('');
    this.uploadError.set(null);
    this.mimeError.set(null);
    this.pickerLinks.set([]);
  }

  protected async upload(): Promise<void> {
    const pending = this.pending();
    if (!pending) return;
    if (!this.canUpload()) return;

    this.uploading.set(true);
    this.uploadError.set(null);

    const sid = this.spaceId();
    const file = pending.file;

    // Compose links: picker links plus, when the current entity is
    // space-level, an explicit space link (the picker doesn't show
    // space as a target).
    const links: MaterialLink[] = this.pickerLinks().map((l, i) => ({
      entity_type: l.entity_type,
      entity_id: l.entity_id,
      display_order: i,
    }));
    if (this.entityType() === 'space') {
      links.unshift({
        entity_type: 'space',
        entity_id: this.entityId(),
        display_order: 0,
      });
    }

    try {
      // 1. Register first. RPC validates size/mime/access. Returns a
      //    material_id; worker derives the canonical R2 key from this id.
      const materialId = await this.materialService.registerMaterial({
        space_id: sid,
        // Placeholder path; the worker derives the real R2 key from
        // (space_id, material_id, file_name) at sign-upload time. The
        // file_path column gets its real value at finalize time, but
        // we pre-fill it here so list_materials_for_* can return a
        // path-ish string for the row even pre-finalize. The row is
        // hidden by finalized_at IS NULL anyway.
        file_path: `${sid}/pending/${file.name}`,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        material_type: this.materialType(),
        title: this.title().trim() || file.name,
        links,
      });

      // 2. Upload bytes. Worker mints presigned PUT URL, browser PUTs
      //    directly to R2 at {space_id}/{material_id}/{file_name}.
      await this.materialService.uploadFile(materialId, file);

      // 3. Update the row's file_path to the canonical key and mark
      //    finalized in a single RPC. (finalize_material handles the
      //    visibility flip.) We could also update file_path here via
      //    a second RPC; keep the current shape for now since
      //    download_material returns whatever path is in the column.
      await this.materialService.updateFilePathDirect(
        materialId,
        `${sid}/${materialId}/${file.name}`
      );
      await this.materialService.finalize(materialId);

      this.messageService.add({
        severity: 'success',
        summary: 'Material uploaded.',
        life: 3000,
      });

      this.uploaded.emit({
        id: materialId,
        space_id: sid,
        uploaded_by: '',
        file_path: `${sid}/${materialId}/${file.name}`,
        file_name: file.name,
        file_size_bytes: file.size,
        mime_type: file.type,
        material_type: this.materialType(),
        title: this.title().trim() || file.name,
        uploaded_at: new Date().toISOString(),
        links,
      });

      this.dialogOpen.set(false);
      this.onDialogClose();
    } catch (e) {
      this.uploadError.set(errorMessage(e));
    } finally {
      this.uploading.set(false);
    }
  }

  private humanBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${Math.round(n)} ${units[i]}`;
  }
}
