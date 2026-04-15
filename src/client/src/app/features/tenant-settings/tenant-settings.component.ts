import { Component, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
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

      <!-- Org identity -->
      <div class="mb-8 max-w-xl">
        <div class="flex items-start gap-4">
          <!-- Logo upload -->
          <div class="flex flex-col items-center gap-2">
            @if (tenant()?.logo_url) {
              <img
                [src]="tenant()!.logo_url"
                class="h-16 w-16 rounded-xl object-cover border border-slate-200"
                alt="Organization logo"
              />
              <button
                type="button"
                class="text-[10px] text-slate-400 hover:text-red-500"
                (click)="removeLogo()"
              >
                Remove
              </button>
            } @else {
              <label
                class="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-[10px] text-slate-400 hover:border-teal-400 hover:text-teal-500 transition-colors"
              >
                Logo
                <input
                  type="file"
                  class="hidden"
                  accept="image/png,image/jpeg,image/svg+xml"
                  (change)="onLogoSelect($event)"
                />
              </label>
            }
          </div>
          <div class="flex-1">
            <label
              for="org-name"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Organization name
            </label>
            <input pInputText id="org-name" class="w-full" [(ngModel)]="orgName" />
            <div class="mt-3 flex items-center gap-3">
              <button
                pButton
                type="button"
                label="Save"
                size="small"
                [loading]="savingName()"
                [disabled]="!nameChanged()"
                (click)="saveOrgName()"
              ></button>
            </div>
          </div>
        </div>
      </div>

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
              <p-select
                [options]="roleOptions"
                [ngModel]="member.role"
                (ngModelChange)="changeMemberRole(member, $event)"
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
  private readonly messageService = inject(MessageService);

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
  savingName = signal(false);
  inviteEmail = '';
  inviteRole: 'owner' | 'member' = 'member';
  orgName = '';

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
    this.orgName = this.tenant()?.name ?? '';
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

  nameChanged(): boolean {
    const t = this.tenant();
    return !!t && this.orgName.trim() !== t.name;
  }

  async saveOrgName(): Promise<void> {
    const t = this.tenant();
    if (!t || this.orgName.trim() === t.name) return;
    this.savingName.set(true);
    try {
      const updated = await this.tenantService.updateTenant(this.tenantId, {
        name: this.orgName.trim(),
      });
      this.tenant.set(updated);
      this.removeError.set(null);
      this.messageService.add({
        severity: 'success',
        summary: 'Organization name updated.',
        life: 3000,
      });
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to update name');
    } finally {
      this.savingName.set(false);
    }
  }

  async changeMemberRole(member: TenantMember, newRole: 'owner' | 'member'): Promise<void> {
    try {
      await this.tenantService.updateMemberRole(this.tenantId, member.user_id, newRole);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Role updated.', life: 3000 });
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to update role');
    }
  }

  async onLogoSelect(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      this.removeError.set('Logo must be under 2MB');
      return;
    }
    try {
      const logoUrl = await this.tenantService.uploadLogo(this.tenantId, file);
      const updated = await this.tenantService.updateTenant(this.tenantId, { logo_url: logoUrl });
      this.tenant.set(updated);
      this.messageService.add({ severity: 'success', summary: 'Logo updated.', life: 3000 });
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to upload logo');
    }
  }

  async removeLogo(): Promise<void> {
    try {
      await this.tenantService.deleteLogo(this.tenantId);
      const updated = await this.tenantService.updateTenant(this.tenantId, { logo_url: null });
      this.tenant.set(updated);
      this.messageService.add({ severity: 'success', summary: 'Logo removed.', life: 3000 });
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to remove logo');
    }
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
      this.messageService.add({ severity: 'success', summary: 'Invite sent.', life: 3000 });
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
      this.messageService.add({ severity: 'success', summary: 'Member removed.', life: 3000 });
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
