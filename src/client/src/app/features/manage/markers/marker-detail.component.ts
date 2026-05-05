import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DatePipe } from '@angular/common';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ConfirmDialogModule } from 'primeng/confirmdialog';
import { ToastModule } from 'primeng/toast';

import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { IntelligenceBlockComponent } from '../../../shared/components/intelligence-block/intelligence-block.component';
import { IntelligenceEmptyComponent } from '../../../shared/components/intelligence-empty/intelligence-empty.component';
import { IntelligenceDrawerComponent } from '../../../shared/components/intelligence-drawer/intelligence-drawer.component';
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
    MaterialsSectionComponent,
  ],
  providers: [ConfirmationService, MessageService],
  templateUrl: './marker-detail.component.html',
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
    } catch {
      this.marker.set(null);
    } finally {
      this.loading.set(false);
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
