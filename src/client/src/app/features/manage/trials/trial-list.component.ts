import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { FormsModule } from '@angular/forms';
import { SelectModule } from 'primeng/select';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageModule } from 'primeng/message';

import { Trial } from '../../../core/models/trial.model';
import { Asset } from '../../../core/models/asset.model';
import { Company } from '../../../core/models/company.model';
import {
  CTGOV_FIELD_CATALOGUE,
  CTGOV_TRIAL_LIST_DEFAULT_PATHS,
} from '../../../core/models/ctgov-field.model';
import { TrialService } from '../../../core/services/trial.service';
import { AssetService } from '../../../core/services/asset.service';
import { CompanyService } from '../../../core/services/company.service';
import { SpaceFieldVisibilityService } from '../../../core/services/space-field-visibility.service';
import { formatCtgovFieldValue } from '../../../shared/utils/ctgov-field-format';
import { TrialCreateDialogComponent } from './trial-create-dialog.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { TableSkeletonBodyComponent } from '../../../shared/components/skeleton/table-skeleton-body.component';
import { HighlightPipe } from '../../../shared/pipes/highlight.pipe';
import { createGridState } from '../../../shared/grids';
import { confirmDelete } from '../../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';

interface TrialRow {
  readonly trial: Trial;
  readonly assetName: string;
  readonly assetId: string;
  readonly companyName: string;
  readonly companyId: string;
  readonly phaseCount: number;
  readonly markerCount: number;
}

@Component({
  selector: 'app-trial-list',
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    SelectModule,
    TableModule,
    ButtonModule,
    MessageModule,
    TrialCreateDialogComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    GridToolbarComponent,
    TableSkeletonBodyComponent,
    HighlightPipe,
  ],
  templateUrl: './trial-list.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrialListComponent implements OnInit, OnDestroy {
  /**
   * Read the current value from a native `<input>` change/input event.
   * Used inside `p-column-filter` ng-templates to avoid `$any($event.target).value`
   * patterns that violate `template/no-any`.
   */
  protected filterInputValue(ev: Event): string {
    return (ev.target as HTMLInputElement).value;
  }

  private trialService = inject(TrialService);
  private assetService = inject(AssetService);
  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);

  // Surface "Add trial" only for space owners/editors. Effect re-runs when
  // canEdit() flips (initial role fetch resolves, or navigation between
  // spaces). Clears the action when the user lacks edit permission so the
  // topbar reflects current capability.
  private readonly topbarActionsEffect = effect(() => {
    if (this.spaceRole.canEdit()) {
      this.topbarState.actions.set([
        {
          label: 'Add trial',
          icon: 'fa-solid fa-plus',
          text: true,
          callback: () => this.openCreateModal(),
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });

  readonly spaceId = signal('');
  readonly tenantId = signal('');

  private readonly menuCache = new Map<string, MenuItem[]>();

  readonly trials = signal<Trial[]>([]);
  readonly products = signal<Asset[]>([]);
  readonly companies = signal<Company[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly creating = signal(false);

  // Per-space CT.gov field columns (trial_list_columns surface). Loaded once
  // alongside trials; falls back to CTGOV_TRIAL_LIST_DEFAULT_PATHS when the
  // space has not customized this surface. Cells are read-only -- existing
  // p-table sort/filter behavior on the static columns stays untouched.
  private readonly fieldVisibilityService = inject(SpaceFieldVisibilityService);
  private readonly perSpacePaths = signal<string[] | null>(null);
  private readonly snapshotsByTrial = signal<Map<string, unknown>>(new Map());

  readonly extraPaths = computed(() => this.perSpacePaths() ?? CTGOV_TRIAL_LIST_DEFAULT_PATHS);

  readonly extraColumns = computed(() => {
    return this.extraPaths()
      .map((path) => {
        const field = CTGOV_FIELD_CATALOGUE.find((f) => f.path === path);
        return field ? { path, label: field.label } : null;
      })
      .filter((c): c is { path: string; label: string } => c !== null);
  });

  readonly emptyColspan = computed(() => 8 + this.extraColumns().length);

  readonly skeletonCells = computed(() => {
    const base: { w: string; h?: string; class?: string }[] = [
      { w: '58%' },
      { w: '80px', h: '11px' },
      { w: '55%' },
      { w: '55%' },
      { w: '58px', h: '14px' },
      { w: '20px', class: 'col-num' },
      { w: '20px', class: 'col-num' },
    ];
    base.push(...this.extraColumns().map(() => ({ w: '60%' })));
    base.push({ w: '14px', class: 'col-actions' });
    return base;
  });

  readonly rows = computed<TrialRow[]>(() => {
    const productMap = new Map(this.products().map((p) => [p.id, p]));
    const companyMap = new Map(this.companies().map((c) => [c.id, c]));
    return this.trials().map((trial) => {
      const product = productMap.get(trial.product_id);
      const company = product ? companyMap.get(product.company_id) : undefined;
      return {
        trial,
        assetName: product?.name ?? '--',
        assetId: product?.id ?? '',
        companyName: company?.name ?? '--',
        companyId: company?.id ?? '',
        phaseCount: trial.phase_type ? 1 : 0,
        markerCount: trial.markers?.length ?? 0,
      };
    });
  });

  readonly grid = createGridState<TrialRow>({
    columns: [
      { field: 'trial.name', header: 'Trial', filter: { kind: 'text' } },
      { field: 'trial.identifier', header: 'NCT ID', filter: { kind: 'text' } },
      {
        field: 'trial.product_id',
        header: 'Asset',
        filter: {
          kind: 'select',
          options: () => this.products().map((p) => ({ label: p.name, value: p.id })),
        },
      },
      {
        field: 'companyId',
        header: 'Company',
        filter: {
          kind: 'select',
          options: () => this.companies().map((c) => ({ label: c.name, value: c.id })),
        },
      },
      {
        field: 'trial.status',
        header: 'Status',
        filter: {
          kind: 'select',
          options: () => {
            const seen = new Set<string>();
            for (const t of this.trials()) if (t.status) seen.add(t.status);
            return Array.from(seen)
              .sort()
              .map((s) => ({ label: s, value: s }));
          },
        },
      },
      { field: 'phaseCount', header: 'Phases', filter: { kind: 'numeric' } },
      { field: 'markerCount', header: 'Markers', filter: { kind: 'numeric' } },
    ],
    globalSearchFields: [
      'trial.name',
      'trial.identifier',
      'assetName',
      'companyName',
      'trial.status',
    ],
    defaultSort: { field: 'trial.name', order: 1 },
  });

  readonly visibleRows = this.grid.filteredRows(this.rows);

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.grid.totalRecords() || ''));
  });

  async ngOnInit(): Promise<void> {
    this.spaceId.set(this.route.snapshot.paramMap.get('spaceId')!);
    this.tenantId.set(this.route.snapshot.paramMap.get('tenantId')!);
    await this.loadData();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  rowMenu(row: TrialRow): MenuItem[] {
    const cached = this.menuCache.get(row.trial.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Open detail',
        icon: 'fa-solid fa-arrow-up-right-from-square',
        command: () => this.openDetail(row.trial),
      },
    ];
    if (this.spaceRole.canEdit()) {
      items.push(
        {
          label: 'Edit',
          icon: 'fa-solid fa-pen',
          command: () => this.openDetail(row.trial),
        },
        { separator: true },
        {
          label: 'Delete',
          icon: 'fa-solid fa-trash',
          styleClass: 'row-actions-danger',
          command: () => this.confirmDelete(row.trial),
        }
      );
    }
    this.menuCache.set(row.trial.id, items);
    return items;
  }

  openCreateModal(): void {
    this.creating.set(true);
  }

  onTrialCreated({ trialId }: { trialId: string }): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'manage', 'trials', trialId]);
  }

  openDetail(trial: Trial): void {
    this.router.navigate([
      '/t',
      this.tenantId(),
      's',
      this.spaceId(),
      'manage',
      'trials',
      trial.id,
    ]);
  }

  async confirmDelete(trial: Trial): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete trial',
      message: `Delete "${trial.name}"? This cannot be undone.`,
    });
    if (!ok) return;
    this.error.set(null);
    try {
      await this.trialService.delete(trial.id);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Trial deleted.', life: 3000 });
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not delete trial. Check your connection and try again.'
      );
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const spaceId = this.spaceId();
      const [trials, products, companies, visibilityMap, snapshots] = await Promise.all([
        this.trialService.listBySpace(spaceId),
        this.assetService.list(spaceId),
        this.companyService.list(spaceId),
        this.fieldVisibilityService.get(spaceId).catch(() => ({}) as Record<string, string[]>),
        this.trialService
          .getLatestSnapshotsForSpace(spaceId)
          .catch(() => new Map<string, unknown>()),
      ]);
      this.trials.set(trials);
      this.products.set(products);
      this.companies.set(companies);
      const paths = visibilityMap['trial_list_columns'];
      this.perSpacePaths.set(paths && paths.length > 0 ? paths : null);
      this.snapshotsByTrial.set(snapshots);
      this.menuCache.clear();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load trials');
    } finally {
      this.loading.set(false);
    }
  }

  extraValue(trialId: string, path: string): string {
    const snap = this.snapshotsByTrial().get(trialId);
    if (!snap) return '';
    return formatCtgovFieldValue(snap, path);
  }
}
