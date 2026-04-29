import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';

import { Tenant, TenantMember, TenantInvite } from '../../core/models/tenant.model';
import { TenantService } from '../../core/services/tenant.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../shared/components/status-tag.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../core/services/topbar-state.service';

@Component({
  selector: 'app-tenant-settings',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    ButtonModule,
    Dialog,
    InputText,
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

      <!-- Tenant identity (branding + name): editable when direct customer,
           read-only card when agency-managed -->
      @if (!tenant()?.agency_id) {
        <div class="mb-8 max-w-xl">
          <div class="flex items-start gap-4">
            <div class="flex flex-col items-center gap-2">
              @if (tenant()?.logo_url) {
                <img
                  [src]="tenant()!.logo_url"
                  class="h-16 w-16 rounded-xl object-cover border border-slate-200"
                  alt="Tenant logo"
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
                  class="flex h-16 w-16 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-slate-300 text-[10px] text-slate-400 hover:border-brand-400 hover:text-brand-500 transition-colors"
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
                for="tenant-name"
                class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Tenant name
              </label>
              <input
                pInputText
                id="tenant-name"
                class="w-full"
                [ngModel]="tenantNameDraft()"
                (ngModelChange)="tenantNameDraft.set($event)"
              />
              <div class="mt-3 flex items-center gap-3">
                <p-button
                  label="Save"
                  size="small"
                  [loading]="savingName()"
                  [disabled]="!nameChanged()"
                  (onClick)="saveOrgName()"
                />
              </div>
            </div>
          </div>
        </div>
      } @else {
        <div class="mb-8 max-w-xl rounded border border-slate-200 bg-slate-50 px-4 py-3">
          <div class="flex items-start gap-3">
            @if (tenant()?.logo_url) {
              <img
                [src]="tenant()!.logo_url"
                class="h-10 w-10 rounded object-cover border border-slate-200"
                alt="Tenant logo"
              />
            }
            <div class="flex-1">
              <p class="text-sm font-semibold text-slate-900">{{ tenant()?.name }}</p>
              <p class="mt-1 text-[11px] text-slate-500">
                Branding (name and logo) is managed by your agency. Contact them to
                update.
              </p>
            </div>
          </div>
        </div>
      }

      <!-- Tenant owners -->
      <div class="mb-3 flex items-baseline justify-between">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Tenant owners
        </h2>
        <span class="text-[11px] text-slate-400 tabular-nums">{{ members().length }}</span>
      </div>
      <p class="mb-3 text-[11px] text-slate-500 max-w-xl">
        Tenant owners can rename the tenant, manage other owners, and provision spaces.
        Data access is granted per-space &mdash; owners must add themselves to a space to
        see its data.
      </p>
      <p-table
        styleClass="data-table"
        [value]="members()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '40rem' }"
        aria-label="Tenant owners"
      >
        <ng-template #header>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th class="col-actions"></th>
          </tr>
        </ng-template>
        <ng-template #body let-member>
          <tr>
            <td>{{ member.display_name }}</td>
            <td class="col-identifier">{{ member.email }}</td>
            <td class="col-actions">
              @if (!isSelf(member)) {
                <app-row-actions
                  [items]="memberMenu(member)"
                  [ariaLabel]="'Actions for ' + member.display_name"
                />
              }
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="3">No owners.</td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Pending owner invites -->
      <div class="mt-10 mb-3 flex items-baseline justify-between">
        <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Pending invites
        </h2>
        <span class="text-[11px] text-slate-400 tabular-nums">{{ invites().length }}</span>
      </div>
      <p-table
        styleClass="data-table"
        [value]="invites()"
        [tableStyle]="{ 'min-width': '40rem' }"
        aria-label="Pending owner invites"
      >
        <ng-template #header>
          <tr>
            <th>Email</th>
            <th>Code</th>
            <th>Expires</th>
          </tr>
        </ng-template>
        <ng-template #body let-invite>
          <tr>
            <td>{{ invite.email }}</td>
            <td class="col-identifier">{{ invite.invite_code }}</td>
            <td class="col-identifier">{{ invite.expires_at | date: 'MMM d, y' }}</td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="3">No pending invites.</td>
          </tr>
        </ng-template>
      </p-table>

      <!-- Danger zone (owner-only, direct-customer tenants only) -->
      @if (currentUserIsOwner() && !tenant()?.agency_id) {
        <div class="mt-12 max-w-xl border-t border-slate-200 pt-6">
          <h3 class="text-xs font-semibold text-red-600">Danger zone</h3>
          <p class="mt-1 text-xs text-slate-500">
            Deleting a tenant permanently removes every space, owner, invite, and
            data record inside it. This cannot be undone.
          </p>
          <p-button
            label="Delete tenant"
            severity="danger"
            [outlined]="true"
            size="small"
            styleClass="mt-3"
            [loading]="deletingTenant()"
            (onClick)="confirmDeleteTenant()"
          />
        </div>
      }
    </app-manage-page-shell>

    <p-dialog
      header="Add tenant owner"
      [(visible)]="inviteDialogOpen"
      [modal]="true"
      [style]="{ width: '32rem' }"
      (onHide)="resetInviteForm()"
    >
      <p class="mb-3 text-xs text-slate-500">
        Enter the new owner's email. If the agency has an email-domain restriction,
        the email must be on that domain. If the user already has an account they're
        added immediately; otherwise an invite code is held for them.
      </p>
      <form (ngSubmit)="sendInvite()" class="space-y-4">
        <div>
          <label for="invite-email" class="mb-1 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            pInputText
            id="invite-email"
            class="w-full"
            [ngModel]="inviteEmail()"
            (ngModelChange)="inviteEmail.set($event)"
            name="email"
            type="email"
            required
          />
        </div>
        @if (inviteResult()) {
          <p-message severity="success" [closable]="false">
            {{ inviteResult() }}
          </p-message>
        }
        @if (inviteError()) {
          <p-message severity="error" [closable]="false">{{ inviteError() }}</p-message>
        }
      </form>
      <ng-template #footer>
        <p-button
          label="Close"
          severity="secondary"
          [outlined]="true"
          (onClick)="inviteDialogOpen.set(false)"
        />
        <p-button label="Add owner" (onClick)="sendInvite()" [loading]="inviting()" />
      </ng-template>
    </p-dialog>
  `,
})
export class TenantSettingsComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private tenantService = inject(TenantService);
  private supabase = inject(SupabaseService);
  private confirmation = inject(ConfirmationService);
  private readonly topbarState = inject(TopbarStateService);
  private readonly messageService = inject(MessageService);

  private readonly menuCache = new Map<string, MenuItem[]>();

  tenantId = '';
  tenant = signal<Tenant | null>(null);
  members = signal<TenantMember[]>([]);
  invites = signal<TenantInvite[]>([]);
  loading = signal(true);
  inviteDialogOpen = signal(false);
  inviting = signal(false);
  inviteError = signal<string | null>(null);
  inviteResult = signal<string | null>(null);
  removeError = signal<string | null>(null);
  savingName = signal(false);
  deletingTenant = signal(false);
  readonly inviteEmail = signal('');
  readonly tenantNameDraft = signal('');

  readonly currentUserIsOwner = computed(() => {
    const userId = this.supabase.currentUser()?.id;
    if (!userId) return false;
    return this.members().some((m) => m.user_id === userId && m.role === 'owner');
  });

  isSelf(member: TenantMember): boolean {
    return member.user_id === this.supabase.currentUser()?.id;
  }

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
        label: 'Add owner',
        icon: 'fa-solid fa-plus',
        callback: () => this.openInviteDialog(),
      },
    ]);
    await this.loadData();
    this.tenantNameDraft.set(this.tenant()?.name ?? '');
  }

  ngOnDestroy(): void {
    this.topbarState.clear();
  }

  memberMenu(member: TenantMember): MenuItem[] {
    const cached = this.menuCache.get(member.user_id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Remove owner',
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
    return !!t && this.tenantNameDraft().trim() !== t.name;
  }

  async saveOrgName(): Promise<void> {
    const t = this.tenant();
    if (!t || this.tenantNameDraft().trim() === t.name) return;
    this.savingName.set(true);
    try {
      const updated = await this.tenantService.updateTenant(this.tenantId, {
        name: this.tenantNameDraft().trim(),
      });
      this.tenant.set(updated);
      this.removeError.set(null);
      this.messageService.add({
        severity: 'success',
        summary: 'Tenant name updated.',
        life: 3000,
      });
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to update name');
    } finally {
      this.savingName.set(false);
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

  openInviteDialog(): void {
    this.resetInviteForm();
    this.inviteDialogOpen.set(true);
  }

  resetInviteForm(): void {
    this.inviteEmail.set('');
    this.inviteError.set(null);
    this.inviteResult.set(null);
  }

  async sendInvite(): Promise<void> {
    const email = this.inviteEmail().trim();
    if (!email) return;
    this.inviting.set(true);
    this.inviteError.set(null);
    this.inviteResult.set(null);

    try {
      const result = await this.tenantService.addTenantOwner(this.tenantId, email);
      if (result.owner_invited) {
        this.inviteResult.set(
          `Invite held for ${email}. Code: ${result.invite_code}`
        );
      } else {
        this.inviteResult.set(`${email} added as tenant owner.`);
      }
      await this.loadData();
      this.inviteEmail.set('');
    } catch (e) {
      this.inviteError.set(e instanceof Error ? e.message : 'Failed to add owner');
    } finally {
      this.inviting.set(false);
    }
  }

  async confirmDeleteTenant(): Promise<void> {
    const t = this.tenant();
    if (!t) return;
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete tenant',
      message:
        `Delete "${t.name}"? Every space, owner, invite, and data record in this ` +
        `tenant will be permanently removed. This cannot be undone.`,
      acceptLabel: 'Delete tenant',
    });
    if (!ok) return;

    this.deletingTenant.set(true);
    try {
      await this.tenantService.deleteTenant(this.tenantId);
      this.router.navigate(['/']);
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to delete tenant');
    } finally {
      this.deletingTenant.set(false);
    }
  }

  async removeMember(member: TenantMember): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Remove owner',
      message: `Remove ${member.display_name} as a tenant owner? They will lose access immediately.`,
      acceptLabel: 'Remove',
    });
    if (!ok) return;
    try {
      await this.tenantService.removeMember(this.tenantId, member.user_id);
      await this.loadData();
      this.messageService.add({ severity: 'success', summary: 'Owner removed.', life: 3000 });
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to remove owner');
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [tenantResult, membersResult, invitesResult] = await Promise.allSettled([
        this.tenantService.getTenant(this.tenantId),
        this.tenantService.listMembers(this.tenantId),
        this.tenantService.listInvites(this.tenantId),
      ]);

      if (tenantResult.status === 'fulfilled') {
        this.tenant.set(tenantResult.value);
      } else {
        console.error('tenant-settings: failed to load tenant', tenantResult.reason);
      }

      if (membersResult.status === 'fulfilled') {
        this.members.set(membersResult.value);
      } else {
        console.error('tenant-settings: failed to load members', membersResult.reason);
      }

      if (invitesResult.status === 'fulfilled') {
        this.invites.set(invitesResult.value);
      } else {
        console.error('tenant-settings: failed to load invites', invitesResult.reason);
      }

      this.menuCache.clear();
    } finally {
      this.loading.set(false);
    }
  }
}
