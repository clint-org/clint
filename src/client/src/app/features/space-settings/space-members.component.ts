import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { Select } from 'primeng/select';
import { MessageModule } from 'primeng/message';

import { SpaceMember } from '../../core/models/space.model';
import { TenantMember } from '../../core/models/tenant.model';
import { SpaceService } from '../../core/services/space.service';
import { TenantService } from '../../core/services/tenant.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-space-members',
  standalone: true,
  imports: [
    FormsModule,
    TableModule,
    ButtonModule,
    Dialog,
    Select,
    MessageModule,
    ManagePageShellComponent,
    RowActionsComponent,
  ],
  template: `
    <app-manage-page-shell>
      @if (error()) {
        <p-message severity="error" [closable]="true" (onClose)="error.set(null)" styleClass="mb-4">
          {{ error() }}
        </p-message>
      }

      <p-table
        styleClass="data-table"
        [value]="members()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '48rem' }"
        aria-label="Space members"
      >
        <ng-template #header>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th class="col-actions"></th>
          </tr>
        </ng-template>
        <ng-template #body let-member>
          <tr>
            <td>{{ member.display_name }}</td>
            <td class="col-identifier">{{ member.email }}</td>
            <td>
              <p-select
                [options]="spaceRoleOptions"
                [ngModel]="member.role"
                (ngModelChange)="changeRole(member, $event)"
                optionLabel="label"
                optionValue="value"
                size="small"
                [style]="{ minWidth: '8rem' }"
              />
            </td>
            <td class="col-actions">
              <app-row-actions
                [items]="memberMenu(member)"
                [ariaLabel]="'Actions for ' + member.display_name"
              />
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="4">No members.</td>
          </tr>
        </ng-template>
      </p-table>
    </app-manage-page-shell>

    <!-- Add member dialog -->
    <p-dialog
      header="Add member to space"
      [(visible)]="addDialogOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
    >
      <p class="mb-3 text-xs text-slate-500">
        Add an existing organization member to this space. They must be invited to the organization
        first.
      </p>
      <div class="mb-3">
        <label for="add-member" class="mb-1 block text-sm font-medium text-slate-700">
          Member
        </label>
        <p-select
          inputId="add-member"
          [options]="availableMembers()"
          [(ngModel)]="selectedUserId"
          optionLabel="label"
          optionValue="value"
          [filter]="true"
          filterPlaceholder="Search by email..."
          placeholder="Select a member"
          [style]="{ width: '100%' }"
        />
      </div>
      <div>
        <label for="add-role" class="mb-1 block text-sm font-medium text-slate-700"> Role </label>
        <p-select
          inputId="add-role"
          [options]="spaceRoleOptions"
          [(ngModel)]="selectedRole"
          optionLabel="label"
          optionValue="value"
          [style]="{ width: '100%' }"
        />
      </div>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          (onClick)="addDialogOpen.set(false)"
        />
        <p-button
          label="Add member"
          (onClick)="addMember()"
          [loading]="adding()"
          [disabled]="!selectedUserId"
        />
      </ng-template>
    </p-dialog>
  `,
})
export class SpaceMembersComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private spaceService = inject(SpaceService);
  private tenantService = inject(TenantService);
  private confirmation = inject(ConfirmationService);
  private messageService = inject(MessageService);
  private topbarState = inject(TopbarStateService);

  private readonly menuCache = new Map<string, MenuItem[]>();

  members = signal<SpaceMember[]>([]);
  orgMembers = signal<TenantMember[]>([]);
  loading = signal(true);
  error = signal<string | null>(null);
  addDialogOpen = signal(false);
  adding = signal(false);
  selectedUserId = '';
  selectedRole: 'owner' | 'editor' | 'viewer' = 'viewer';

  private tenantId = '';
  private spaceId = '';

  readonly spaceRoleOptions = [
    { label: 'Owner', value: 'owner' },
    { label: 'Editor', value: 'editor' },
    { label: 'Viewer', value: 'viewer' },
  ];

  readonly availableMembers = signal<{ label: string; value: string }[]>([]);

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.topbarState.actions.set([
      { label: 'Add member', icon: 'fa-solid fa-plus', callback: () => this.openAddDialog() },
    ]);
    await this.loadData();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  memberMenu(member: SpaceMember): MenuItem[] {
    const cached = this.menuCache.get(member.user_id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Remove from space',
        icon: 'fa-solid fa-user-minus',
        styleClass: 'row-actions-danger',
        command: () => this.removeMember(member),
      },
    ];
    this.menuCache.set(member.user_id, items);
    return items;
  }

  async changeRole(member: SpaceMember, newRole: 'owner' | 'editor' | 'viewer'): Promise<void> {
    try {
      await this.spaceService.updateMemberRole(this.spaceId, member.user_id, newRole);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Role updated.', life: 3000 });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to update role');
    }
  }

  async removeMember(member: SpaceMember): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Remove member',
      message: `Remove ${member.display_name ?? member.email} from this space?`,
      acceptLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await this.spaceService.removeMember(this.spaceId, member.user_id);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Member removed.', life: 3000 });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to remove member');
    }
  }

  async openAddDialog(): Promise<void> {
    const orgMembers = await this.tenantService.listMembers(this.tenantId);
    this.orgMembers.set(orgMembers);
    const spaceUserIds = new Set(this.members().map((m) => m.user_id));
    this.availableMembers.set(
      orgMembers
        .filter((m) => !spaceUserIds.has(m.user_id))
        .map((m) => ({ label: m.email ?? m.display_name ?? m.user_id, value: m.user_id }))
    );
    this.selectedUserId = '';
    this.selectedRole = 'viewer';
    this.addDialogOpen.set(true);
  }

  async addMember(): Promise<void> {
    if (!this.selectedUserId) return;
    this.adding.set(true);
    try {
      await this.spaceService.addMember(this.spaceId, this.selectedUserId, this.selectedRole);
      this.addDialogOpen.set(false);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Member added.', life: 3000 });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Failed to add member');
    } finally {
      this.adding.set(false);
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      this.members.set(await this.spaceService.listMembers(this.spaceId));
      this.menuCache.clear();
    } finally {
      this.loading.set(false);
    }
  }
}
