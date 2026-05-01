import { Component, computed, inject, OnDestroy, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmationService, MenuItem, MessageService } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { MultiSelectModule } from 'primeng/multiselect';
import { MessageModule } from 'primeng/message';

import { Tenant, TenantMember, TenantInvite } from '../../core/models/tenant.model';
import { MATERIAL_DEFAULT_ALLOWED_MIME } from '../../core/models/material.model';
import { Agency } from '../../core/models/agency.model';
import { TenantService } from '../../core/services/tenant.service';
import { AgencyService } from '../../core/services/agency.service';
import { BrandContextService } from '../../core/services/brand-context.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { environment } from '../../../environments/environment';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../shared/components/status-tag.component';
import { confirmDelete } from '../../shared/utils/confirm-delete';
import { TopbarStateService } from '../../core/services/topbar-state.service';
import { extractErrorMessage } from '../../core/util/error-message';

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
    InputNumberModule,
    MultiSelectModule,
    MessageModule,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    RouterLink,
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
              @if (primaryColor()) {
                <div class="mt-1.5 flex items-center gap-1.5">
                  <span
                    class="inline-block h-3 w-3 rounded-sm border border-slate-300"
                    [style.background-color]="primaryColor()"
                    [attr.aria-label]="'Primary color ' + primaryColor()"
                  ></span>
                  <span class="text-[10px] font-mono uppercase text-slate-400">{{
                    primaryColor()
                  }}</span>
                </div>
              }
              <p class="mt-2 text-[11px] text-slate-500">
                Branding for this workspace is managed by
                {{ agencyName() ?? 'your agency' }}.
                @if (agencyPortalUrl()) {
                  <a [href]="agencyPortalUrl()" class="text-brand-700 hover:underline"
                    >Open the agency portal</a
                  >
                  to make changes.
                } @else {
                  Contact them to request changes.
                }
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
        Tenant owners can rename the tenant, manage other owners, and provision spaces. Data access
        is granted per-space &mdash; owners must add themselves to a space to see its data.
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
            <td>
              {{ member.display_name }}
              @if (member.is_agency_backed) {
                <span
                  class="ml-2 inline-flex items-center rounded-sm bg-slate-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.08em] text-slate-500"
                  title="This user has access via the parent agency. Manage their access from the agency portal."
                >
                  via agency
                </span>
              }
            </td>
            <td class="col-identifier">{{ member.email }}</td>
            <td class="col-actions">
              @if (!isSelf(member) && !member.is_agency_backed) {
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

      <!-- Material upload limits (owner-only) -->
      @if (currentUserIsOwner()) {
        <div class="mt-12 max-w-xl border-t border-slate-200 pt-6">
          <h3 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Material upload limits
          </h3>
          <p class="mt-1 text-[11px] text-slate-500">
            Per-tenant caps applied to every engagement material upload. Files exceeding the size
            limit or using a mime type outside the allowlist are rejected by the server.
          </p>

          <div class="mt-4 space-y-4">
            <div>
              <label
                for="material-max-size-mb"
                class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Max file size (MB)
              </label>
              <p-inputnumber
                inputId="material-max-size-mb"
                [ngModel]="materialMaxSizeMb()"
                (ngModelChange)="materialMaxSizeMb.set($event)"
                [min]="1"
                [max]="2048"
                [showButtons]="true"
                buttonLayout="horizontal"
                inputStyleClass="w-32 text-right"
                styleClass="w-44"
              />
            </div>

            <div>
              <label
                for="material-mime-types"
                class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Allowed mime types
              </label>
              <p-multiselect
                inputId="material-mime-types"
                [options]="materialMimeOptions"
                [ngModel]="materialAllowedMimeTypes()"
                (ngModelChange)="materialAllowedMimeTypes.set($event ?? [])"
                optionLabel="label"
                optionValue="value"
                display="chip"
                [showClear]="true"
                placeholder="None selected"
                styleClass="w-full"
                appendTo="body"
              />
            </div>

            @if (materialSettingsError()) {
              <p-message severity="error" [closable]="false">
                {{ materialSettingsError() }}
              </p-message>
            }

            <div class="flex items-center gap-3">
              <p-button
                label="Save limits"
                size="small"
                [loading]="savingMaterialSettings()"
                [disabled]="!materialSettingsChanged()"
                (onClick)="saveMaterialSettings()"
              />
            </div>
          </div>
        </div>
      }

      <!-- Danger zone (owner-only, direct-customer tenants only) -->
      @if (currentUserIsOwner() && !tenant()?.agency_id) {
        <div class="mt-12 max-w-xl border-t border-slate-200 pt-6">
          <h3 class="text-xs font-semibold text-red-600">Danger zone</h3>
          <p class="mt-1 text-xs text-slate-500">
            Deleting a tenant permanently removes every space, owner, invite, and data record inside
            it. This cannot be undone.
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
        Enter the new owner's email. If the agency has an email-domain restriction, the email must
        be on that domain. If the user already has an account they're added immediately; otherwise
        an invite code is held for them.
        <a [routerLink]="rolesHelpLink()" class="ml-1 text-brand-700 hover:underline"
          >Roles and permissions</a
        >.
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
  private agencyService = inject(AgencyService);
  private brand = inject(BrandContextService);
  private supabase = inject(SupabaseService);
  private confirmation = inject(ConfirmationService);
  private readonly topbarState = inject(TopbarStateService);
  private readonly messageService = inject(MessageService);

  private readonly menuCache = new Map<string, MenuItem[]>();

  rolesHelpLink(): string[] {
    return ['/t', this.tenantId, 'help', 'roles'];
  }

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

  // Material upload limit drafts (owner-only UI). Stored in MB on the
  // client for legibility; converted to bytes on save.
  readonly materialMaxSizeMb = signal<number>(50);
  readonly materialAllowedMimeTypes = signal<string[]>([...MATERIAL_DEFAULT_ALLOWED_MIME]);
  readonly savingMaterialSettings = signal(false);
  readonly materialSettingsError = signal<string | null>(null);

  protected readonly materialMimeOptions = [
    {
      label: 'PowerPoint (.pptx)',
      value: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    },
    { label: 'PDF (.pdf)', value: 'application/pdf' },
    {
      label: 'Word (.docx)',
      value: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    },
    { label: 'Word (legacy .doc)', value: 'application/msword' },
    {
      label: 'PowerPoint (legacy .ppt)',
      value: 'application/vnd.ms-powerpoint',
    },
  ];

  readonly materialSettingsChanged = computed(() => {
    const t = this.tenant();
    if (!t) return false;
    const currentBytes = t.material_max_size_bytes ?? 52428800;
    const draftBytes = Math.max(1, this.materialMaxSizeMb()) * 1024 * 1024;
    if (draftBytes !== currentBytes) return true;
    const currentMimes = (t.material_allowed_mime_types ?? []).slice().sort();
    const draftMimes = this.materialAllowedMimeTypes().slice().sort();
    if (currentMimes.length !== draftMimes.length) return true;
    return currentMimes.some((m, i) => m !== draftMimes[i]);
  });

  // Parent agency record, populated only when the current user is a member
  // of the tenant's parent agency. Drives the cross-host "Open agency portal"
  // link on the read-only branding card; null leaves only the contact prompt.
  parentAgency = signal<Agency | null>(null);

  readonly agencyPortalUrl = computed(() => {
    const a = this.parentAgency();
    if (!a || !environment.apexDomain) return null;
    const host = a.custom_domain ?? `${a.subdomain}.${environment.apexDomain}`;
    return `${window.location.protocol}//${host}/admin`;
  });

  readonly agencyName = computed(() => this.brand.agency()?.name ?? null);
  readonly primaryColor = this.brand.primaryColor;

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
    this.seedMaterialSettingDrafts();

    // If the tenant has a parent agency AND the current user is a member of
    // that agency, surface a cross-host link to the agency portal in the
    // read-only branding card. listMyAgencies is RLS-filtered to my agencies
    // only, so finding a match here implies membership without an extra RPC.
    const agencyId = this.tenant()?.agency_id;
    if (agencyId) {
      try {
        const mine = await this.agencyService.listMyAgencies();
        const match = mine.find((a) => a.id === agencyId);
        if (match) this.parentAgency.set(match);
      } catch {
        // Non-members get [] (RLS-filtered); leave parentAgency null.
      }
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
        this.inviteResult.set(`Invite held for ${email}. Code: ${result.invite_code}`);
      } else {
        this.inviteResult.set(`${email} added as tenant owner.`);
      }
      await this.loadData();
      this.inviteEmail.set('');
    } catch (e) {
      this.inviteError.set(extractErrorMessage(e, 'Failed to add owner'));
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

  private seedMaterialSettingDrafts(): void {
    const t = this.tenant();
    if (!t) return;
    const bytes = t.material_max_size_bytes ?? 52428800;
    this.materialMaxSizeMb.set(Math.max(1, Math.round(bytes / (1024 * 1024))));
    this.materialAllowedMimeTypes.set(
      t.material_allowed_mime_types ?? [...MATERIAL_DEFAULT_ALLOWED_MIME]
    );
    this.materialSettingsError.set(null);
  }

  async saveMaterialSettings(): Promise<void> {
    if (!this.materialSettingsChanged()) return;
    this.savingMaterialSettings.set(true);
    this.materialSettingsError.set(null);
    try {
      const updated = await this.tenantService.updateTenant(this.tenantId, {
        material_max_size_bytes: Math.max(1, this.materialMaxSizeMb()) * 1024 * 1024,
        material_allowed_mime_types: this.materialAllowedMimeTypes() ?? [],
      });
      this.tenant.set(updated);
      this.seedMaterialSettingDrafts();
      this.messageService.add({
        severity: 'success',
        summary: 'Material upload limits saved.',
        life: 3000,
      });
    } catch (e) {
      this.materialSettingsError.set(
        e instanceof Error ? e.message : 'Failed to save material limits.'
      );
    } finally {
      this.savingMaterialSettings.set(false);
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
