import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { IntelligenceHistoryPanelComponent } from '../../../shared/components/intelligence-history-panel/intelligence-history-panel.component';
import { WithdrawIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/withdraw-dialog.component';
import { PurgeIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/purge-dialog.component';
import { IntelligenceHistoryHost } from '../../../shared/components/intelligence-history-panel/history-panel-host';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';

import { MarkerService } from '../../../core/services/marker.service';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import { Marker } from '../../../core/models/marker.model';
import { IntelligenceDetailBundle } from '../../../core/models/primary-intelligence.model';

@Component({
  selector: 'app-marker-detail',
  standalone: true,
  imports: [
    DatePipe,
    ConfirmDialogModule,
    ToastModule,
    ManagePageShellComponent,
    IntelligenceBlockComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    IntelligenceHistoryPanelComponent,
    WithdrawIntelligenceDialogComponent,
    PurgeIntelligenceDialogComponent,
    MaterialsSectionComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './marker-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private markerService = inject(MarkerService);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

  protected readonly markerId = signal<string>('');
  protected readonly marker = signal<Marker | null>(null);
  protected readonly intelligence = signal<IntelligenceDetailBundle | null>(null);
  protected readonly drawerOpen = signal(false);
  protected readonly loading = signal(true);

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

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.loading.set(false);
      return;
    }
    this.markerId.set(id);
    void this.loadMarker();
    void this.loadIntelligence();
  }

  private findAncestorParam(key: string): string | null {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      const v = snap.paramMap.get(key);
      if (v) return v;
      snap = snap.parent;
    }
    return null;
  }

  private async loadMarker(): Promise<void> {
    try {
      this.marker.set(await this.markerService.getById(this.markerId()));
      // History panel depends on the loaded marker's space_id; refresh once
      // the marker resolves so the inline panel reflects the latest versions.
      await this.refreshHistory();
    } catch {
      this.marker.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  private async refreshHistory(): Promise<void> {
    const m = this.marker();
    if (!m) return;
    try {
      await this.historyHost.load(m.space_id, 'marker', m.id);
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
      await Promise.all([this.loadIntelligence(), this.loadMarker()]);
      this.messageService.add({
        severity: 'success',
        summary: 'Read withdrawn.',
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
      await Promise.all([this.loadIntelligence(), this.loadMarker()]);
      this.messageService.add({
        severity: 'success',
        summary: 'Read purged.',
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
      this.intelligence.set(await this.intelligenceService.getMarkerDetail(this.markerId()));
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
    this.messageService.add({ severity: 'success', summary: 'Read published.', life: 3000 });
  }

  protected onIntelligenceDelete(): void {
    const i = this.intelligence();
    const id = i?.published?.record.id ?? i?.draft?.record.id;
    if (!id) return;
    this.confirmation.confirm({
      header: 'Delete primary intelligence?',
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
            detail: 'Primary intelligence removed.',
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
