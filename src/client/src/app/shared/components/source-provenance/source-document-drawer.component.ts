import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { DrawerModule } from 'primeng/drawer';

import { SourceProvenance } from './source-provenance.model';
import { formatProvenanceDate, provenanceTitle, sourceKindLabel } from './source-provenance.util';

/**
 * Read-only drawer showing the original ingested source an AI import landed
 * from: title, kind, URL, who imported it and when, plus the raw source text.
 * Nothing is editable; this is provenance, not a content surface.
 */
@Component({
  selector: 'app-source-document-drawer',
  imports: [DrawerModule, ButtonModule],
  template: `
    <p-drawer
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      position="right"
      styleClass="!w-full md:!w-[560px]"
      [modal]="true"
      [dismissible]="true"
      [closeOnEscape]="true"
      header="Import source"
      (onHide)="closed.emit()"
    >
      @let d = doc();
      @if (d) {
        <div class="space-y-5 px-1">
          <div>
            <span
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Source
            </span>
            <p class="text-sm font-medium text-slate-900">{{ title() }}</p>
            <div class="mt-1.5 flex flex-wrap items-center gap-2">
              <span
                class="inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600"
              >
                {{ kindLabel() }}
              </span>
              @if (d.source_url) {
                <a
                  [href]="d.source_url"
                  target="_blank"
                  rel="noopener"
                  class="truncate text-xs text-brand-700 underline decoration-slate-300 underline-offset-2 hover:decoration-brand-500"
                >
                  {{ d.source_url }}
                </a>
              }
            </div>
          </div>

          <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt class="font-semibold uppercase tracking-wider text-slate-400">Imported by</dt>
            <dd class="text-slate-700">{{ d.imported_by_email ?? 'Unknown' }}</dd>
            <dt class="font-semibold uppercase tracking-wider text-slate-400">Imported</dt>
            <dd class="text-slate-700">{{ importedDate() }}</dd>
            <dt class="font-semibold uppercase tracking-wider text-slate-400">Fetch</dt>
            <dd class="text-slate-700">{{ d.fetch_outcome }}</dd>
            @if (d.ai_model) {
              <dt class="font-semibold uppercase tracking-wider text-slate-400">Model</dt>
              <dd class="font-mono text-slate-700">{{ d.ai_model }}</dd>
            }
          </dl>

          <div>
            <div class="mb-1 flex items-center justify-between">
              <span
                class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Original text
              </span>
              <p-button
                label="Copy"
                icon="fa-solid fa-copy"
                severity="secondary"
                [text]="true"
                size="small"
                (onClick)="copy(d.source_text)"
              />
            </div>
            <pre
              class="max-h-[60vh] overflow-auto rounded-sm border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-700"
              >{{ d.source_text }}</pre
            >
          </div>
        </div>
      }
    </p-drawer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceDocumentDrawerComponent {
  readonly doc = input<SourceProvenance | null>(null);
  readonly visible = input<boolean>(false);
  readonly closed = output<void>();

  protected readonly title = computed(() => provenanceTitle(this.doc()));
  protected readonly kindLabel = computed(() => {
    const d = this.doc();
    return d ? sourceKindLabel(d.source_kind) : '';
  });
  protected readonly importedDate = computed(() => {
    const d = this.doc();
    return d ? formatProvenanceDate(d.created_at) : '';
  });

  protected onVisibleChange(next: boolean): void {
    if (!next) this.closed.emit();
  }

  protected async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard may be unavailable (non-secure context); ignore.
    }
  }
}
