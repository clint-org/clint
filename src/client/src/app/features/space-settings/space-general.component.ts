import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';

import { Space } from '../../core/models/space.model';
import { SpaceService } from '../../core/services/space.service';
import { SpaceRoleService } from '../../core/services/space-role.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { SkeletonComponent } from '../../shared/components/skeleton/skeleton.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-space-general',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputText,
    Textarea,
    ManagePageShellComponent,
    SkeletonComponent,
  ],
  template: `
    <app-manage-page-shell [narrow]="true">
      @if (loading()) {
        <div class="max-w-xl" aria-busy="true" aria-label="Loading space settings">
          <div class="mb-6">
            <app-skeleton w="80px" h="10px" />
            <div class="mt-1.5">
              <app-skeleton [block]="true" w="100%" h="36px" />
            </div>
          </div>
          <div class="mb-6">
            <app-skeleton w="80px" h="10px" />
            <div class="mt-1.5">
              <app-skeleton [block]="true" w="100%" h="78px" />
            </div>
          </div>
          <div class="mt-6">
            <app-skeleton w="120px" h="32px" />
          </div>
        </div>
      } @else if (space()) {
        <div class="max-w-xl">
          <div class="mb-6">
            <label
              for="space-name"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Space name
            </label>
            <input
              pInputText
              id="space-name"
              class="w-full"
              [(ngModel)]="name"
              [readonly]="!spaceRole.isOwner()"
            />
          </div>

          <div class="mb-6">
            <label
              for="space-desc"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Description
            </label>
            <textarea
              pTextarea
              id="space-desc"
              class="w-full"
              [(ngModel)]="description"
              rows="3"
              [readonly]="!spaceRole.isOwner()"
            ></textarea>
          </div>

          @if (spaceRole.isOwner()) {
            <div class="mt-6 flex items-center gap-3">
              <p-button
                label="Save changes"
                [loading]="saving()"
                [disabled]="!hasChanges()"
                (onClick)="saveIfChanged()"
              />
            </div>

            <div class="mt-12 border-t border-slate-200 pt-6">
              <h3 class="text-xs font-semibold text-red-600">Danger zone</h3>
              <p class="mt-1 text-xs text-slate-500">
                Deleting a space removes all its data permanently. This cannot be undone.
              </p>
              <p-button
                label="Delete space"
                severity="danger"
                [outlined]="true"
                size="small"
                styleClass="mt-3"
                (onClick)="confirmDelete()"
              />
            </div>
          } @else {
            <p class="mt-6 text-[11px] text-slate-500">
              Read-only view. Space owners can edit these settings.
            </p>
          }
        </div>
      }
    </app-manage-page-shell>
  `,
})
export class SpaceGeneralComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private spaceService = inject(SpaceService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private topbarState = inject(TopbarStateService);
  protected spaceRole = inject(SpaceRoleService);

  readonly space = signal<Space | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  name = '';
  description = '';

  private tenantId = '';
  private spaceId = '';

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    await this.loadSpace();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  hasChanges(): boolean {
    const s = this.space();
    if (!s) return false;
    return this.name.trim() !== s.name || (this.description.trim() || '') !== (s.description || '');
  }

  async saveIfChanged(): Promise<void> {
    const s = this.space();
    if (!s) return;
    if (!this.hasChanges()) return;

    this.saving.set(true);
    try {
      const updated = await this.spaceService.updateSpace(this.spaceId, {
        name: this.name.trim(),
        description: this.description.trim() || null,
      });
      this.space.set(updated);
      this.messageService.add({
        severity: 'success',
        summary: 'Space settings updated.',
        life: 3000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not save',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    } finally {
      this.saving.set(false);
    }
  }

  async confirmDelete(): Promise<void> {
    const ok = await new Promise<boolean>((resolve) => {
      this.confirmation.confirm({
        header: 'Delete space',
        message: `Are you sure you want to delete "${this.space()?.name}"? All data in this space will be permanently removed.`,
        acceptLabel: 'Delete',
        acceptButtonStyleClass: 'p-button-danger',
        rejectLabel: 'Cancel',
        accept: () => resolve(true),
        reject: () => resolve(false),
      });
    });
    if (!ok) return;

    try {
      await this.spaceService.deleteSpace(this.spaceId);
      this.router.navigate(['/t', this.tenantId, 'spaces']);
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not delete space',
        detail: e instanceof Error ? e.message : 'Please try again.',
        life: 4000,
      });
    }
  }

  private async loadSpace(): Promise<void> {
    this.loading.set(true);
    try {
      const space = await this.spaceService.getSpace(this.spaceId);
      this.space.set(space);
      this.name = space.name;
      this.description = space.description ?? '';
    } finally {
      this.loading.set(false);
    }
  }
}
