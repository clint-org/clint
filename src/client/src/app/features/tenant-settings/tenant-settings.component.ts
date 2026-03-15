import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { MessageModule } from 'primeng/message';

import { Tenant, TenantMember, TenantInvite } from '../../core/models/tenant.model';
import { TenantService } from '../../core/services/tenant.service';

@Component({
  selector: 'app-tenant-settings',
  standalone: true,
  imports: [RouterLink, FormsModule, TableModule, ButtonModule, Dialog, InputText, Select, MessageModule],
  template: `
    <div class="min-h-screen bg-slate-50">
      <div class="bg-white border-b border-slate-200">
        <div class="h-0.5 bg-teal-500"></div>
        <div class="mx-auto max-w-4xl flex items-center justify-between px-6 py-4">
          <h1 class="text-xl font-bold text-slate-900">{{ tenant()?.name }} -- Settings</h1>
          <p-button label="Back to Spaces" icon="fa-solid fa-arrow-left" severity="secondary" [outlined]="true" size="small" [routerLink]="['/t', tenantId, 'spaces']" />
        </div>
      </div>

      <div class="mx-auto max-w-4xl px-6 py-8 space-y-8">
        <!-- Members -->
        <section>
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-slate-900">Members</h2>
            <p-button label="Invite Member" icon="fa-solid fa-plus" size="small" (onClick)="inviteDialogOpen.set(true)" />
          </div>

          <p-table [value]="members()" [loading]="loading()">
            <ng-template #header>
              <tr>
                <th>User ID</th>
                <th>Role</th>
                <th class="text-right">Actions</th>
              </tr>
            </ng-template>
            <ng-template #body let-member>
              <tr>
                <td class="text-sm">{{ member.user_id }}</td>
                <td class="text-sm capitalize">{{ member.role }}</td>
                <td class="text-right">
                  <p-button label="Remove" [text]="true" severity="danger" size="small" (onClick)="removeMember(member)" />
                </td>
              </tr>
            </ng-template>
          </p-table>
        </section>

        <!-- Pending Invites -->
        <section>
          <h2 class="text-lg font-semibold text-slate-900 mb-4">Pending Invites</h2>
          @if (invites().length === 0) {
            <p class="text-sm text-slate-500">No pending invites.</p>
          } @else {
            <p-table [value]="invites()">
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
                  <td class="text-sm">{{ invite.email }}</td>
                  <td class="text-sm capitalize">{{ invite.role }}</td>
                  <td class="text-sm font-mono">{{ invite.invite_code }}</td>
                  <td class="text-sm">{{ invite.expires_at }}</td>
                </tr>
              </ng-template>
            </p-table>
          }
        </section>
      </div>
    </div>

    <p-dialog header="Invite Member" [(visible)]="inviteDialogOpen" [modal]="true" [style]="{ width: '24rem' }">
      <form (ngSubmit)="sendInvite()" class="space-y-4">
        <div>
          <label for="invite-email" class="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input pInputText id="invite-email" class="w-full" [(ngModel)]="inviteEmail" name="email" type="email" required />
        </div>
        <div>
          <label for="invite-role" class="block text-sm font-medium text-slate-700 mb-1">Role</label>
          <p-select inputId="invite-role" [options]="roleOptions" [(ngModel)]="inviteRole" name="role" optionLabel="label" optionValue="value" [style]="{ width: '100%' }" />
        </div>
        @if (inviteError()) {
          <p-message severity="error" [closable]="false">{{ inviteError() }}</p-message>
        }
      </form>
      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" [outlined]="true" (onClick)="inviteDialogOpen.set(false)" />
        <p-button label="Send Invite" (onClick)="sendInvite()" [loading]="inviting()" />
      </ng-template>
    </p-dialog>
  `,
})
export class TenantSettingsComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private tenantService = inject(TenantService);

  tenantId = '';
  tenant = signal<Tenant | null>(null);
  members = signal<TenantMember[]>([]);
  invites = signal<TenantInvite[]>([]);
  loading = signal(true);
  inviteDialogOpen = signal(false);
  inviting = signal(false);
  inviteError = signal<string | null>(null);
  inviteEmail = '';
  inviteRole: 'owner' | 'member' = 'member';

  readonly roleOptions = [
    { label: 'Member', value: 'member' },
    { label: 'Owner', value: 'owner' },
  ];

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    await this.loadData();
  }

  async sendInvite(): Promise<void> {
    if (!this.inviteEmail.trim()) return;
    this.inviting.set(true);
    this.inviteError.set(null);

    try {
      await this.tenantService.createInvite(this.tenantId, this.inviteEmail.trim(), this.inviteRole);
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
    if (!window.confirm('Remove this member?')) return;
    try {
      await this.tenantService.removeMember(this.tenantId, member.user_id);
      await this.loadData();
    } catch {
      // handle silently
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
    } finally {
      this.loading.set(false);
    }
  }
}
