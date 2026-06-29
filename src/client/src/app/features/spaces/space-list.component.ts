import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { MessageService } from 'primeng/api';
import { MessageModule } from 'primeng/message';
import { TooltipModule } from 'primeng/tooltip';

import { Space } from '../../core/models/space.model';
import { Tenant } from '../../core/models/tenant.model';
import { SpaceService } from '../../core/services/space.service';
import { TenantService } from '../../core/services/tenant.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { LoaderComponent } from '../../shared/components/loader/loader.component';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { foldCreatedSpace } from './space-list.create';

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
    TooltipModule,
    ManagePageShellComponent,
    LoaderComponent,
  ],
  template: `
    <app-manage-page-shell>
      @if (loading()) {
        <app-loader [size]="20" label="Loading spaces" />
      } @else if (spaces().length === 0) {
        <div class="border border-slate-200 bg-white px-8 py-16 text-center">
          <p class="text-base font-medium text-slate-700">No spaces yet</p>
          <p class="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Each space is a firewalled engagement scoped to a domain: an indication, an asset class,
            a client team. Pipelines, events, and portfolio reads all live inside, with their own
            members and data.
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
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 animate-stagger">
          @for (space of spaces(); track space.id) {
            <button
              type="button"
              class="group border border-slate-200 bg-white p-5 text-left transition-colors focus:outline-none focus:ring-1 focus:ring-inset focus:ring-brand-500"
              [class.hover:bg-brand-50/40]="canOpen(space)"
              [class.cursor-not-allowed]="!canOpen(space)"
              [attr.aria-disabled]="!canOpen(space)"
              [pTooltip]="
                canOpen(space)
                  ? ''
                  : 'You are not a member of this space. Ask an owner to add you.'
              "
              tooltipPosition="top"
              (click)="openSpace(space)"
            >
              <div class="flex items-start justify-between gap-3">
                <h3
                  class="text-sm font-semibold"
                  [class.text-slate-900]="canOpen(space)"
                  [class.text-slate-400]="!canOpen(space)"
                >
                  {{ space.name }}
                </h3>
                @if (canOpen(space)) {
                  <i
                    class="fa-solid fa-arrow-right text-[11px] text-slate-400 transition-colors group-hover:text-brand-600"
                  ></i>
                } @else {
                  <i class="fa-solid fa-lock text-[11px] text-slate-300" aria-hidden="true"></i>
                }
              </div>
              @if (space.description) {
                <p
                  class="mt-2 line-clamp-2 text-xs"
                  [class.text-slate-500]="canOpen(space)"
                  [class.text-slate-400]="!canOpen(space)"
                >
                  {{ space.description }}
                </p>
              }
              <p class="mt-4 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                @if (canOpen(space)) {
                  Created {{ space.created_at | date: 'MMM d, y' }}
                } @else {
                  No access
                }
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
      styleClass="!w-[32rem]"
      (onHide)="resetCreateForm()"
    >
      <form (ngSubmit)="createSpace()" class="space-y-4">
        <p class="text-xs text-slate-500">
          A space is a firewalled engagement scoped to a domain: an indication, an asset class, a
          client team. Pipelines, events, and portfolio reads all live inside, with their own
          members and data.
        </p>
        <div>
          <label for="space-name" class="mb-1 block text-sm font-medium text-slate-700">
            Name
          </label>
          <input
            pInputText
            id="space-name"
            class="w-full"
            [ngModel]="newSpaceName()"
            (ngModelChange)="newSpaceName.set($event)"
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
            [ngModel]="newSpaceDesc()"
            (ngModelChange)="newSpaceDesc.set($event)"
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpaceListComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private spaceService = inject(SpaceService);
  private tenantService = inject(TenantService);
  private messageService = inject(MessageService);
  private readonly topbarState = inject(TopbarStateService);

  readonly tenant = signal<Tenant | null>(null);
  readonly spaces = signal<Space[]>([]);
  readonly accessibleIds = signal<Set<string>>(new Set());
  readonly loading = signal(true);
  readonly createDialogOpen = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly newSpaceName = signal('');
  readonly newSpaceDesc = signal('');

  private tenantId = '';

  private readonly countEffect = effect(() => {
    this.topbarState.recordCount.set(String(this.spaces().length || ''));
  });

  async ngOnInit(): Promise<void> {
    this.topbarState.actions.set([
      {
        label: 'Archived',
        icon: 'fa-solid fa-box-archive',
        text: true,
        callback: () => this.router.navigate(['/t', this.tenantId, 'spaces', 'archived']),
      },
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
      const [tenant, spaces, accessibleIds] = await Promise.all([
        this.tenantService.getTenant(this.tenantId),
        this.spaceService.listSpaces(this.tenantId),
        this.spaceService.listAccessibleSpaceIds(),
      ]);
      this.tenant.set(tenant);
      this.spaces.set(spaces);
      this.accessibleIds.set(accessibleIds);
    } finally {
      this.loading.set(false);
    }
  }

  protected canOpen(space: Space): boolean {
    return this.accessibleIds().has(space.id);
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  openSpace(space: Space): void {
    if (!this.canOpen(space)) {
      this.messageService.add({
        severity: 'info',
        summary: 'No access to this space',
        detail: `Ask an owner of "${space.name}" to add you as a member.`,
        life: 6000,
      });
      return;
    }
    localStorage.setItem('lastSpaceId', space.id);
    this.router.navigate(['/t', this.tenantId, 's', space.id]);
  }

  goToSettings(): void {
    this.router.navigate(['/t', this.tenantId, 'settings']);
  }

  resetCreateForm(): void {
    this.newSpaceName.set('');
    this.newSpaceDesc.set('');
    this.createError.set(null);
  }

  async createSpace(): Promise<void> {
    const name = this.newSpaceName().trim();
    if (!name) return;
    this.creating.set(true);
    this.createError.set(null);

    try {
      const space = await this.spaceService.createSpace(
        this.tenantId,
        name,
        this.newSpaceDesc().trim() || undefined
      );
      // The creator is the space owner (create_space inserts the owner
      // membership atomically). Fold the new space into the cached snapshots
      // so canOpen() doesn't read a stale accessible set and falsely block the
      // space the user just created.
      const next = foldCreatedSpace(
        { spaces: this.spaces(), accessibleIds: this.accessibleIds() },
        space
      );
      this.spaces.set(next.spaces);
      this.accessibleIds.set(next.accessibleIds);
      this.createDialogOpen.set(false);
      this.newSpaceName.set('');
      this.newSpaceDesc.set('');
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
