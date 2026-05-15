import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { MultiSelect } from 'primeng/multiselect';
import { Select } from 'primeng/select';
import { SelectButton } from 'primeng/selectbutton';
import { ProgressSpinner } from 'primeng/progressspinner';
import { Toast } from 'primeng/toast';
import { Tooltip } from 'primeng/tooltip';

import {
  BullseyeDimension,
  COUNT_UNIT_OPTIONS,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  RingPhase,
  ViewMode,
} from '../../core/models/landscape.model';
import { ZoomLevel } from '../../core/models/dashboard.model';
import { CompanyService } from '../../core/services/company.service';
import { MarkerCategoryService } from '../../core/services/marker-category.service';
import { MechanismOfActionService } from '../../core/services/mechanism-of-action.service';
import { AssetService } from '../../core/services/asset.service';
import { RouteOfAdministrationService } from '../../core/services/route-of-administration.service';
import { TherapeuticAreaService } from '../../core/services/therapeutic-area.service';
import { LandscapeStateService } from './landscape-state.service';

interface SelectOption {
  label: string;
  value: string;
}

interface FilterChip {
  field: keyof LandscapeFilters;
  header: string;
  value: string;
  id: string;
}

@Component({
  selector: 'app-landscape-filter-bar',
  standalone: true,
  imports: [
    FormsModule,
    MultiSelect,
    Select,
    ButtonModule,
    SelectButton,
    ProgressSpinner,
    Toast,
    Tooltip,
  ],
  templateUrl: './landscape-filter-bar.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandscapeFilterBarComponent implements OnInit {
  private readonly companyService = inject(CompanyService);
  private readonly assetService = inject(AssetService);
  private readonly taService = inject(TherapeuticAreaService);
  private readonly moaService = inject(MechanismOfActionService);
  private readonly roaService = inject(RouteOfAdministrationService);
  private readonly markerCategoryService = inject(MarkerCategoryService);
  private readonly messageService = inject(MessageService);
  readonly state = inject(LandscapeStateService);

  private static readonly UNDO_TOAST_KEY = 'landscape-filter-undo';
  private static readonly UNDO_WINDOW_MS = 5000;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private undoSnapshot: LandscapeFilters | null = null;

  readonly spaceId = input.required<string>();
  readonly viewMode = input<ViewMode>('timeline');
  readonly dimension = input<BullseyeDimension>('therapeutic-area');
  readonly entityId = input<string | null>(null);
  readonly entityOptions = input<SelectOption[]>([]);
  readonly entityChange = output<string | null>();

  readonly countUnitOptions = COUNT_UNIT_OPTIONS;

  readonly loading = signal(true);
  readonly companyOptions = signal<SelectOption[]>([]);
  readonly productOptions = signal<SelectOption[]>([]);
  readonly taOptions = signal<SelectOption[]>([]);
  readonly moaOptions = signal<SelectOption[]>([]);
  readonly roaOptions = signal<SelectOption[]>([]);
  readonly markerCategoryOptions = signal<SelectOption[]>([]);

  readonly zoomOptions: { label: string; value: ZoomLevel; tooltip: string }[] = [
    { label: 'Y', value: 'yearly', tooltip: 'Yearly view' },
    { label: 'Q', value: 'quarterly', tooltip: 'Quarterly view' },
    { label: 'M', value: 'monthly', tooltip: 'Monthly view' },
    { label: 'D', value: 'daily', tooltip: 'Daily view' },
  ];

  readonly spokeModeOptions: { label: string; value: string }[] = [
    { label: 'Grouped', value: 'grouped' },
    { label: 'Assets', value: 'assets' },
  ];

  readonly phaseOptions: { label: string; value: RingPhase }[] = [
    { label: 'Pre-clinical', value: 'PRECLIN' },
    { label: 'PH 1', value: 'P1' },
    { label: 'PH 2', value: 'P2' },
    { label: 'PH 3', value: 'P3' },
    { label: 'PH 4', value: 'P4' },
    { label: 'Approved', value: 'APPROVED' },
    { label: 'Launched', value: 'LAUNCHED' },
  ];

  readonly statusOptions: SelectOption[] = [
    { label: 'Not yet recruiting', value: 'Not yet recruiting' },
    { label: 'Recruiting', value: 'Recruiting' },
    { label: 'Active, not recruiting', value: 'Active, not recruiting' },
    { label: 'Completed', value: 'Completed' },
    { label: 'Suspended', value: 'Suspended' },
    { label: 'Terminated', value: 'Terminated' },
    { label: 'Withdrawn', value: 'Withdrawn' },
  ];

  readonly studyTypeOptions: SelectOption[] = [
    { label: 'Interventional', value: 'Interventional' },
    { label: 'Observational', value: 'Observational' },
    { label: 'Expanded Access', value: 'Expanded Access' },
  ];

  readonly activeChips = computed<FilterChip[]>(() => {
    const f = this.state.filters();
    const chips: FilterChip[] = [];

    const addChips = (
      ids: string[],
      options: SelectOption[],
      field: keyof LandscapeFilters,
      header: string
    ) => {
      for (const id of ids) {
        const opt = options.find((o) => o.value === id);
        if (opt) chips.push({ field, header, value: opt.label, id });
      }
    };

    addChips(f.companyIds, this.companyOptions(), 'companyIds', 'Company');
    addChips(f.assetIds, this.productOptions(), 'assetIds', 'Asset');
    addChips(f.therapeuticAreaIds, this.taOptions(), 'therapeuticAreaIds', 'Therapy Area');
    addChips(f.mechanismOfActionIds, this.moaOptions(), 'mechanismOfActionIds', 'MOA');
    addChips(f.routeOfAdministrationIds, this.roaOptions(), 'routeOfAdministrationIds', 'ROA');
    addChips(f.markerCategoryIds, this.markerCategoryOptions(), 'markerCategoryIds', 'Category');

    for (const phase of f.phases) {
      const phaseLabel = this.phaseOptions.find((o) => o.value === phase)?.label ?? phase;
      chips.push({ field: 'phases', header: 'Phase', value: phaseLabel, id: phase });
    }
    for (const status of f.recruitmentStatuses) {
      chips.push({ field: 'recruitmentStatuses', header: 'Status', value: status, id: status });
    }
    for (const type of f.studyTypes) {
      chips.push({ field: 'studyTypes', header: 'Study Type', value: type, id: type });
    }

    return chips;
  });

  readonly hasAnyActive = computed(() => {
    const f = this.state.filters();
    return (
      f.companyIds.length > 0 ||
      f.assetIds.length > 0 ||
      f.therapeuticAreaIds.length > 0 ||
      f.mechanismOfActionIds.length > 0 ||
      f.routeOfAdministrationIds.length > 0 ||
      f.phases.length > 0 ||
      f.recruitmentStatuses.length > 0 ||
      f.studyTypes.length > 0 ||
      f.markerCategoryIds.length > 0
    );
  });

  /** Active-filter count for the "Clear filters (N)" button. Sum of all chip-bearing fields. */
  readonly activeFilterCount = computed(() => this.activeChips().length);

  protected readonly undoToastKey = LandscapeFilterBarComponent.UNDO_TOAST_KEY;

  async ngOnInit(): Promise<void> {
    const sid = this.spaceId();
    if (!sid) {
      this.loading.set(false);
      return;
    }
    try {
      const [companies, products, areas, moas, roas, markerCategories] = await Promise.all([
        this.companyService.list(sid),
        this.assetService.list(sid),
        this.taService.list(sid),
        this.moaService.list(sid),
        this.roaService.list(sid),
        this.markerCategoryService.list(sid),
      ]);
      this.companyOptions.set(companies.map((c) => ({ label: c.name, value: c.id })));
      this.productOptions.set(products.map((p) => ({ label: p.name, value: p.id })));
      this.taOptions.set(areas.map((a) => ({ label: a.name, value: a.id })));
      this.moaOptions.set(moas.map((m) => ({ label: m.name, value: m.id })));
      this.roaOptions.set(roas.map((r) => ({ label: r.name, value: r.id })));
      this.markerCategoryOptions.set(markerCategories.map((c) => ({ label: c.name, value: c.id })));
    } finally {
      this.loading.set(false);
    }
  }

  update<K extends keyof LandscapeFilters>(key: K, value: LandscapeFilters[K]): void {
    const safe = value ?? ([] as unknown as LandscapeFilters[K]);
    this.state.filters.update((f) => ({ ...f, [key]: safe }));
  }

  removeChip(chip: FilterChip): void {
    this.state.filters.update((f) => {
      const arr = [...(f[chip.field] as string[])];
      const idx = arr.indexOf(chip.id);
      if (idx >= 0) arr.splice(idx, 1);
      return { ...f, [chip.field]: arr };
    });
  }

  clearAll(): void {
    const before = this.state.filters();
    // Deep-ish clone: spread arrays so the undo snapshot is isolated.
    this.undoSnapshot = {
      companyIds: [...before.companyIds],
      assetIds: [...before.assetIds],
      trialIds: [...before.trialIds],
      therapeuticAreaIds: [...before.therapeuticAreaIds],
      mechanismOfActionIds: [...before.mechanismOfActionIds],
      routeOfAdministrationIds: [...before.routeOfAdministrationIds],
      phases: [...before.phases],
      recruitmentStatuses: [...before.recruitmentStatuses],
      studyTypes: [...before.studyTypes],
      markerCategoryIds: [...before.markerCategoryIds],
    };
    this.state.filters.set({ ...EMPTY_LANDSCAPE_FILTERS });

    this.messageService.clear(LandscapeFilterBarComponent.UNDO_TOAST_KEY);
    this.messageService.add({
      key: LandscapeFilterBarComponent.UNDO_TOAST_KEY,
      severity: 'success',
      summary: 'Filters cleared',
      detail: 'Click Undo to restore.',
      life: LandscapeFilterBarComponent.UNDO_WINDOW_MS,
    });

    if (this.undoTimer !== null) clearTimeout(this.undoTimer);
    this.undoTimer = setTimeout(() => {
      this.undoSnapshot = null;
      this.undoTimer = null;
    }, LandscapeFilterBarComponent.UNDO_WINDOW_MS);
  }

  /** Restore the snapshot taken at clear time, if still within the undo window. */
  undoClear(): void {
    if (!this.undoSnapshot) return;
    this.state.filters.set(this.undoSnapshot);
    this.undoSnapshot = null;
    if (this.undoTimer !== null) {
      clearTimeout(this.undoTimer);
      this.undoTimer = null;
    }
    this.messageService.clear(LandscapeFilterBarComponent.UNDO_TOAST_KEY);
  }
}
