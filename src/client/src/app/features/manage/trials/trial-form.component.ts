import { DatePipe } from '@angular/common';
import { Component, input, output, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { InputText } from 'primeng/inputtext';
import { InputNumber } from 'primeng/inputnumber';
import { Select } from 'primeng/select';
import { MultiSelect } from 'primeng/multiselect';
import { Textarea } from 'primeng/textarea';
import { Checkbox } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';

import { Trial } from '../../../core/models/trial.model';
import { Product } from '../../../core/models/product.model';
import { TherapeuticArea } from '../../../core/models/trial.model';
import { TrialService } from '../../../core/services/trial.service';
import { ProductService } from '../../../core/services/product.service';
import { TherapeuticAreaService } from '../../../core/services/therapeutic-area.service';
import { CtgovSyncService } from '../../../core/services/ctgov-sync.service';
import { FormFieldComponent } from '../../../shared/components/form-field.component';
import { FormActionsComponent } from '../../../shared/components/form-actions.component';
import { SectionCardComponent } from '../../../shared/components/section-card.component';

@Component({
  selector: 'app-trial-form',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    InputText,
    InputNumber,
    Select,
    MultiSelect,
    Textarea,
    Checkbox,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
    FormActionsComponent,
    SectionCardComponent,
  ],
  templateUrl: './trial-form.component.html',
})
export class TrialFormComponent implements OnInit {
  readonly trial = input<Trial | null>(null);
  readonly preselectedProductId = input<string | null>(null);
  readonly saved = output<void>();
  readonly cancelled = output<void>();

  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private therapeuticAreaService = inject(TherapeuticAreaService);
  private ctgovService = inject(CtgovSyncService);
  private messageService = inject(MessageService);
  private route = inject(ActivatedRoute);

  readonly statusOptions = [
    { label: 'Active', value: 'Active' },
    { label: 'Completed', value: 'Completed' },
    { label: 'Terminated', value: 'Terminated' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Withdrawn', value: 'Withdrawn' },
  ];

  readonly studyTypeOptions = [
    { label: 'Interventional', value: 'Interventional' },
    { label: 'Observational', value: 'Observational' },
    { label: 'Expanded Access', value: 'Expanded Access' },
  ];

  readonly phaseOptions = [
    { label: 'Early Phase 1', value: 'Early Phase 1' },
    { label: 'Phase 1', value: 'Phase 1' },
    { label: 'Phase 2', value: 'Phase 2' },
    { label: 'Phase 3', value: 'Phase 3' },
    { label: 'Phase 4', value: 'Phase 4' },
    { label: 'N/A', value: 'N/A' },
  ];

  readonly maskingOptions = [
    { label: 'None (Open Label)', value: 'None (Open Label)' },
    { label: 'Single', value: 'Single' },
    { label: 'Double', value: 'Double' },
    { label: 'Triple', value: 'Triple' },
    { label: 'Quadruple', value: 'Quadruple' },
  ];

  readonly purposeOptions = [
    { label: 'Treatment', value: 'Treatment' },
    { label: 'Prevention', value: 'Prevention' },
    { label: 'Diagnostic', value: 'Diagnostic' },
    { label: 'Screening', value: 'Screening' },
    { label: 'Supportive Care', value: 'Supportive Care' },
    { label: 'Health Services Research', value: 'Health Services Research' },
    { label: 'Basic Science', value: 'Basic Science' },
  ];

  readonly sexOptions = [
    { label: 'All', value: 'All' },
    { label: 'Female', value: 'Female' },
    { label: 'Male', value: 'Male' },
  ];

  readonly fdaDesignationOptions = [
    { label: 'Fast Track', value: 'Fast Track' },
    { label: 'Breakthrough Therapy', value: 'Breakthrough Therapy' },
    { label: 'Priority Review', value: 'Priority Review' },
    { label: 'Accelerated Approval', value: 'Accelerated Approval' },
  ];

  readonly phaseTypeOptions = [
    { label: 'Phase 1', value: 'P1' },
    { label: 'Phase 2', value: 'P2' },
    { label: 'Phase 3', value: 'P3' },
    { label: 'Phase 4', value: 'P4' },
    { label: 'Phase 1/2', value: 'P1_2' },
    { label: 'Phase 2/3', value: 'P2_3' },
    { label: 'Observational', value: 'OBS' },
  ];

  products = signal<Product[]>([]);
  therapeuticAreas = signal<TherapeuticArea[]>([]);
  saving = signal(false);
  syncing = signal(false);
  error = signal<string | null>(null);

  phaseType = signal<string | null>(null);
  phaseStartDate = signal<string | null>(null);
  phaseEndDate = signal<string | null>(null);

  // basic fields
  name = '';
  identifier = '';
  productId = '';
  therapeuticAreaId = '';
  sampleSize: number | null = null;
  status = '';
  notes = '';
  displayOrder = 0;

  // CT.gov dimensions
  studyType = '';
  phase = '';
  designMasking = '';
  designPrimaryPurpose = '';
  interventionType = '';
  interventionName = '';
  eligibilitySex = '';
  eligibilityMinAge = '';
  eligibilityMaxAge = '';
  acceptsHealthyVolunteers = false;
  hasDmc = false;
  isFdaRegulatedDrug = false;
  isFdaRegulatedDevice = false;
  fdaDesignations: string[] = [];
  leadSponsor = '';
  recruitmentStatus = '';
  startDateStr = '';
  primaryCompletionDateStr = '';
  ctgovLastSyncedAt = '';

  get isNctId(): boolean {
    return /^NCT\d{8}$/i.test(this.identifier.trim());
  }

  ngOnInit(): void {
    this.loadDropdowns();
    const preselected = this.preselectedProductId();
    if (preselected) {
      this.productId = preselected;
    }
    const existing = this.trial();
    if (existing) {
      this.name = existing.name;
      this.identifier = existing.identifier ?? '';
      this.productId = existing.product_id;
      this.therapeuticAreaId = existing.therapeutic_area_id;
      this.sampleSize = existing.sample_size;
      this.status = existing.status ?? '';
      this.notes = existing.notes ?? '';
      this.displayOrder = existing.display_order;
      this.studyType = existing.study_type ?? '';
      this.phase = existing.phase ?? '';
      this.designMasking = existing.design_masking ?? '';
      this.designPrimaryPurpose = existing.design_primary_purpose ?? '';
      this.interventionType = existing.intervention_type ?? '';
      this.interventionName = existing.intervention_name ?? '';
      this.eligibilitySex = existing.eligibility_sex ?? '';
      this.eligibilityMinAge = existing.eligibility_min_age ?? '';
      this.eligibilityMaxAge = existing.eligibility_max_age ?? '';
      this.acceptsHealthyVolunteers = existing.accepts_healthy_volunteers ?? false;
      this.hasDmc = existing.has_dmc ?? false;
      this.isFdaRegulatedDrug = existing.is_fda_regulated_drug ?? false;
      this.isFdaRegulatedDevice = existing.is_fda_regulated_device ?? false;
      this.fdaDesignations = existing.fda_designations ?? [];
      this.leadSponsor = existing.lead_sponsor ?? '';
      this.recruitmentStatus = existing.recruitment_status ?? '';
      this.startDateStr = existing.start_date ?? '';
      this.primaryCompletionDateStr = existing.primary_completion_date ?? '';
      this.ctgovLastSyncedAt = existing.ctgov_last_synced_at ?? '';
      this.phaseType.set(existing.phase_type ?? null);
      this.phaseStartDate.set(existing.phase_start_date ?? null);
      this.phaseEndDate.set(existing.phase_end_date ?? null);
    }
  }

  async syncFromCtgov(): Promise<void> {
    if (!this.isNctId) return;
    this.syncing.set(true);
    this.error.set(null);
    try {
      const mapped = await this.ctgovService.fetchAndMap(this.identifier.trim());
      if (mapped.name) this.name = mapped.name;
      if (mapped.sample_size) this.sampleSize = mapped.sample_size;
      if (mapped.recruitment_status) this.recruitmentStatus = mapped.recruitment_status;
      if (mapped.study_type) this.studyType = mapped.study_type;
      if (mapped.phase) this.phase = mapped.phase;
      if (mapped.design_masking) this.designMasking = mapped.design_masking;
      if (mapped.design_primary_purpose) this.designPrimaryPurpose = mapped.design_primary_purpose;
      if (mapped.intervention_type) this.interventionType = mapped.intervention_type;
      if (mapped.intervention_name) this.interventionName = mapped.intervention_name;
      if (mapped.eligibility_sex) this.eligibilitySex = mapped.eligibility_sex;
      if (mapped.eligibility_min_age) this.eligibilityMinAge = mapped.eligibility_min_age;
      if (mapped.eligibility_max_age) this.eligibilityMaxAge = mapped.eligibility_max_age;
      if (mapped.accepts_healthy_volunteers != null)
        this.acceptsHealthyVolunteers = mapped.accepts_healthy_volunteers;
      if (mapped.has_dmc != null) this.hasDmc = mapped.has_dmc;
      if (mapped.is_fda_regulated_drug != null)
        this.isFdaRegulatedDrug = mapped.is_fda_regulated_drug;
      if (mapped.is_fda_regulated_device != null)
        this.isFdaRegulatedDevice = mapped.is_fda_regulated_device;
      if (mapped.lead_sponsor) this.leadSponsor = mapped.lead_sponsor;
      if (mapped.start_date) this.startDateStr = mapped.start_date;
      if (mapped.primary_completion_date)
        this.primaryCompletionDateStr = mapped.primary_completion_date;
      this.ctgovLastSyncedAt = new Date().toISOString();
      this.messageService.add({
        severity: 'success',
        summary: 'Synced from ClinicalTrials.gov.',
        life: 3000,
      });
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not sync from ClinicalTrials.gov. Verify the NCT ID and try again.'
      );
    } finally {
      this.syncing.set(false);
    }
  }

  private async loadDropdowns(): Promise<void> {
    try {
      const sid = this.route.snapshot.paramMap.get('spaceId')!;
      const [products, areas] = await Promise.all([
        this.productService.list(sid),
        this.therapeuticAreaService.list(sid),
      ]);
      this.products.set(products);
      this.therapeuticAreas.set(areas);
    } catch {
      this.error.set(
        'Could not load products and therapeutic areas. Check your connection and try again.'
      );
    }
  }

  async onSubmit(): Promise<void> {
    if (!this.name.trim()) return;

    this.saving.set(true);
    this.error.set(null);

    try {
      const payload: Partial<Trial> = {
        name: this.name,
        identifier: this.identifier || null,
        product_id: this.productId || undefined,
        therapeutic_area_id: this.therapeuticAreaId || undefined,
        sample_size: this.sampleSize,
        status: this.status || null,
        notes: this.notes || null,
        display_order: this.displayOrder,
        study_type: this.studyType || null,
        phase: this.phase || null,
        design_masking: this.designMasking || null,
        design_primary_purpose: this.designPrimaryPurpose || null,
        intervention_type: this.interventionType || null,
        intervention_name: this.interventionName || null,
        eligibility_sex: this.eligibilitySex || null,
        eligibility_min_age: this.eligibilityMinAge || null,
        eligibility_max_age: this.eligibilityMaxAge || null,
        accepts_healthy_volunteers: this.acceptsHealthyVolunteers,
        has_dmc: this.hasDmc,
        is_fda_regulated_drug: this.isFdaRegulatedDrug,
        is_fda_regulated_device: this.isFdaRegulatedDevice,
        fda_designations: this.fdaDesignations.length > 0 ? this.fdaDesignations : null,
        lead_sponsor: this.leadSponsor || null,
        recruitment_status: this.recruitmentStatus || null,
        start_date: this.startDateStr || null,
        primary_completion_date: this.primaryCompletionDateStr || null,
        ctgov_last_synced_at: this.ctgovLastSyncedAt || null,
        phase_type: this.phaseType() || null,
        phase_start_date: this.phaseStartDate() || null,
        phase_end_date: this.phaseEndDate() || null,
      };

      const existing = this.trial();
      if (existing) {
        await this.trialService.update(existing.id, payload);
      } else {
        const spaceId = this.route.snapshot.paramMap.get('spaceId')!;
        await this.trialService.create(spaceId, payload);
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not save trial. Check your connection and try again.'
      );
    } finally {
      this.saving.set(false);
    }
  }
}
