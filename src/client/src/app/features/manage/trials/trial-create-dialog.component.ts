import { Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { Dialog } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';

import { TrialService } from '../../../core/services/trial.service';
import { ProductService } from '../../../core/services/product.service';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import { ChangeEventService } from '../../../core/services/change-event.service';

interface SelectOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-trial-create-dialog',
  standalone: true,
  imports: [Dialog, ButtonModule, InputTextModule, Select, FormsModule],
  templateUrl: './trial-create-dialog.component.html',
})
export class TrialCreateDialogComponent {
  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private taService = inject(TherapeuticAreaService);
  private changeEventService = inject(ChangeEventService);
  private messageService = inject(MessageService);

  visible = input<boolean>(false);
  visibleChange = output<boolean>();
  spaceId = input.required<string>();
  saved = output<{ trialId: string }>();

  // Form fields are signals because they participate in the isValid() computed
  // and are bound via [ngModel]+(ngModelChange) instead of [(ngModel)] for the
  // signal-friendly one-way pattern.
  name = signal('');
  identifier = signal<string | null>(null);
  productId = signal<string | null>(null);
  therapeuticAreaId = signal<string | null>(null);

  products = signal<SelectOption[]>([]);
  therapeuticAreas = signal<SelectOption[]>([]);

  saving = signal(false);

  // Autopopulate state for the NCT-first flow. The dialog opens with focus on
  // the NCT input; on a valid NCT format (NCT + 8 digits) we hit
  // CT.gov v2 and seed the Name field with the official acronym (or briefTitle
  // as fallback). The user can overwrite. nctLookupError surfaces 404s
  // inline so users know to fix the NCT before saving instead of finding out
  // when Sync fails post-create.
  protected readonly nctLookupState = signal<'idle' | 'looking_up' | 'ok' | 'not_found' | 'error'>(
    'idle'
  );
  protected readonly nctLookupAcronym = signal<string | null>(null);
  // Toggled true once the user types into the Name field manually so the
  // autopopulate doesn't clobber their input on a subsequent NCT change.
  private readonly nameWasManuallyEdited = signal(false);

  protected readonly nctFormatValid = computed(() => {
    const id = this.identifier();
    if (!id) return true;
    return /^NCT\d{8}$/i.test(id.trim());
  });

  isValid = computed(() => {
    return (
      this.name().trim().length > 0 &&
      !!this.productId() &&
      !!this.therapeuticAreaId() &&
      this.nctFormatValid() &&
      this.nctLookupState() !== 'looking_up' &&
      this.nctLookupState() !== 'not_found'
    );
  });

  constructor() {
    // Load product + therapeutic-area options whenever spaceId changes.
    effect(() => {
      const sid = this.spaceId();
      if (!sid) return;
      void this.loadOptions(sid);
    });

    // Reset form when the dialog is closed.
    effect(() => {
      if (!this.visible()) {
        this.name.set('');
        this.identifier.set(null);
        this.productId.set(null);
        this.therapeuticAreaId.set(null);
        this.nctLookupState.set('idle');
        this.nctLookupAcronym.set(null);
        this.nameWasManuallyEdited.set(false);
      }
    });
  }

  /**
   * Called from (ngModelChange) on the NCT input. When the value parses as a
   * valid NCT, hit CT.gov for the acronym and seed Name. Aborts in-flight
   * lookups on subsequent changes so we don't race results out of order.
   */
  private lookupController: AbortController | null = null;
  protected onIdentifierChanged(value: string | null): void {
    this.identifier.set(value);
    this.nctLookupState.set('idle');
    this.nctLookupAcronym.set(null);
    if (this.lookupController) {
      this.lookupController.abort();
      this.lookupController = null;
    }
    if (!value) return;
    const trimmed = value.trim();
    if (!/^NCT\d{8}$/i.test(trimmed)) return;

    this.nctLookupState.set('looking_up');
    const controller = new AbortController();
    this.lookupController = controller;

    void (async () => {
      try {
        const res = await fetch(
          `https://clinicaltrials.gov/api/v2/studies/${encodeURIComponent(trimmed)}`,
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        if (res.status === 404) {
          this.nctLookupState.set('not_found');
          return;
        }
        if (!res.ok) {
          this.nctLookupState.set('error');
          return;
        }
        const study = (await res.json()) as {
          protocolSection?: {
            identificationModule?: { acronym?: string; briefTitle?: string };
          };
        };
        const acronym = study.protocolSection?.identificationModule?.acronym?.trim() ?? null;
        const briefTitle = study.protocolSection?.identificationModule?.briefTitle?.trim() ?? null;
        const display = acronym || briefTitle;
        this.nctLookupAcronym.set(acronym);
        this.nctLookupState.set('ok');
        if (display && !this.nameWasManuallyEdited()) {
          this.name.set(display);
        }
      } catch (e) {
        if ((e as { name?: string })?.name === 'AbortError') return;
        this.nctLookupState.set('error');
      }
    })();
  }

  protected onNameChanged(value: string): void {
    this.name.set(value);
    this.nameWasManuallyEdited.set(true);
  }

  private async loadOptions(spaceId: string): Promise<void> {
    const [products, tas] = await Promise.all([
      this.productService.list(spaceId),
      this.taService.list(spaceId),
    ]);
    this.products.set(products.map((p) => ({ id: p.id, name: p.name })));
    this.therapeuticAreas.set(tas.map((t) => ({ id: t.id, name: t.name })));
  }

  close(): void {
    this.visibleChange.emit(false);
  }

  async save(): Promise<void> {
    if (!this.isValid()) return;
    this.saving.set(true);
    try {
      const trial = await this.trialService.create(this.spaceId(), {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
        product_id: this.productId()!,
        therapeutic_area_id: this.therapeuticAreaId()!,
      });
      // Best-effort: kick off CT.gov sync if NCT was provided. Don't block the
      // save path on the sync result.
      if (trial.identifier) {
        this.changeEventService.triggerSingleTrialSync(trial.id).catch(() => undefined);
      }
      this.saved.emit({ trialId: trial.id });
      this.close();
      this.messageService.add({ severity: 'success', summary: 'Trial created.', life: 3000 });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not create trial',
        detail: e instanceof Error ? e.message : 'Check your connection and try again.',
        life: 4000,
      });
    } finally {
      this.saving.set(false);
    }
  }
}
