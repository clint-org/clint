import { Component, computed, inject, input, output } from '@angular/core';

import {
  MATERIAL_ENTITY_LABEL,
  MATERIAL_TYPE_LABEL,
  Material,
  MaterialFileKind,
  classifyMaterialMime,
} from '../../../core/models/material.model';
import { SupabaseService } from '../../../core/services/supabase.service';

/**
 * Single row in a materials list. File-type icon (PPTX amber, PDF red,
 * DOCX blue) leads; title and metadata follow; inline Download and
 * (uploader-only) Delete actions sit at the end. The row itself is no
 * longer a button.
 */
@Component({
  selector: 'app-material-row',
  standalone: true,
  imports: [],
  template: `
    <div class="group flex w-full items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
      <!-- File-type badge (PPTX amber, PDF red, DOCX blue, other slate) -->
      <span
        class="flex h-9 w-7 shrink-0 items-center justify-center rounded-sm text-[9px] font-bold uppercase tracking-wider"
        [class]="iconClasses()"
        aria-hidden="true"
      >
        {{ kindLabel() }}
      </span>

      <!-- Title + metadata -->
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <p class="truncate text-sm font-medium text-slate-900">
            {{ material().title }}
          </p>
          <span
            class="shrink-0 rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-slate-500"
          >
            {{ typeLabel() }}
          </span>
        </div>
        <div class="mt-0.5 flex items-center gap-2 text-[11px] text-slate-500">
          <span class="font-mono tabular-nums">{{ formattedDate() }}</span>
          @if (showLinks() && material().links.length > 1) {
            <span class="text-slate-300" aria-hidden="true">|</span>
            <span> Linked to {{ material().links.length }} entities </span>
          } @else if (showLinks() && material().links.length === 1) {
            <span class="text-slate-300" aria-hidden="true">|</span>
            <span>{{ entityLabel(material().links[0].entity_type) }} link</span>
          }
          <span class="text-slate-300" aria-hidden="true">|</span>
          <span class="font-mono tabular-nums">{{ formattedSize() }}</span>
        </div>
      </div>

      <!-- Action buttons (revealed on hover; always reachable via keyboard) -->
      <div class="flex shrink-0 items-center gap-1">
        <button
          type="button"
          class="rounded-sm p-1.5 text-slate-400 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-700 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-brand-500 group-hover:opacity-100"
          (click)="downloadClick.emit(material())"
          [attr.aria-label]="'Download ' + material().title"
        >
          <i class="fa-solid fa-arrow-down text-xs"></i>
        </button>
        @if (canDelete()) {
          <button
            type="button"
            class="rounded-sm p-1.5 text-slate-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-red-400 group-hover:opacity-100"
            (click)="deleteClick.emit(material())"
            [attr.aria-label]="'Delete ' + material().title"
          >
            <i class="fa-solid fa-trash text-xs"></i>
          </button>
        }
      </div>
    </div>
  `,
})
export class MaterialRowComponent {
  private readonly supabase = inject(SupabaseService);

  readonly material = input.required<Material>();
  readonly showLinks = input<boolean>(true);

  readonly downloadClick = output<Material>();
  readonly deleteClick = output<Material>();

  protected readonly canDelete = computed(() => {
    const userId = this.supabase.currentUser()?.id;
    return !!userId && this.material().uploaded_by === userId;
  });

  protected readonly kind = computed<MaterialFileKind>(() =>
    classifyMaterialMime(this.material().mime_type, this.material().file_name)
  );

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

  protected readonly typeLabel = computed(() => MATERIAL_TYPE_LABEL[this.material().material_type]);

  protected readonly formattedDate = computed(() => {
    const d = new Date(this.material().uploaded_at);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  });

  protected readonly formattedSize = computed(() => {
    const bytes = this.material().file_size_bytes;
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
  });

  protected entityLabel(t: string): string {
    return MATERIAL_ENTITY_LABEL[t as keyof typeof MATERIAL_ENTITY_LABEL] ?? t;
  }
}
