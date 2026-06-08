import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Dialog } from 'primeng/dialog';
import { Select } from 'primeng/select';
import { InputText } from 'primeng/inputtext';

import { SourceImportService, type SourceImportProposal } from './source-import.service';
import { IndicationService } from '../../core/services/indication.service';
import { MechanismOfActionService } from '../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../core/services/route-of-administration.service';
import { FormFieldComponent } from '../../shared/components/form-field.component';
import { FormActionsComponent } from '../../shared/components/form-actions.component';
import { AssetEditFormComponent } from '../manage/assets/asset-edit-form.component';
import { TrialEditFormComponent } from '../manage/trials/trial-edit-form.component';
import { PHASE_DESCRIPTORS } from '../../core/models/phase-colors';
import {
  type FormOption,
  assetOptionsFromProposal,
  companyOptionsFromProposal,
  matchOptionsFor,
  currentMatchId,
  applyMatchOverride,
  proposalCompanyToForm,
  applyCompanyForm,
  proposalAssetToForm,
  applyAssetForm,
  proposalTrialToForm,
  applyTrialForm,
} from './review-edit.logic';

type ReviewEntityType = 'companies' | 'assets' | 'trials';

const ENTITY_LABEL: Record<ReviewEntityType, string> = {
  companies: 'company',
  assets: 'asset',
  trials: 'trial',
};

/**
 * Review-side edit dialog. Given an entity {type, index} from the import
 * proposal, renders the Match control plus the matching presentational form body
 * (asset / trial reuse the Manage form bodies; company is two simple fields since
 * the proposal only carries name + website). Options come from the proposal
 * (space records union proposed entities); indication / MOA / ROA values are by
 * NAME because the import commit resolves them by name. On Save it applies the
 * match override then the field mapping and writes the next proposal back to
 * SourceImportService.
 */
@Component({
  selector: 'app-review-edit-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    Dialog,
    Select,
    InputText,
    FormFieldComponent,
    FormActionsComponent,
    AssetEditFormComponent,
    TrialEditFormComponent,
  ],
  template: `
    <p-dialog
      [visible]="visible()"
      (visibleChange)="onVisibleChange($event)"
      [header]="headerLabel()"
      [modal]="true"
      styleClass="!w-[34rem]"
      [closeOnEscape]="true"
    >
      @if (type(); as t) {
        <form (ngSubmit)="save()" novalidate>
          <!-- Match control: create-new vs a fuzzy candidate -->
          @if (matchOptions().length > 1) {
            <app-form-field label="Match" fieldId="review-edit-match">
              <p-select
                inputId="review-edit-match"
                [options]="matchOptions()"
                optionLabel="name"
                optionValue="id"
                [(ngModel)]="matchId"
                name="match"
                styleClass="w-full"
                appendTo="body"
              />
              <p class="mt-1 text-[11px] text-slate-500">
                Link to an existing record, or create a new one from this proposal.
              </p>
            </app-form-field>
          }

          @switch (t) {
            @case ('companies') {
              <app-form-field
                label="Name"
                fieldId="review-edit-company-name"
                [required]="true"
                [error]="companyNameInvalid() ? 'Name is required.' : null"
              >
                <input
                  pInputText
                  id="review-edit-company-name"
                  name="companyName"
                  class="w-full"
                  [(ngModel)]="companyName"
                  (blur)="companyNameBlurred.set(true)"
                />
              </app-form-field>
              <app-form-field label="Website" fieldId="review-edit-company-website">
                <input
                  pInputText
                  id="review-edit-company-website"
                  name="companyWebsite"
                  class="w-full"
                  [(ngModel)]="companyWebsite"
                  placeholder="https://..."
                />
              </app-form-field>
            }
            @case ('assets') {
              <app-asset-edit-form
                [(name)]="assetName"
                [(genericName)]="assetGenericName"
                [(companyId)]="assetCompanyId"
                [(moaIds)]="assetMoa"
                [(roaIds)]="assetRoa"
                [companyOptions]="companyOptions()"
                [moaOptions]="moaOptions()"
                [roaOptions]="roaOptions()"
                [showDisplayOrder]="false"
                [showLogoUrl]="false"
              />
            }
            @case ('trials') {
              <app-trial-edit-form
                [(name)]="trialName"
                [(identifier)]="trialIdentifier"
                [(assetIds)]="trialAssetIds"
                [(primaryAssetId)]="trialPrimaryId"
                [(indicationIds)]="trialIndications"
                [(phaseType)]="trialPhase"
                [(phaseStart)]="trialPhaseStart"
                [(phaseEnd)]="trialPhaseEnd"
                [assetOptions]="assetOptions()"
                [indicationOptions]="indicationOptions()"
                [phaseOptions]="phaseOptions"
                [identifierReadonly]="true"
              />
            }
          }

          <app-form-actions submitLabel="Save" (cancelled)="close()" />
        </form>
      }
    </p-dialog>
  `,
})
export class ReviewEditDialogComponent {
  private readonly sourceImportService = inject(SourceImportService);
  private readonly indicationService = inject(IndicationService);
  private readonly moaService = inject(MechanismOfActionService);
  private readonly roaService = inject(RouteOfAdministrationService);

  readonly type = input<ReviewEntityType | null>(null);
  readonly index = input<number | null>(null);
  readonly spaceId = input<string>('');
  readonly closed = output<void>();

  protected readonly phaseOptions: FormOption[] = PHASE_DESCRIPTORS.map((d) => ({
    id: d.key,
    name: d.label,
  }));

  protected readonly matchId = signal<string>('__new__');

  // Company form fields.
  protected readonly companyName = signal<string>('');
  protected readonly companyWebsite = signal<string | null>(null);
  protected readonly companyNameBlurred = signal(false);
  protected readonly companyNameInvalid = computed(
    () => this.companyNameBlurred() && this.companyName().trim().length === 0,
  );

  // Asset form fields.
  protected readonly assetName = signal<string>('');
  protected readonly assetGenericName = signal<string>('');
  protected readonly assetCompanyId = signal<string | null>(null);
  protected readonly assetMoa = signal<string[]>([]);
  protected readonly assetRoa = signal<string[]>([]);

  // Trial form fields.
  protected readonly trialName = signal<string>('');
  protected readonly trialIdentifier = signal<string | null>(null);
  protected readonly trialAssetIds = signal<string[]>([]);
  protected readonly trialPrimaryId = signal<string | null>(null);
  protected readonly trialIndications = signal<string[]>([]);
  protected readonly trialPhase = signal<string | null>(null);
  protected readonly trialPhaseStart = signal<string | null>(null);
  protected readonly trialPhaseEnd = signal<string | null>(null);

  // Space ref-data (names) loaded per open; unioned with proposed values.
  private readonly spaceIndications = signal<string[]>([]);
  private readonly spaceMoa = signal<string[]>([]);
  private readonly spaceRoa = signal<string[]>([]);

  protected readonly visible = computed(() => this.type() !== null && this.index() !== null);

  protected readonly headerLabel = computed(() => {
    const t = this.type();
    return t ? `Edit ${ENTITY_LABEL[t]}` : 'Edit';
  });

  private readonly proposal = computed(() => this.sourceImportService.proposal());

  protected readonly companyOptions = computed<FormOption[]>(() => {
    const p = this.proposal();
    return p ? companyOptionsFromProposal(p) : [];
  });

  protected readonly assetOptions = computed<FormOption[]>(() => {
    const p = this.proposal();
    return p ? assetOptionsFromProposal(p) : [];
  });

  protected readonly matchOptions = computed<FormOption[]>(() => {
    const p = this.proposal();
    const t = this.type();
    const i = this.index();
    if (!p || !t || i === null) return [];
    return matchOptionsFor(t, i, p);
  });

  protected readonly indicationOptions = computed<FormOption[]>(() =>
    this.nameOptions(this.spaceIndications(), this.trialIndications()),
  );

  protected readonly moaOptions = computed<FormOption[]>(() =>
    this.nameOptions(this.spaceMoa(), this.assetMoa()),
  );

  protected readonly roaOptions = computed<FormOption[]>(() =>
    this.nameOptions(this.spaceRoa(), this.assetRoa()),
  );

  /** Union of space names and currently selected names, as {id:name, name} options. */
  private nameOptions(space: string[], selected: string[]): FormOption[] {
    const seen = new Set<string>();
    const out: FormOption[] = [];
    for (const name of [...space, ...selected]) {
      if (!name || seen.has(name)) continue;
      seen.add(name);
      out.push({ id: name, name });
    }
    return out;
  }

  constructor() {
    // Seed the form from the proposal whenever a new target opens.
    effect(() => {
      const t = this.type();
      const i = this.index();
      const p = this.proposal();
      if (!t || i === null || !p) return;

      this.matchId.set(currentMatchId(t, i, p));

      if (t === 'companies') {
        const v = proposalCompanyToForm(i, p);
        this.companyName.set(v.name);
        this.companyWebsite.set(v.website);
        this.companyNameBlurred.set(false);
      } else if (t === 'assets') {
        const v = proposalAssetToForm(i, p);
        this.assetName.set(v.name);
        this.assetGenericName.set(v.genericName ?? '');
        this.assetCompanyId.set(v.companyId);
        this.assetMoa.set(v.moa);
        this.assetRoa.set(v.roa);
      } else {
        const v = proposalTrialToForm(i, p);
        this.trialName.set(v.name);
        this.trialIdentifier.set(v.identifier);
        this.trialAssetIds.set(v.assetIds);
        this.trialPrimaryId.set(v.primaryAssetId);
        this.trialIndications.set(v.indications);
        this.trialPhase.set(v.phase);
        this.trialPhaseStart.set(v.phaseStart);
        this.trialPhaseEnd.set(v.phaseEnd);
      }

      void this.loadRefData(this.spaceId());
    });
  }

  private async loadRefData(spaceId: string): Promise<void> {
    if (!spaceId) return;
    try {
      const [inds, moas, roas] = await Promise.all([
        this.indicationService.list(spaceId),
        this.moaService.list(spaceId),
        this.roaService.list(spaceId),
      ]);
      this.spaceIndications.set(inds.map((i) => i.name));
      this.spaceMoa.set(moas.map((m) => m.name));
      this.spaceRoa.set(roas.map((r) => r.name));
    } catch {
      // Options fall back to the proposed values only.
    }
  }

  protected onVisibleChange(visible: boolean): void {
    if (!visible) this.close();
  }

  protected close(): void {
    this.closed.emit();
  }

  protected save(): void {
    const t = this.type();
    const i = this.index();
    const p = this.proposal();
    if (!t || i === null || !p) return;

    let next = applyMatchOverride(t, i, this.matchId(), p) as unknown as SourceImportProposal;

    if (t === 'companies') {
      next = applyCompanyForm(
        { name: this.companyName().trim(), website: this.companyWebsite() },
        i,
        next,
      ) as unknown as SourceImportProposal;
    } else if (t === 'assets') {
      next = applyAssetForm(
        {
          name: this.assetName().trim(),
          genericName: this.assetGenericName().trim() || null,
          companyId: this.assetCompanyId(),
          moa: this.assetMoa(),
          roa: this.assetRoa(),
        },
        i,
        next,
      ) as unknown as SourceImportProposal;
    } else {
      next = applyTrialForm(
        {
          name: this.trialName().trim(),
          identifier: this.trialIdentifier(),
          assetIds: this.trialAssetIds(),
          primaryAssetId: this.trialPrimaryId(),
          indications: this.trialIndications(),
          phase: this.trialPhase(),
          phaseStart: this.trialPhaseStart(),
          phaseEnd: this.trialPhaseEnd(),
        },
        i,
        next,
      ) as unknown as SourceImportProposal;
    }

    this.sourceImportService.setProposal(next);
    this.close();
  }
}
