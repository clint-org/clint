import { DatePipe } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';

import { Space } from '../../core/models/space.model';
import { Tenant } from '../../core/models/tenant.model';
import { SpaceService } from '../../core/services/space.service';
import { TenantService } from '../../core/services/tenant.service';

@Component({
  selector: 'app-space-list',
  standalone: true,
  imports: [DatePipe, FormsModule, ButtonModule, Dialog, InputText, Textarea, MessageModule],
  template: `
    <div class="min-h-screen bg-slate-50">
      <div class="bg-white border-b border-slate-200">
        <div class="h-0.5 bg-teal-500"></div>
        <div class="mx-auto max-w-4xl flex items-center justify-between px-6 py-4">
          <div>
            <h1 class="text-xl font-bold text-slate-900">{{ tenant()?.name }}</h1>
            <p class="text-sm text-slate-500">Select a workspace</p>
          </div>
          <div class="flex gap-2">
            <p-button label="Settings" icon="fa-solid fa-gear" severity="secondary" [outlined]="true" size="small" (onClick)="goToSettings()" />
            <p-button label="New Space" icon="fa-solid fa-plus" size="small" (onClick)="createDialogOpen.set(true)" />
          </div>
        </div>
      </div>

      <div class="mx-auto max-w-4xl px-6 py-8">
        @if (loading()) {
          <p class="text-slate-500">Loading spaces...</p>
        } @else if (spaces().length === 0) {
          <div class="text-center py-16">
            <p class="text-lg text-slate-600 mb-2">No spaces yet</p>
            <p class="text-sm text-slate-400 mb-6">Create your first workspace to start tracking clinical trials</p>
            <p-button label="Create Space" icon="fa-solid fa-plus" (onClick)="createDialogOpen.set(true)" />
          </div>
        } @else {
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            @for (space of spaces(); track space.id) {
              <button
                class="bg-white rounded-lg border border-slate-200 p-5 text-left hover:border-teal-300 hover:shadow-sm transition cursor-pointer"
                (click)="openSpace(space)"
              >
                <h3 class="font-semibold text-slate-900">{{ space.name }}</h3>
                @if (space.description) {
                  <p class="mt-1 text-sm text-slate-500 line-clamp-2">{{ space.description }}</p>
                }
                <p class="mt-3 text-xs text-slate-400">Created {{ space.created_at | date }}</p>
              </button>
            }
          </div>
        }
      </div>
    </div>

    <p-dialog header="Create Space" [(visible)]="createDialogOpen" [modal]="true" [style]="{ width: '28rem' }">
      <form (ngSubmit)="createSpace()" class="space-y-4">
        <div>
          <label for="space-name" class="block text-sm font-medium text-slate-700 mb-1">Name</label>
          <input pInputText id="space-name" class="w-full" [(ngModel)]="newSpaceName" name="spaceName" placeholder="e.g. SGLT2 Pipeline" required />
        </div>
        <div>
          <label for="space-desc" class="block text-sm font-medium text-slate-700 mb-1">Description</label>
          <textarea pTextarea id="space-desc" class="w-full" [(ngModel)]="newSpaceDesc" name="spaceDesc" rows="2" placeholder="Optional description"></textarea>
        </div>
        @if (createError()) {
          <p-message severity="error" [closable]="false">{{ createError() }}</p-message>
        }
      </form>
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="createDialogOpen.set(false)" />
        <p-button label="Create" (onClick)="createSpace()" [loading]="creating()" />
      </ng-template>
    </p-dialog>
  `,
})
export class SpaceListComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private spaceService = inject(SpaceService);
  private tenantService = inject(TenantService);

  tenant = signal<Tenant | null>(null);
  spaces = signal<Space[]>([]);
  loading = signal(true);
  createDialogOpen = signal(false);
  creating = signal(false);
  createError = signal<string | null>(null);
  newSpaceName = '';
  newSpaceDesc = '';

  private tenantId = '';

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    localStorage.setItem('lastTenantId', this.tenantId);

    try {
      const [tenant, spaces] = await Promise.all([
        this.tenantService.getTenant(this.tenantId),
        this.spaceService.listSpaces(this.tenantId),
      ]);
      this.tenant.set(tenant);
      this.spaces.set(spaces);
    } finally {
      this.loading.set(false);
    }
  }

  openSpace(space: Space): void {
    localStorage.setItem('lastSpaceId', space.id);
    this.router.navigate(['/t', this.tenantId, 's', space.id]);
  }

  goToSettings(): void {
    this.router.navigate(['/t', this.tenantId, 'settings']);
  }

  async createSpace(): Promise<void> {
    if (!this.newSpaceName.trim()) return;
    this.creating.set(true);
    this.createError.set(null);

    try {
      const space = await this.spaceService.createSpace(this.tenantId, this.newSpaceName.trim(), this.newSpaceDesc.trim() || undefined);
      this.createDialogOpen.set(false);
      this.newSpaceName = '';
      this.newSpaceDesc = '';
      this.openSpace(space);
    } catch (e) {
      this.createError.set(e instanceof Error ? e.message : 'Failed to create space');
    } finally {
      this.creating.set(false);
    }
  }
}
