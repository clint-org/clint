import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  OnDestroy,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { PiMarkComponent } from '../../../shared/components/pi-mark/pi-mark.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { IntelligenceHistoryPanelComponent } from '../../../shared/components/intelligence-history-panel/intelligence-history-panel.component';
import { WithdrawIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/withdraw-dialog.component';
import { PurgeIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/purge-dialog.component';
import { IntelligenceHistoryHost } from '../../../shared/components/intelligence-history-panel/history-panel-host';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
import { TimelineViewComponent } from '../../landscape/timeline-view.component';
import { EntityMarkerDrawerComponent } from '../../landscape/entity-marker-drawer.component';
import { LandscapeStateService } from '../../landscape/landscape-state.service';
import { EntityEventsPanelComponent } from '../../../shared/components/entity-events-panel/entity-events-panel.component';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';
import { SourceProvenanceLineComponent } from '../../../shared/components/source-provenance/source-provenance-line.component';
import { EMPTY_LANDSCAPE_FILTERS } from '../../../core/models/landscape.model';

import { CompanyService } from '../../../core/services/company.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { TopbarStateService } from '../../../core/services/topbar-state.service';
import { Company } from '../../../core/models/company.model';
import { IntelligenceDetailBundle } from '../../../core/models/primary-intelligence.model';
import { SectionCardComponent } from '../../../shared/components/section-card.component';
import { ReferencedInPanelComponent } from '../../../shared/components/referenced-in-panel/referenced-in-panel.component';
import { CompanyFormComponent } from './company-form.component';
import { buildFilterQueryParams } from '../../../shared/grids';
import { buildEntityActionMenu } from '../../../shared/entity-actions/entity-action-menu';
import { runEntityDelete } from '../../../shared/entity-actions/run-entity-delete';

@Component({
  selector: 'app-company-detail',
  imports: [
    BrandLogoComponent,
    ConfirmDialogModule,
    Dialog,
    ToastModule,
    CompanyFormComponent,
    ManagePageShellComponent,
    IntelligenceBlockComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    IntelligenceHistoryPanelComponent,
    WithdrawIntelligenceDialogComponent,
    PurgeIntelligenceDialogComponent,
    PiMarkComponent,
    SectionCardComponent,
    ReferencedInPanelComponent,
    MaterialsSectionComponent,
    TimelineViewComponent,
    EntityMarkerDrawerComponent,
    EntityEventsPanelComponent,
    LoaderComponent,
    SourceProvenanceLineComponent,
  ],
  providers: [ConfirmationService, MessageService, LandscapeStateService],
  templateUrl: './company-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompanyDetailComponent implements OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private companyService = inject(CompanyService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);
  private topbarState = inject(TopbarStateService);
  protected readonly editingCompany = signal(false);

  // Route paramMap as a signal so companyId reacts to in-place navigation
  // when clicking a LINKED company chip on a company detail page (same route
  // config reuses this component instance).
  private readonly paramMapSig = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  protected readonly companyId = computed(() => this.paramMapSig().get('id') ?? '');
  protected readonly company = signal<Company | null>(null);
  protected readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly loading = signal(true);
  protected readonly legendVisible = signal(false);

  // Intelligence history (version list, withdraw / purge dialogs)
  protected readonly historyHost = new IntelligenceHistoryHost(this.intelligenceService);
  protected readonly withdrawDialogOpen = signal(false);
  protected readonly purgeDialogOpen = signal(false);
  protected readonly purgeAnchorMode = signal(false);
  protected readonly purgeTargetHeadline = signal('');
  protected readonly purgeTargetId = signal<string | null>(null);

  protected readonly hasIntelligence = computed(() => {
    const i = this.intelligence();
    return !!(i?.published || i?.draft);
  });

  protected readonly tenantIdSig = computed(() => this.findAncestorParam('tenantId') ?? '');
  protected readonly spaceIdSig = computed(() => this.findAncestorParam('spaceId') ?? '');

  // Header count badges for the events / materials cards, fed by each panel's
  // (loaded) output since those counts are fetched inside the child component.
  protected readonly eventsCount = signal(0);
  protected readonly materialsCount = signal(0);

  // Populate the shared topbar overflow kebab (Edit details + Delete) so the
  // company can be managed from its own detail page, matching the grid row.
  private readonly overflowEffect = effect(() => {
    const company = this.company();
    if (!company || !this.spaceRole.canEdit()) {
      this.topbarState.overflowActions.set([]);
      return;
    }
    this.topbarState.overflowActions.set(
      buildEntityActionMenu({
        canEdit: true,
        editLabel: 'Edit details',
        onEdit: () => this.editingCompany.set(true),
        onDelete: () => void this.deleteCompany(company),
        extras: [
          {
            label: 'View assets',
            icon: 'fa-solid fa-box',
            command: () =>
              this.router.navigate(
                ['/t', this.tenantIdSig(), 's', this.spaceIdSig(), 'manage', 'assets'],
                {
                  queryParams: buildFilterQueryParams({
                    companyName: { kind: 'text', contains: company.name },
                  }),
                }
              ),
          },
        ],
      })
    );
  });

  ngOnDestroy(): void {
    this.topbarState.overflowActions.set([]);
  }

  protected async onCompanyEdited(): Promise<void> {
    this.editingCompany.set(false);
    await this.loadCompany();
    this.messageService.add({ severity: 'success', summary: 'Company updated.', life: 3000 });
  }

  private async deleteCompany(company: Company): Promise<void> {
    await runEntityDelete({
      confirmation: this.confirmation,
      messageService: this.messageService,
      confirm: {
        header: 'Delete company',
        entityLabel: company.name,
        message: `Delete "${company.name}"? This will permanently remove:`,
        requireTypedConfirmation: true,
      },
      preview: () => this.companyService.previewDelete(company.id),
      delete: () => this.companyService.delete(company.id),
      successSummary: 'Company deleted.',
      onSuccess: () =>
        void this.router.navigate([
          '/t',
          this.tenantIdSig(),
          's',
          this.spaceIdSig(),
          'manage',
          'companies',
        ]),
      errorFallback: 'Could not delete company. It may have associated assets.',
    });
  }

  private readonly landscape = inject(LandscapeStateService);

  private readonly landscapeInitEffect = effect(() => {
    const space = this.spaceIdSig();
    const company = this.company();
    if (!space || !company) return;
    void this.initLandscape(space, company.id);
  });

  private async initLandscape(spaceId: string, companyId: string): Promise<void> {
    await this.landscape.init(spaceId, {
      disablePersistence: true,
      columnDefaults: { showMoaColumn: false, showRoaColumn: false },
    });
    this.landscape.filters.set({ ...EMPTY_LANDSCAPE_FILTERS, companyIds: [companyId] });
  }

  private readonly idChangeEffect = effect(() => {
    const id = this.companyId();
    if (!id) {
      this.loading.set(false);
      return;
    }
    void this.loadCompany();
    void this.loadIntelligence();
  });

  private findAncestorParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }

  private async loadCompany(): Promise<void> {
    try {
      this.company.set(await this.companyService.getById(this.companyId()));
      // History panel depends on the loaded company's space_id; refresh once
      // the company resolves so the inline panel reflects the latest versions.
      await this.refreshHistory();
    } catch {
      this.company.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshHistory(): Promise<void> {
    const c = this.company();
    if (!c) return;
    try {
      await this.historyHost.load(c.space_id, 'company', c.id);
    } catch {
      // History panel mirrors the intelligence-block: load failures should
      // not block the page. The panel renders an empty state on its own.
    }
  }

  protected async onWithdrawConfirmed(reason: string): Promise<void> {
    const id = this.historyHost.payload().current?.id;
    if (!id) return;
    try {
      await this.historyHost.withdraw(id, reason);
      this.withdrawDialogOpen.set(false);
      await Promise.all([this.loadIntelligence(), this.loadCompany()]);
      this.messageService.add({
        severity: 'success',
        summary: 'Intelligence withdrawn.',
        life: 3000,
      });
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Withdraw failed',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  protected onPurgeRequested(target: { id: string; headline: string }, anchor: boolean): void {
    this.purgeTargetId.set(target.id);
    this.purgeTargetHeadline.set(target.headline);
    this.purgeAnchorMode.set(anchor);
    this.purgeDialogOpen.set(true);
  }

  protected async onPurgeConfirmed(confirmation: string): Promise<void> {
    const id = this.purgeTargetId();
    if (!id) return;
    try {
      await this.historyHost.purge(id, confirmation, this.purgeAnchorMode());
      this.purgeDialogOpen.set(false);
      await Promise.all([this.loadIntelligence(), this.loadCompany()]);
      this.messageService.add({
        severity: 'success',
        summary: 'Intelligence purged.',
        life: 3000,
      });
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Purge failed',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  private async loadIntelligence(): Promise<void> {
    try {
      this.intelligence.set(await this.intelligenceService.getCompanyDetail(this.companyId()));
    } catch {
      this.intelligence.set(null);
    }
  }

  protected onIntelligenceEdit(): void {
    this.drawerOpen.set(true);
  }

  protected async onIntelligenceClosed(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected async onIntelligencePublished(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
    this.messageService.add({
      severity: 'success',
      summary: 'Intelligence published.',
      life: 3000,
    });
  }

  protected onIntelligenceDelete(): void {
    const i = this.intelligence();
    const id = i?.published?.record.id ?? i?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Delete this intelligence?',
      message: 'This cannot be undone.',
      acceptLabel: 'Delete',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({
            severity: 'success',
            summary: 'Deleted',
            detail: 'Intelligence removed.',
          });
          await this.loadIntelligence();
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Delete failed',
            detail: (err as Error).message,
          });
        }
      },
    });
  }
}
