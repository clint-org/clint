import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';

import { SourceDocumentDrawerComponent } from './source-document-drawer.component';
import { SourceProvenance } from './source-provenance.model';
import { SourceProvenanceService } from './source-provenance.service';
import { provenanceTooltip } from './source-provenance.util';

/**
 * Quiet inline affordance for tracing how an AI-imported entity landed.
 *
 * Renders only when the entity carries a source_doc_id AND the viewer may see
 * provenance (owners/editors). Shows a compact uppercase "IMPORTED" chip;
 * hovering reveals "Imported from <title> · <date>" and clicking opens a
 * read-only drawer with the original ingested source. Manual entities (no
 * source_doc_id) and viewers render nothing -- it stays quiet.
 */
@Component({
  selector: 'app-source-provenance-line',
  imports: [SourceDocumentDrawerComponent, TooltipModule],
  template: `
    @if (doc(); as d) {
      <button
        type="button"
        class="group inline-flex items-center gap-1.5 rounded-sm border border-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
        [pTooltip]="tooltip()"
        tooltipPosition="top"
        (click)="drawerOpen.set(true)"
        [attr.aria-label]="tooltip()"
      >
        <i
          class="fa-solid fa-file-import text-[9px] text-slate-400 group-hover:text-slate-600"
          aria-hidden="true"
        ></i>
        Imported
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

  protected readonly tooltip = computed(() => provenanceTooltip(this.doc()));

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
