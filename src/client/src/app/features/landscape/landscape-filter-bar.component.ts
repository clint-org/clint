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
import { ButtonModule } from 'primeng/button';
import { MultiSelect } from 'primeng/multiselect';
import { Select } from 'primeng/select';
import { SelectButton } from 'primeng/selectbutton';
import { ProgressSpinner } from 'primeng/progressspinner';

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
  imports: [FormsModule, MultiSelect, Select, ButtonModule, SelectButton, ProgressSpinner],
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
  readonly state = inject(LandscapeStateService);

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

  readonly zoomOptions: { label: string; value: ZoomLevel }[] = [
    { label: 'Y', value: 'yearly' },
    { label: 'Q', value: 'quarterly' },
    { label: 'M', value: 'monthly' },
    { label: 'D', value: 'daily' },
  ];

  readonly spokeModeOptions: { label: string; value: string }[] = [
    { label: 'Grouped', value: 'grouped' },
    { label: 'Assets', value: 'assets' },
  ];

  readonly phaseOptions: { label: string; value: RingPhase }[] = [
    { label: 'Pre-clinical', value: 'PRECLIN' },
    { label: 'Phase I', value: 'P1' },
    { label: 'Phase II', value: 'P2' },
    { label: 'Phase III', value: 'P3' },
    { label: 'Phase IV', value: 'P4' },
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
    this.state.filters.set({ ...EMPTY_LANDSCAPE_FILTERS });
  }
}
