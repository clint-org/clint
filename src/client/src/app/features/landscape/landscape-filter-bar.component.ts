import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelect } from 'primeng/multiselect';
import { SelectButton } from 'primeng/selectbutton';

import {
  BullseyeDimension,
  BullseyeProduct,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  RingPhase,
} from '../../core/models/landscape.model';
import { MechanismOfActionService } from '../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../core/services/route-of-administration.service';

interface SelectOption {
  label: string;
  value: string;
}

@Component({
  selector: 'app-landscape-filter-bar',
  standalone: true,
  imports: [FormsModule, MultiSelect, ButtonModule, SelectButton],
  templateUrl: './landscape-filter-bar.component.html',
})
export class LandscapeFilterBarComponent implements OnInit {
  private readonly moaService = inject(MechanismOfActionService);
  private readonly roaService = inject(RouteOfAdministrationService);

  readonly spaceId = input.required<string>();
  readonly products = input.required<BullseyeProduct[]>();
  readonly filters = input.required<LandscapeFilters>();
  readonly dimension = input<BullseyeDimension>('therapeutic-area');
  readonly filtersChange = output<LandscapeFilters>();

  readonly moaOptions = signal<SelectOption[]>([]);
  readonly roaOptions = signal<SelectOption[]>([]);

  readonly companyOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const p of this.products()) {
      if (!seen.has(p.company_id)) seen.set(p.company_id, p.company_name);
    }
    return Array.from(seen, ([value, label]) => ({ label, value }));
  });

  readonly productOptions = computed(() =>
    this.products().map((p) => ({ label: p.name, value: p.id }))
  );

  readonly phaseOptions: { label: string; value: RingPhase }[] = [
    { label: 'P1', value: 'P1' },
    { label: 'P2', value: 'P2' },
    { label: 'P3', value: 'P3' },
    { label: 'Appr', value: 'APPROVED' },
  ];

  readonly statusOptions = computed(() => {
    const seen = new Set<string>();
    for (const p of this.products()) {
      for (const t of p.trials ?? []) {
        if (t.recruitment_status) seen.add(t.recruitment_status);
      }
    }
    return Array.from(seen)
      .sort()
      .map((v) => ({ label: v, value: v }));
  });

  readonly studyTypeOptions = computed(() => {
    const seen = new Set<string>();
    for (const p of this.products()) {
      for (const t of p.trials ?? []) {
        if (t.study_type) seen.add(t.study_type);
      }
    }
    return Array.from(seen)
      .sort()
      .map((v) => ({ label: v, value: v }));
  });

  async ngOnInit(): Promise<void> {
    const spaceId = this.spaceId();
    if (!spaceId) return;
    const [moas, roas] = await Promise.all([
      this.moaService.list(spaceId),
      this.roaService.list(spaceId),
    ]);
    this.moaOptions.set(moas.map((m) => ({ label: m.name, value: m.id })));
    this.roaOptions.set(roas.map((r) => ({ label: r.name, value: r.id })));
  }

  update<K extends keyof LandscapeFilters>(key: K, value: LandscapeFilters[K]): void {
    // PrimeNG MultiSelect clear() emits null; coalesce to empty array so
    // downstream .length checks never crash on null.
    const safe = value ?? ([] as unknown as LandscapeFilters[K]);
    this.filtersChange.emit({ ...this.filters(), [key]: safe });
  }

  clearAll(): void {
    this.filtersChange.emit({ ...EMPTY_LANDSCAPE_FILTERS });
  }

  get hasAnyActive(): boolean {
    const f = this.filters();
    return (
      f.mechanismOfActionIds.length > 0 ||
      f.routeOfAdministrationIds.length > 0 ||
      f.companyIds.length > 0 ||
      f.productIds.length > 0 ||
      f.phases.length > 0 ||
      f.recruitmentStatuses.length > 0 ||
      f.studyTypes.length > 0
    );
  }
}
