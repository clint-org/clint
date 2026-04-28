import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { CheckboxModule } from 'primeng/checkbox';

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
    FormsModule,
    TableModule,
    ButtonModule,
    Dialog,
    InputText,
    Select,
    MessageModule,
    CheckboxModule,
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
              for="org-name"
              class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Tenant name
            </label>
            <input pInputText id="org-name" class="w-full" [(ngModel)]="orgName" />
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
        aria-label="Tenant members"
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

      <!-- Access (owner-only) -->
      @if (currentUserIsOwner()) {
        <div class="mt-12 max-w-xl border-t border-slate-200 pt-6">
          <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Access
          </h2>
          <p class="mt-1 text-xs text-slate-500">
            Allow employees with email addresses on approved domains to join this
            workspace automatically when they sign in on this subdomain.
          </p>

          @if (accessLoading()) {
            <p class="mt-4 text-xs text-slate-400">Loading access settings...</p>
          } @else {
            <div class="mt-4 flex items-center gap-2">
              <p-checkbox
                inputId="self-join-toggle"
                [(ngModel)]="selfJoinEnabled"
                [binary]="true"
              />
              <label for="self-join-toggle" class="cursor-pointer text-xs text-slate-700">
                Enable self-join from approved email domains
              </label>
            </div>

            @if (selfJoinEnabled) {
              <div class="mt-4">
                <label
                  for="domain-input"
                  class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                >
                  Approved email domains
                </label>
                <div class="flex items-center gap-2">
                  <input
                    pInputText
                    id="domain-input"
                    class="flex-1"
                    placeholder="acme.com"
                    [(ngModel)]="newDomain"
                    (keydown.enter)="addDomain(); $event.preventDefault()"
                    [attr.aria-invalid]="domainError() ? 'true' : null"
                    aria-describedby="domain-input-help"
                  />
                  <p-button
                    label="Add"
                    size="small"
                    [outlined]="true"
                    (onClick)="addDomain()"
                  />
                </div>
                <p id="domain-input-help" class="mt-1 text-[11px] text-slate-400">
                  Lowercase domain like <code class="font-mono">acme.com</code>. Press
                  Enter or Add to include it.
                </p>
                @if (domainError()) {
                  <p class="mt-1 text-[11px] text-red-600" role="alert">
                    {{ domainError() }}
                  </p>
                }

                @if (allowlist().length > 0) {
                  <ul
                    class="mt-3 flex flex-wrap gap-1.5"
                    aria-label="Approved email domains"
                  >
                    @for (domain of allowlist(); track domain) {
                      <li
                        class="inline-flex items-center gap-1.5 border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] tabular-nums text-slate-700"
                      >
                        <span class="font-mono">{{ domain }}</span>
                        <button
                          type="button"
                          class="text-slate-400 hover:text-red-600 focus:outline-none focus:text-red-600"
                          (click)="removeDomain(domain)"
                          [attr.aria-label]="'Remove ' + domain"
                        >
                          <i class="fa-solid fa-xmark text-[10px]"></i>
                        </button>
                      </li>
                    }
                  </ul>
                } @else {
                  <p class="mt-3 text-[11px] italic text-slate-400">
                    No domains added yet. Self-join will be effectively disabled until
                    at least one domain is approved.
                  </p>
                }
              </div>
            }

            <div class="mt-5">
              <p-button
                label="Save access settings"
                size="small"
                [loading]="savingAccess()"
                [disabled]="!accessChanged()"
                (onClick)="saveAccess()"
              />
            </div>
          }
        </div>
      }

      <!-- Danger zone (owner-only) -->
      @if (currentUserIsOwner()) {
        <div class="mt-12 max-w-xl border-t border-slate-200 pt-6">
          <h3 class="text-xs font-semibold text-red-600">Danger zone</h3>
          <p class="mt-1 text-xs text-slate-500">
            Deleting a tenant permanently removes every space, member, invite, and
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
  private supabase = inject(SupabaseService);
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
  deletingTenant = signal(false);
  inviteEmail = '';
  inviteRole: 'owner' | 'member' = 'member';
  orgName = '';

  // Access settings
  private static readonly DOMAIN_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/;
  accessLoading = signal(false);
  savingAccess = signal(false);
  selfJoinEnabled = false;
  allowlist = signal<string[]>([]);
  newDomain = '';
  domainError = signal<string | null>(null);
  // Snapshot of last-saved values for change detection
  private savedSelfJoinEnabled = false;
  private savedAllowlist: string[] = [];

  readonly roleOptions = [
    { label: 'Member', value: 'member' },
    { label: 'Owner', value: 'owner' },
  ];

  readonly currentUserIsOwner = computed(() => {
    const userId = this.supabase.currentUser()?.id;
    if (!userId) return false;
    return this.members().some((m) => m.user_id === userId && m.role === 'owner');
  });

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
    // Load access settings best-effort: only owners (and agency owners /
    // platform admins) are authorised by the RPC. The promise is awaited so
    // the form initialises with current values, but a permission failure
    // simply leaves the section in its empty default state.
    if (this.currentUserIsOwner()) {
      await this.loadAccessSettings();
    }
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
        summary: 'Tenant name updated.',
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

  async confirmDeleteTenant(): Promise<void> {
    const t = this.tenant();
    if (!t) return;
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete tenant',
      message:
        `Delete "${t.name}"? Every space, member, invite, and data record in this ` +
        `tenant will be permanently removed. This cannot be undone.`,
      acceptLabel: 'Delete tenant',
    });
    if (!ok) return;

    this.deletingTenant.set(true);
    try {
      await this.tenantService.deleteTenant(this.tenantId);
      // landing on `/` triggers marketingLandingGuard which routes to
      // another tenant or onboarding, depending on what's left.
      this.router.navigate(['/']);
    } catch (e) {
      this.removeError.set(e instanceof Error ? e.message : 'Failed to delete tenant');
    } finally {
      this.deletingTenant.set(false);
    }
  }

  async removeMember(member: TenantMember): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Remove member',
      message: `Remove ${member.display_name} from this tenant? They will lose access immediately.`,
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
      // allSettled so a failure on one section (e.g. listMembers blowing up
      // on a permissions issue) doesn't blank out the whole page. Each
      // successful call still updates its slice.
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

  private async loadAccessSettings(): Promise<void> {
    this.accessLoading.set(true);
    try {
      const settings = await this.tenantService.getTenantAccessSettings(this.tenantId);
      this.selfJoinEnabled = settings.email_self_join_enabled;
      const list = Array.from(settings.email_domain_allowlist ?? []);
      this.allowlist.set(list);
      this.savedSelfJoinEnabled = this.selfJoinEnabled;
      this.savedAllowlist = [...list];
    } catch (e) {
      // permission denied or transient: leave defaults
      console.error('tenant-settings: failed to load access settings', e);
    } finally {
      this.accessLoading.set(false);
    }
  }

  accessChanged(): boolean {
    if (this.selfJoinEnabled !== this.savedSelfJoinEnabled) return true;
    const a = this.allowlist();
    const b = this.savedAllowlist;
    if (a.length !== b.length) return true;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return true;
    }
    return false;
  }

  addDomain(): void {
    this.domainError.set(null);
    const raw = (this.newDomain ?? '').trim().toLowerCase();
    if (!raw) return;
    if (!TenantSettingsComponent.DOMAIN_RE.test(raw)) {
      this.domainError.set(
        `"${raw}" is not a valid domain. Use lowercase letters, digits, dots, or hyphens (e.g. acme.com).`
      );
      return;
    }
    if (this.allowlist().includes(raw)) {
      this.domainError.set(`"${raw}" is already in the list.`);
      return;
    }
    this.allowlist.update((list) => [...list, raw]);
    this.newDomain = '';
  }

  removeDomain(domain: string): void {
    this.allowlist.update((list) => list.filter((d) => d !== domain));
    this.domainError.set(null);
  }

  async saveAccess(): Promise<void> {
    this.savingAccess.set(true);
    this.domainError.set(null);
    try {
      const list = this.allowlist();
      // Re-validate client-side; the RPC will reject server-side too.
      for (const d of list) {
        if (!TenantSettingsComponent.DOMAIN_RE.test(d)) {
          this.domainError.set(`Invalid domain in list: ${d}`);
          this.savingAccess.set(false);
          return;
        }
      }
      await this.tenantService.updateTenantAccess(this.tenantId, {
        email_domain_allowlist: list,
        email_self_join_enabled: this.selfJoinEnabled,
      });
      this.savedSelfJoinEnabled = this.selfJoinEnabled;
      this.savedAllowlist = [...list];
      this.messageService.add({
        severity: 'success',
        summary: 'Access settings updated.',
        life: 3000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Failed to update access settings',
        detail: e instanceof Error ? e.message : String(e),
        life: 5000,
      });
    } finally {
      this.savingAccess.set(false);
    }
  }
}
