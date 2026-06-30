import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { Dialog } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { IntelligenceStackComponent } from '../../../shared/components/intelligence-stack/intelligence-stack.component';
import { PiMarkComponent } from '../../../shared/components/pi-mark/pi-mark.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { WithdrawIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/withdraw-dialog.component';
import { PurgeIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/purge-dialog.component';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';
import { BrandLogoComponent } from '../../../shared/components/brand-logo.component';
import { TimelineViewComponent } from '../../landscape/timeline-view.component';
import { EntityMarkerDrawerComponent } from '../../landscape/entity-marker-drawer.component';
import { LandscapeStateService } from '../../landscape/landscape-state.service';
import { EntityEventsSectionComponent } from '../../../shared/components/entity-events-section/entity-events-section.component';
import { EntityEventsService } from '../../../shared/components/entity-events-section/entity-events.service';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';
import { SourceProvenanceLineComponent } from '../../../shared/components/source-provenance/source-provenance-line.component';
import { EMPTY_LANDSCAPE_FILTERS } from '../../../core/models/landscape.model';

import { AssetService } from '../../../core/services/asset.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { SupabaseService } from '../../../core/services/supabase.service';
import { Asset } from '../../../core/models/asset.model';
import type { DevelopmentStatus } from '../../../core/models/phase-colors';
import type { Marker } from '../../../core/models/marker.model';
import { assetApprovalUnreflected } from '../../events/event-form/event-stage-lift';
import {
  IntelligenceDetailBundle,
  IntelligenceHistoryPayload,
} from '../../../core/models/primary-intelligence.model';
import { SectionCardComponent } from '../../../shared/components/section-card.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { ReferencedInPanelComponent } from '../../../shared/components/referenced-in-panel/referenced-in-panel.component';
import { AssetFormComponent } from './asset-form.component';
import { TrialCreateDialogComponent } from '../trials/trial-create-dialog.component';
import { buildEntityActionMenu } from '../../../shared/entity-actions/entity-action-menu';
import { runEntityDelete } from '../../../shared/entity-actions/run-entity-delete';

@Component({
  selector: 'app-asset-detail',
  imports: [
    BrandLogoComponent,
    ButtonModule,
    RouterLink,
    ConfirmDialogModule,
    Dialog,
    ToastModule,
    ManagePageShellComponent,
    IntelligenceStackComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    WithdrawIntelligenceDialogComponent,
    PurgeIntelligenceDialogComponent,
    MaterialsSectionComponent,
    TimelineViewComponent,
    PiMarkComponent,
    EntityMarkerDrawerComponent,
    EntityEventsSectionComponent,
    RowActionsComponent,
    SectionCardComponent,
    ReferencedInPanelComponent,
    AssetFormComponent,
    TrialCreateDialogComponent,
    LoaderComponent,
    SourceProvenanceLineComponent,
  ],
  providers: [ConfirmationService, MessageService, LandscapeStateService],
  templateUrl: './asset-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetDetailComponent {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private assetService = inject(AssetService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private supabase = inject(SupabaseService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

  // Route paramMap as a signal so assetId reacts to in-place navigation
  // when clicking a LINKED product chip on an asset detail page (same route
  // config reuses this component instance).
  private readonly paramMapSig = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  protected readonly assetId = computed(() => this.paramMapSig().get('id') ?? '');
  protected readonly asset = signal<Asset | null>(null);
  protected readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  protected readonly drawerOpen = signal(false);
  // anchor_id of the brief currently open in the drawer; null = new brief
  protected readonly drawerAnchorId = signal<string | null>(null);
  protected readonly loading = signal(true);

  // Per-anchor history map; populated lazily via onRequestHistory.
  protected readonly histories = signal<Record<string, IntelligenceHistoryPayload>>({});
  // Stores the published record id surfaced by the stack's withdraw output.
  protected readonly withdrawTargetId = signal<string | null>(null);

  protected readonly withdrawDialogOpen = signal(false);
  protected readonly purgeDialogOpen = signal(false);
  protected readonly purgeAnchorMode = signal(false);
  protected readonly purgeTargetHeadline = signal('');
  protected readonly purgeTargetId = signal<string | null>(null);

  readonly editingAsset = signal(false);
  protected readonly creatingTrial = signal(false);

  // Entity overflow menu (Edit details / Delete), rendered in the content
  // section-header instead of the topbar. Empty for viewers.
  protected readonly entityMenu = computed<MenuItem[]>(() => {
    const asset = this.asset();
    if (!asset || !this.spaceRole.canEdit()) return [];
    return buildEntityActionMenu({
      canEdit: true,
      editLabel: 'Edit details',
      onEdit: () => this.editingAsset.set(true),
      onDelete: () => void this.deleteAsset(asset),
    });
  });

  protected onTrialCreated({ trialId }: { trialId: string }): void {
    this.creatingTrial.set(false);
    void this.router.navigate([
      '/t',
      this.tenantIdSig(),
      's',
      this.spaceIdSig(),
      'profiles',
      'trials',
      trialId,
    ]);
  }

  private async deleteAsset(asset: Asset): Promise<void> {
    await runEntityDelete({
      confirmation: this.confirmation,
      messageService: this.messageService,
      confirm: {
        header: 'Delete asset',
        entityLabel: asset.name,
        message: `Delete "${asset.name}"? This will permanently remove:`,
        requireTypedConfirmation: true,
      },
      preview: () => this.assetService.previewDelete(asset.id),
      delete: () => this.assetService.delete(asset.id),
      successSummary: 'Asset deleted.',
      onSuccess: () =>
        void this.router.navigate([
          '/t',
          this.tenantIdSig(),
          's',
          this.spaceIdSig(),
          'profiles',
          'assets',
        ]),
      errorFallback: 'Could not delete asset. It may have associated trials.',
    });
  }

  async onAssetEdited(): Promise<void> {
    this.editingAsset.set(false);
    await this.loadAsset();
    this.messageService.add({ severity: 'success', summary: 'Asset updated.', life: 3000 });
  }

  protected readonly hasIntelligence = computed(() =>
    (this.intelligence()?.briefs.length ?? 0) > 0
  );

  protected readonly tenantIdSig = computed(() => this.findAncestorParam('tenantId') ?? '');
  protected readonly spaceIdSig = computed(() => this.findAncestorParam('spaceId') ?? '');

  // Header count badge for the materials card, fed by the panel's (loaded)
  // output since the count is fetched inside the child component.
  protected readonly materialsCount = signal(0);

  // Events anchored to this asset, rendered in the standardized events table.
  private readonly entityEvents = inject(EntityEventsService);
  protected readonly events = signal<Marker[]>([]);
  protected async loadEvents(): Promise<void> {
    const id = this.assetId();
    if (!id) {
      this.events.set([]);
      return;
    }
    try {
      this.events.set(await this.entityEvents.fetchForAnchor('asset', id));
    } catch {
      this.events.set([]);
    }
  }

  // development_status across this asset's indication programs. Lightweight
  // direct read (asset_indications is select-able by space members) so the
  // "approval not reflected in stage" diagnostic can compare events vs status.
  protected readonly indicationStatuses = signal<(DevelopmentStatus | null)[]>([]);
  protected async loadIndicationStatuses(): Promise<void> {
    const id = this.assetId();
    if (!id) {
      this.indicationStatuses.set([]);
      return;
    }
    try {
      const { data } = await this.supabase.client
        .from('asset_indications')
        .select('development_status')
        .eq('asset_id', id);
      const rows = (data as { development_status: DevelopmentStatus | null }[] | null) ?? [];
      this.indicationStatuses.set(rows.map((r) => r.development_status));
    } catch {
      this.indicationStatuses.set([]);
    }
  }

  // Re-read events AND indication statuses after an inline event edit, since
  // tagging an Approval/Launch with an indication lifts development_status.
  protected async onEventsChanged(): Promise<void> {
    // Also reload the shared landscape dataset: the embedded timeline reads its
    // markers from LandscapeStateService, not from this page's `events` signal,
    // so without this the timeline keeps showing the pre-edit event (issue #175).
    await Promise.all([
      this.loadEvents(),
      this.loadIndicationStatuses(),
      this.landscape.reload(),
    ]);
  }

  // Restrained diagnostic: an actual Approval/Launch event exists for this asset
  // but no indication reached APPROVED/LAUNCHED, so the stage still reads the
  // trial phase. Almost always means the approval event was not tagged with an
  // indication, so the lift trigger had nothing to lift.
  protected readonly approvalUnreflected = computed(() =>
    assetApprovalUnreflected({
      statuses: this.indicationStatuses(),
      events: this.events().map((m) => ({
        id: m.marker_type_id,
        lifts_development_status: m.marker_types?.lifts_development_status ?? null,
        projection: m.projection,
        no_longer_expected: m.no_longer_expected,
      })),
    }),
  );

  private readonly landscape = inject(LandscapeStateService);

  private readonly landscapeInitEffect = effect(() => {
    const space = this.spaceIdSig();
    const asset = this.asset();
    if (!space || !asset) return;
    void this.initLandscape(space, asset.id);
  });

  private async initLandscape(spaceId: string, assetId: string): Promise<void> {
    await this.landscape.init(spaceId, {
      disablePersistence: true,
      columnDefaults: { showMoaColumn: false, showRoaColumn: false },
    });
    this.landscape.filters.set({ ...EMPTY_LANDSCAPE_FILTERS, assetIds: [assetId] });
  }

  private readonly idChangeEffect = effect(() => {
    const id = this.assetId();
    if (!id) {
      this.loading.set(false);
      return;
    }
    void this.loadAsset();
    void this.loadIntelligence();
    void this.loadEvents();
    void this.loadIndicationStatuses();
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

  private async loadAsset(): Promise<void> {
    try {
      this.asset.set(await this.assetService.getById(this.assetId()));
    } catch {
      this.asset.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /** Lazily loads version history for one anchor card; called by the stack on first expand. */
  protected async onRequestHistory(anchorId: string): Promise<void> {
    const p = this.asset();
    if (!p) return;
    try {
      const payload = await this.intelligenceService.loadHistory(anchorId, 'product', p.id);
      this.histories.update((m) => ({ ...m, [anchorId]: payload }));
    } catch {
      // Per-card history load failure must not block the page; the card keeps
      // its loading line and the user can collapse/expand to retry.
    }
  }

  protected onWithdrawRequested(e: { anchorId: string; id: string; headline: string }): void {
    this.withdrawTargetId.set(e.id);
    this.withdrawDialogOpen.set(true);
  }

  protected async onWithdrawConfirmed(reason: string): Promise<void> {
    const id = this.withdrawTargetId();
    if (!id) return;
    try {
      await this.intelligenceService.withdraw(id, reason);
      this.withdrawDialogOpen.set(false);
      await Promise.all([this.loadIntelligence(), this.loadAsset()]);
      this.histories.set({});
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
      await this.intelligenceService.purge(id, confirmation, this.purgeAnchorMode());
      this.purgeDialogOpen.set(false);
      await Promise.all([this.loadIntelligence(), this.loadAsset()]);
      this.histories.set({});
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
      this.intelligence.set(await this.intelligenceService.getAssetDetail(this.assetId()));
    } catch {
      this.intelligence.set(null);
    }
  }

  protected openDrawerForNewBrief(): void {
    this.drawerAnchorId.set(null);
    this.drawerOpen.set(true);
  }

  protected openBriefInDrawer(anchorId: string): void {
    this.drawerAnchorId.set(anchorId);
    this.drawerOpen.set(true);
  }

  protected async onBriefPin(anchorId: string): Promise<void> {
    const i = this.intelligence();
    if (!i) return;
    try {
      await this.intelligenceService.setLead(anchorId, i.space_id, i.entity_type, i.entity_id);
      await this.loadIntelligence();
      this.histories.set({});
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not set lead entry',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  protected async onBriefReorder(anchorIds: string[]): Promise<void> {
    const i = this.intelligence();
    if (!i) return;
    try {
      await this.intelligenceService.reorder(i.space_id, i.entity_type, i.entity_id, anchorIds);
      await this.loadIntelligence();
      this.histories.set({});
    } catch (err) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not reorder entries',
        detail: err instanceof Error ? err.message : 'Check your connection and try again.',
        life: 4000,
      });
    }
  }

  protected onDiscardDraft(anchorId: string): void {
    const brief = this.intelligence()?.briefs.find((b) => b.anchor_id === anchorId);
    const id = brief?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Discard draft?',
      message: 'This permanently removes the unpublished draft. This cannot be undone.',
      acceptLabel: 'Discard draft',
      acceptButtonStyleClass: 'p-button-danger',
      rejectLabel: 'Cancel',
      accept: async () => {
        try {
          await this.intelligenceService.delete(id);
          this.messageService.add({ severity: 'success', summary: 'Draft discarded.', life: 3000 });
          await this.loadIntelligence();
          this.histories.set({});
        } catch (err) {
          this.messageService.add({
            severity: 'error',
            summary: 'Discard failed',
            detail: err instanceof Error ? err.message : 'Check your connection and try again.',
            life: 4000,
          });
        }
      },
    });
  }

  protected async onIntelligenceClosed(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
  }

  protected async onIntelligencePublished(): Promise<void> {
    this.drawerOpen.set(false);
    await this.loadIntelligence();
    this.histories.set({});
    this.messageService.add({
      severity: 'success',
      summary: 'Intelligence published.',
      life: 3000,
    });
  }

}

