import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { SectionHeaderComponent } from '../../../shared/components/section-header/section-header.component';
import { IntelligenceStackComponent } from '../../../shared/components/intelligence-stack/intelligence-stack.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
import { WithdrawIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/withdraw-dialog.component';
import { PurgeIntelligenceDialogComponent } from '../../../shared/components/intelligence-history-panel/purge-dialog.component';
import { MaterialsSectionComponent } from '../../../shared/components/materials-section/materials-section.component';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';

import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { SpaceRoleService } from '../../../core/services/space-role.service';
import {
  IntelligenceDetailBundle,
  IntelligenceHistoryPayload,
} from '../../../core/models/primary-intelligence.model';

@Component({
  selector: 'app-engagement-detail',
  imports: [
    ConfirmDialogModule,
    ToastModule,
    ManagePageShellComponent,
    SectionHeaderComponent,
    IntelligenceStackComponent,
    IntelligenceEmptyComponent,
    IntelligenceDrawerComponent,
    WithdrawIntelligenceDialogComponent,
    PurgeIntelligenceDialogComponent,
    MaterialsSectionComponent,
    LoaderComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './engagement-detail.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EngagementDetailComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private intelligenceService = inject(PrimaryIntelligenceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  protected spaceRole = inject(SpaceRoleService);

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

  protected readonly hasIntelligence = computed(() =>
    (this.intelligence()?.briefs.length ?? 0) > 0
  );

  protected readonly tenantIdSig = computed(() => this.findAncestorParam('tenantId') ?? '');
  protected readonly spaceIdSig = computed(() => this.findAncestorParam('spaceId') ?? '');

  ngOnInit(): void {
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

  private async loadIntelligence(): Promise<void> {
    try {
      const sid = this.spaceIdSig();
      if (!sid) return;
      this.intelligence.set(await this.intelligenceService.getSpaceIntelligence(sid));
    } catch {
      this.intelligence.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  /** Lazily loads version history for one anchor card; called by the stack on first expand. */
  protected async onRequestHistory(anchorId: string): Promise<void> {
    const sid = this.spaceIdSig();
    if (!sid) return;
    try {
      const payload = await this.intelligenceService.loadHistory(anchorId, 'space', sid);
      this.histories.update((m) => ({ ...m, [anchorId]: payload }));
    } catch {
      // Per-card history load failure must not block the page; the card keeps
      // its loading state and the user can collapse/expand to retry.
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
      await this.loadIntelligence();
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
      await this.loadIntelligence();
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
