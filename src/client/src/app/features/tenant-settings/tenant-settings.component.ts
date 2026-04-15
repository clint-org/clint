import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { MessageModule } from 'primeng/message';

import { Tenant, TenantMember, TenantInvite } from '../../core/models/tenant.model';
import { TenantService } from '../../core/services/tenant.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../shared/components/status-tag.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-tenant-settings',
  standalone: true,
  imports: [
    FormsModule,
    TableModule,
    ButtonModule,
    Dialog,
    InputText,
    Select,
    MessageModule,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
  ],
  template: `
    <app-manage-page-shell>
      @if (removeError()) {
        <p-message
          severity="error"
          [closable]="true"
          (onClose)="removeError.set(null)"
          styleClass="mb-4"
        >
          {{ removeError() }}
        </p-message>
      }

      <!-- Members -->
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Members
        </h2>
        <span class="text-[11px] text-slate-400 tabular-nums">{{ members().length }}</span>
      </div>
      <p-table
        styleClass="data-table"
        [value]="members()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '48rem' }"
        aria-label="Organization members"
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
              <app-status-tag
                [label]="member.role"
                [tone]="member.role === 'owner' ? 'teal' : 'slate'"
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

      <!-- Invites -->
      <div class="mt-10 mb-3 flex items-baseline justify-between">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Pending invites
        </h2>
        <span class="text-[11px] text-slate-400 tabular-nums">{{ invites().length }}</span>
      </div>
      <p-table
        styleClass="data-table"
        [value]="invites()"
        [tableStyle]="{ 'min-width': '48rem' }"
        aria-label="Pending invites"
      >
        <ng-template #header>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Code</th>
            <th>Expires</th>
          </tr>
        </ng-template>
        <ng-template #body let-invite>
          <tr>
            <td>{{ invite.email }}</td>
            <td>
              <app-status-tag
                [label]="invite.role"
                [tone]="invite.role === 'owner' ? 'teal' : 'slate'"
              />
            </td>
            <td class="col-identifier">{{ invite.invite_code }}</td>
            <td class="col-identifier">{{ invite.expires_at }}</td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="4">No pending invites.</td>
          </tr>
        </ng-template>
      </p-table>
    </app-manage-page-shell>

    <p-dialog
      header="Invite member"
      [(visible)]="inviteDialogOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
    >
      <form (ngSubmit)="sendInvite()" class="space-y-4">
        <div>
          <label for="invite-email" class="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            pInputText
            id="invite-email"
            class="w-full"
            [(ngModel)]="inviteEmail"
            name="email"
            type="email"
            required
          />
        </div>
        <div>
          <label for="invite-role" class="mb-1 block text-sm font-medium text-slate-700">
            Role
          </label>
          <p-select
            inputId="invite-role"
            [options]="roleOptions"
            [(ngModel)]="inviteRole"
            name="role"
            optionLabel="label"
            optionValue="value"
            [style]="{ width: '100%' }"
          />
        </div>
        @if (inviteError()) {
          <p-message severity="error" [closable]="false">{{ inviteError() }}</p-message>
        }
      </form>
      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [outlined]="true"
          (onClick)="inviteDialogOpen.set(false)"
        />
        <p-button label="Send invite" (onClick)="sendInvite()" [loading]="inviting()" />
      </ng-template>
    </p-dialog>
  `,
})
export class TenantSettingsComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tenantService = inject(TenantService);
  private confirmation = inject(ConfirmationService);
  private readonly topbarState = inject(TopbarStateService);

  // Stable menu-item references per member id (see CompanyListComponent comment).
  private readonly menuCache = new Map<string, MenuItem[]>();

  tenantId = '';
  tenant = signal<Tenant | null>(null);
  members = signal<TenantMember[]>([]);
  invites = signal<TenantInvite[]>([]);
  loading = signal(true);
  inviteDialogOpen = signal(false);
  inviting = signal(false);
  inviteError = signal<string | null>(null);
  removeError = signal<string | null>(null);
  inviteEmail = '';
  inviteRole: 'owner' | 'member' = 'member';

  readonly roleOptions = [
    { label: 'Member', value: 'member' },
    { label: 'Owner', value: 'owner' },
  ];

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    this.topbarState.actions.set([
      {
        label: 'Back to spaces',
        icon: 'fa-solid fa-arrow-left',
        text: true,
        callback: () => this.goBack(),
      },
      {
        label: 'Invite member',
        icon: 'fa-solid fa-plus',
        callback: () => this.inviteDialogOpen.set(true),
      },
    ]);
    await this.loadData();
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  memberMenu(member: TenantMember): MenuItem[] {
    const cached = this.menuCache.get(member.user_id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Remove member',
        icon: 'fa-solid fa-user-minus',
        styleClass: 'row-actions-danger',
        command: () => this.removeMember(member),
      },
    ];
    this.menuCache.set(member.user_id, items);
    return items;
  }

  goBack(): void {
    this.router.navigate(['/t', this.tenantId, 'spaces']);
  }

  async sendInvite(): Promise<void> {
    if (!this.inviteEmail.trim()) return;
    this.inviting.set(true);
    this.inviteError.set(null);

    try {
      await this.tenantService.createInvite(
        this.tenantId,
        this.inviteEmail.trim(),
        this.inviteRole
      );
      this.inviteDialogOpen.set(false);
      this.inviteEmail = '';
      await this.loadData();
    } catch (e) {
      this.inviteError.set(e instanceof Error ? e.message : 'Failed to send invite');
    } finally {
      this.inviting.set(false);
    }
  }

  async removeMember(member: TenantMember): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Remove member',
      message: `Remove ${member.display_name} from this organization? They will lose access immediately.`,
      acceptLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await this.tenantService.removeMember(this.tenantId, member.user_id);
      await this.loadData();
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to remove member');
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [tenant, members, invites] = await Promise.all([
        this.tenantService.getTenant(this.tenantId),
        this.tenantService.listMembers(this.tenantId),
        this.tenantService.listInvites(this.tenantId),
      ]);
      this.tenant.set(tenant);
      this.members.set(members);
      this.invites.set(invites);
      this.menuCache.clear();
    } finally {
      this.loading.set(false);
    }
  }
}
