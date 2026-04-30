import { DatePipe } from '@angular/common';
import { Component, effect, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { MessageService } from 'primeng/api';
import { MessageModule } from 'primeng/message';

import { Space } from '../../core/models/space.model';
import { Tenant } from '../../core/models/tenant.model';
import { SpaceService } from '../../core/services/space.service';
import { TenantService } from '../../core/services/tenant.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-space-list',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    ButtonModule,
    Dialog,
    InputText,
    Textarea,
    MessageModule,
    ManagePageShellComponent,
  ],
  template: `
    <app-manage-page-shell>
      @if (loading()) {
        <p class="text-sm text-slate-400">Loading spaces...</p>
      } @else if (spaces().length === 0) {
        <div class="border border-slate-200 bg-white px-8 py-16 text-center">
          <p class="text-base font-medium text-slate-700">No spaces yet</p>
          <p class="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Each space is a firewalled engagement &mdash; its own members, its own data. Use one
            per piece of work: a pipeline read, a catalyst tracker, a portfolio review, an asset
            deep-dive.
          </p>
          <div class="mt-6 inline-block">
            <p-button
              label="Create space"
              icon="fa-solid fa-plus"
              severity="secondary"
              [outlined]="true"
              size="small"
              (onClick)="createDialogOpen.set(true)"
            />
          </div>
        </div>
      } @else {
        <div
          class="grid grid-cols-1 gap-px bg-slate-200 border border-slate-200 sm:grid-cols-2 lg:grid-cols-3 animate-stagger"
        >
          @for (space of spaces(); track space.id) {
            <button
              type="button"
              class="group bg-white p-5 text-left transition-colors hover:bg-brand-50/40 focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
              (click)="openSpace(space)"
            >
              <div class="flex items-start justify-between gap-3">
                <h3 class="text-sm font-semibold text-slate-900">{{ space.name }}</h3>
                <i
                  class="fa-solid fa-arrow-right text-[11px] text-slate-300 transition-colors group-hover:text-brand-600"
                ></i>
              </div>
              @if (space.description) {
                <p class="mt-2 line-clamp-2 text-xs text-slate-500">{{ space.description }}</p>
              }
              <p class="mt-4 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                Created {{ space.created_at | date: 'MMM d, y' }}
              </p>
            </button>
          }
        </div>
      }
    </app-manage-page-shell>

    <p-dialog
      header="Create space"
      [(visible)]="createDialogOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
      (onHide)="resetCreateForm()"
    >
      <form (ngSubmit)="createSpace()" class="space-y-4">
        <p class="text-xs text-slate-500">
          A space is a workspace for organizing and visualizing a set of clinical trials -- for
          example, by therapeutic area or competitive landscape.
        </p>
        <div>
          <label for="space-name" class="mb-1 block text-sm font-medium text-slate-700">
            Name
          </label>
          <input
            pInputText
            id="space-name"
            class="w-full"
            [(ngModel)]="newSpaceName"
            name="spaceName"
            placeholder="e.g. SGLT2 Pipeline"
            required
          />
        </div>
        <div>
          <label for="space-desc" class="mb-1 block text-sm font-medium text-slate-700">
            Description
          </label>
          <textarea
            pTextarea
            id="space-desc"
            class="w-full"
            [(ngModel)]="newSpaceDesc"
            name="spaceDesc"
            rows="2"
            placeholder="Optional description"
          ></textarea>
        </div>
        @if (createError()) {
          <p-message severity="error" [closable]="false">{{ createError() }}</p-message>
        }
      </form>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          (onClick)="createDialogOpen.set(false)"
        />
        <p-button label="Create space" (onClick)="createSpace()" [loading]="creating()" />
      </ng-template>
    </p-dialog>
  `,
})
export class SpaceListComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private spaceService = inject(SpaceService);
  private tenantService = inject(TenantService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);

  tenant = signal<Tenant | null>(null);
  spaces = signal<Space[]>([]);
  loading = signal(true);
  createDialogOpen = signal(false);
  creating = signal(false);
  createError = signal<string | null>(null);
  newSpaceName = '';
  newSpaceDesc = '';

  private tenantId = '';

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.spaces().length || ''));
  });

  async ngOnInit(): Promise<void> {
    this.topbarState.actions.set([
      {
        label: 'Settings',
        icon: 'fa-solid fa-gear',
        text: true,
        callback: () => this.goToSettings(),
      },
      {
        label: 'New space',
        icon: 'fa-solid fa-plus',
        callback: () => this.createDialogOpen.set(true),
      },
    ]);
    this.route.paramMap.subscribe((params) => {
      const id = params.get('tenantId');
      if (id && id !== this.tenantId) {
        this.tenantId = id;
        localStorage.setItem('lastTenantId', id);
        this.loadData();
      }
    });
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    localStorage.setItem('lastTenantId', this.tenantId);
    await this.loadData();
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
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

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  openSpace(space: Space): void {
    localStorage.setItem('lastSpaceId', space.id);
    this.router.navigate(['/t', this.tenantId, 's', space.id]);
  }

  goToSettings(): void {
    this.router.navigate(['/t', this.tenantId, 'settings']);
  }

  resetCreateForm(): void {
    this.newSpaceName = '';
    this.newSpaceDesc = '';
    this.createError.set(null);
  }

  async createSpace(): Promise<void> {
    if (!this.newSpaceName.trim()) return;
    this.creating.set(true);
    this.createError.set(null);

    try {
      const space = await this.spaceService.createSpace(
        this.tenantId,
        this.newSpaceName.trim(),
        this.newSpaceDesc.trim() || undefined
      );
      this.createDialogOpen.set(false);
      this.newSpaceName = '';
      this.newSpaceDesc = '';
      this.messageService.add({ severity: 'success', summary: 'Space created.', life: 3000 });
      this.openSpace(space);
    } catch (e) {
      this.createError.set(
        e instanceof Error
          ? e.message
          : 'Could not create space. Check your connection and try again.'
      );
    } finally {
      this.creating.set(false);
    }
  }
}
