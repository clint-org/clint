import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';

import { SourceDocumentDrawerComponent } from './source-document-drawer.component';
import { SourceProvenance } from './source-provenance.model';
import { SourceProvenanceService } from './source-provenance.service';
import { formatProvenanceDate, provenanceTitle } from './source-provenance.util';

/**
 * Quiet inline affordance for tracing how an AI-imported entity landed.
 *
 * Renders only when the entity carries a source_doc_id AND the viewer may see
 * provenance (owners/editors). Reads "IMPORTED FROM <title> · <date>" and, on
 * click, opens a read-only drawer with the original ingested source. Manual
 * entities (no source_doc_id) and viewers render nothing -- it stays quiet.
 */
@Component({
  selector: 'app-source-provenance-line',
  imports: [SourceDocumentDrawerComponent],
  template: `
    @if (doc(); as d) {
      <button
        type="button"
        class="group inline-flex max-w-full items-center gap-1.5 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 transition-colors hover:text-slate-600"
        (click)="drawerOpen.set(true)"
        [attr.aria-label]="'View import source: ' + title()"
      >
        <span class="text-slate-400 group-hover:text-slate-500">Imported from</span>
        <span class="truncate normal-case text-slate-500 group-hover:text-slate-700">
          {{ title() }}
        </span>
        <span class="text-slate-300">·</span>
        <span class="tabular-nums text-slate-400">{{ dateLabel() }}</span>
        <i class="fa-solid fa-arrow-right text-[8px] text-slate-300 group-hover:text-slate-500"></i>
      </button>

      <app-source-document-drawer
        [doc]="d"
        [visible]="drawerOpen()"
        (closed)="drawerOpen.set(false)"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceProvenanceLineComponent {
  private readonly provenance = inject(SourceProvenanceService);

  /** The entity's source_doc_id. Null for manually created entities. */
  readonly sourceDocId = input<string | null>(null);
  /** Owners/editors only. Hosts pass their edit capability so viewers never fetch. */
  readonly canView = input<boolean>(true);

  protected readonly doc = signal<SourceProvenance | null>(null);
  protected readonly drawerOpen = signal<boolean>(false);

  protected readonly title = computed(() => provenanceTitle(this.doc()));
  protected readonly dateLabel = computed(() => {
    const d = this.doc();
    return d ? formatProvenanceDate(d.created_at) : '';
  });

  private readonly loadEffect = effect(() => {
    const id = this.sourceDocId();
    const allowed = this.canView();
    if (id && allowed) {
      void this.load(id);
    } else {
      this.doc.set(null);
      this.drawerOpen.set(false);
    }
  });

  private async load(id: string): Promise<void> {
    try {
      this.doc.set(await this.provenance.getSourceDocument(id));
    } catch {
      // Provenance is a quiet affordance; a denied or failed read just hides
      // the line rather than surfacing an error.
      this.doc.set(null);
    }
  }
}
