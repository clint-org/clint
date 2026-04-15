import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MessageService } from 'primeng/api';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';

import { Space } from '../../core/models/space.model';
import { SpaceService } from '../../core/services/space.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-space-general',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputText,
    Textarea,
    MessageModule,
    ManagePageShellComponent,
  ],
  template: `
    <app-manage-page-shell [narrow]="true">
      @if (loading()) {
        <p class="text-sm text-slate-400">Loading...</p>
      } @else if (space()) {
        @if (error()) {
          <p-message
            severity="error"
            [closable]="true"
            (onClose)="error.set(null)"
            styleClass="mb-4"
          >
            {{ error() }}
          </p-message>
        }
        <div class="max-w-xl">
          <div class="mb-6">
            <label
              for="space-name"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Space name
            </label>
            <input pInputText id="space-name" class="w-full" [(ngModel)]="name" />
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
            ></textarea>
          </div>

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

  space = signal<Space | null>(null);
  loading = signal(true);
  error = signal<string | null>(null);
  saving = signal(false);
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
      this.error.set(null);
      this.messageService.add({
        severity: 'success',
        summary: 'Space settings updated.',
        life: 3000,
      });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to save');
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
      this.error.set(e instanceof Error ? e.message : 'Failed to delete space');
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
