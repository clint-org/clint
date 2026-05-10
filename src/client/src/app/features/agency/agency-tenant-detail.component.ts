import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { ColorPicker } from 'primeng/colorpicker';
import { Dialog } from 'primeng/dialog';
import { TableModule } from 'primeng/table';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';

import { AgencyService } from '../../core/services/agency.service';
import { TenantService } from '../../core/services/tenant.service';
import { TenantBrandFields, TenantBrandingUpdate } from '../../core/models/agency.model';
import { TenantMember } from '../../core/models/tenant.model';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { StatusTagComponent } from '../../shared/components/status-tag.component';
import { environment } from '../../../environments/environment';
import { extractErrorMessage } from '../../core/util/error-message';

@Component({
  selector: 'app-agency-tenant-detail',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputText,
    ColorPicker,
    Dialog,
    TableModule,
    MessageModule,
    ManagePageShellComponent,
    StatusTagComponent,
  ],
  template: `
    <app-manage-page-shell>
      <div class="mb-6 flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            class="text-xs text-slate-500 hover:text-slate-900 mb-2"
            (click)="onBack()"
          >
            <i class="fa-solid fa-arrow-left mr-1.5"></i>Back to tenants
          </button>
          @if (tenant(); as t) {
            <h1 class="text-base font-semibold text-slate-900">{{ t.name }}</h1>
            <div class="mt-1 flex items-center gap-3 text-xs text-slate-500">
              @if (t.subdomain) {
                <span class="font-mono">{{ t.subdomain }}</span>
              }
              @if (t.suspended_at) {
                <app-status-tag label="suspended" tone="amber" />
              } @else {
                <app-status-tag label="active" tone="teal" />
              }
            </div>
          }
        </div>
        <p-button
          label="Open tenant"
          icon="fa-solid fa-arrow-up-right-from-square"
          size="small"
          severity="secondary"
          [outlined]="true"
          [disabled]="!tenant()"
          (onClick)="onOpenTenant()"
        />
      </div>

      @if (loadError()) {
        <p-message
          severity="error"
          [closable]="true"
          (onClose)="loadError.set(null)"
          styleClass="mb-4"
        >
          {{ loadError() }}
        </p-message>
      }

      @if (tenant(); as t) {
        <!-- Branding section -->
        <section class="mb-10 max-w-2xl">
          <h2 class="mb-3 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
            Branding
          </h2>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div class="sm:col-span-2">
              <label
                for="display-name"
                class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                App display name
              </label>
              <input
                pInputText
                id="display-name"
                class="w-full"
                [ngModel]="appDisplayName()"
                (ngModelChange)="appDisplayName.set($event)"
                name="appDisplayName"
              />
            </div>

            <div>
              <label
                for="primary-color"
                class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Primary color
              </label>
              <div class="flex items-center gap-2">
                <p-colorpicker
                  [ngModel]="primaryColorRaw()"
                  (ngModelChange)="onPrimaryColorRawChange($event)"
                  name="primaryColor"
                />
                <input
                  pInputText
                  id="primary-color"
                  class="flex-1 font-mono text-xs"
                  [ngModel]="primaryColorHash()"
                  (ngModelChange)="primaryColorHash.set($event)"
                  name="primaryColorText"
                  maxlength="7"
                />
              </div>
            </div>

            <div class="sm:col-span-2">
              <label
                for="logo-url"
                class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Logo URL
              </label>
              <input
                pInputText
                id="logo-url"
                class="w-full"
                [ngModel]="logoUrl()"
                (ngModelChange)="logoUrl.set($event)"
                name="logoUrl"
                placeholder="https://..."
              />
            </div>

            <div class="sm:col-span-2">
              <label
                for="email-from-name"
                class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Email from name
              </label>
              <input
                pInputText
                id="email-from-name"
                class="w-full"
                [ngModel]="emailFromName()"
                (ngModelChange)="emailFromName.set($event)"
                name="emailFromName"
                placeholder="Defaults to display name"
              />
            </div>
          </div>
          <div class="mt-4 flex items-center gap-3">
            <p-button
              label="Save branding"
              size="small"
              [loading]="saving()"
              [disabled]="!hasChanges() || saving()"
              (onClick)="onSave()"
            />
            @if (saveError()) {
              <span class="text-xs text-red-600">{{ saveError() }}</span>
            }
          </div>
        </section>

        <!-- Tenant owners section -->
        <section>
          <div class="mb-3 flex items-baseline justify-between">
            <h2 class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Tenant owners
            </h2>
            <div class="flex items-center gap-3">
              <span class="text-[11px] text-slate-400 tabular-nums">{{ members().length }}</span>
              <p-button
                label="Add owner"
                icon="fa-solid fa-plus"
                size="small"
                [text]="true"
                (onClick)="openAddOwnerDialog()"
              />
            </div>
          </div>
          <p class="mb-3 text-[11px] text-slate-500 max-w-xl">
            Tenant owners can manage this tenant and add/remove other owners. They do NOT
            automatically see space data &mdash; they must be added to a space explicitly.
          </p>
          <p-table
            styleClass="data-table"
            [value]="members()"
            [loading]="membersLoading()"
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
                <td>{{ member.display_name || '--' }}</td>
                <td class="col-identifier">{{ member.email || member.user_id }}</td>
                <td class="col-actions">
                  <p-button
                    icon="fa-solid fa-user-minus"
                    size="small"
                    severity="secondary"
                    [text]="true"
                    [rounded]="true"
                    [ariaLabel]="'Remove ' + (member.email || member.user_id)"
                    (onClick)="removeOwner(member)"
                  />
                </td>
              </tr>
            </ng-template>
            <ng-template #emptymessage>
              <tr>
                <td colspan="3" class="text-center py-6 text-sm text-slate-500">
                  No tenant owners yet.
                </td>
              </tr>
            </ng-template>
          </p-table>
        </section>
      }
    </app-manage-page-shell>

    <!-- Add tenant owner dialog -->
    <p-dialog
      header="Add tenant owner"
      [(visible)]="addOwnerDialogOpen"
      [modal]="true"
      styleClass="!w-[32rem]"
      (onHide)="resetAddOwnerForm()"
    >
      <p class="mb-3 text-xs text-slate-500">
        Enter the new owner's email. If your agency has an email-domain restriction set, the email
        must be on that domain. Existing users are added immediately; otherwise an invite code is
        held.
      </p>
      <div>
        <label for="owner-email" class="mb-1 block text-sm font-medium text-slate-700">
          Email
        </label>
        <input
          pInputText
          id="owner-email"
          class="w-full"
          type="email"
          [ngModel]="newOwnerEmail()"
          (ngModelChange)="newOwnerEmail.set($event)"
          name="email"
          required
        />
      </div>
      @if (addOwnerResult()) {
        <p-message severity="success" [closable]="false" styleClass="mt-3">
          {{ addOwnerResult() }}
        </p-message>
      }
      @if (addOwnerError()) {
        <p-message severity="error" [closable]="false" styleClass="mt-3">
          {{ addOwnerError() }}
        </p-message>
      }
      <ng-template #footer>
        <p-button
          label="Close"
          severity="secondary"
          [outlined]="true"
          (onClick)="addOwnerDialogOpen.set(false)"
        />
        <p-button
          label="Add owner"
          (onClick)="addOwner()"
          [loading]="addingOwner()"
          [disabled]="!newOwnerEmail().trim()"
        />
      </ng-template>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgencyTenantDetailComponent implements OnInit {
  private readonly agencyService = inject(AgencyService);
  private readonly tenantService = inject(TenantService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);

  readonly tenant = signal<TenantBrandFields | null>(null);
  readonly members = signal<TenantMember[]>([]);
  readonly membersLoading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saveError = signal<string | null>(null);
  readonly saving = signal(false);

  readonly appDisplayName = signal('');
  readonly logoUrl = signal('');
  readonly emailFromName = signal('');
  // Canonical color storage uses the leading "#"; the colorpicker emits/expects the
  // bare hex, so we expose a derived view + a setter that re-adds the "#".
  readonly primaryColorHash = signal('#0d9488');
  readonly primaryColorRaw = computed(() => this.primaryColorHash().replace(/^#/, ''));

  // Add-tenant-owner dialog state.
  readonly addOwnerDialogOpen = signal(false);
  readonly addingOwner = signal(false);
  readonly newOwnerEmail = signal('');
  readonly addOwnerResult = signal<string | null>(null);
  readonly addOwnerError = signal<string | null>(null);

  private tenantId = '';

  readonly hasChanges = computed(() => {
    const t = this.tenant();
    if (!t) return false;
    const primary = this.normalizeHash(this.primaryColorHash());
    return (
      this.appDisplayName() !== (t.app_display_name ?? '') ||
      (this.logoUrl() || null) !== (t.logo_url ?? null) ||
      (this.emailFromName() || null) !== (t.email_from_name ?? null) ||
      primary !== (t.primary_color ?? '#0d9488').toLowerCase()
    );
  });

  onPrimaryColorRawChange(raw: string): void {
    const stripped = (raw || '').replace(/^#/, '').toLowerCase();
    this.primaryColorHash.set(stripped ? `#${stripped}` : '');
  }

  async ngOnInit(): Promise<void> {
    this.tenantId = this.route.snapshot.paramMap.get('id')!;
    await this.loadAll();
  }

  private async loadAll(): Promise<void> {
    try {
      const t = await this.agencyService.getTenantBranding(this.tenantId);
      this.tenant.set(t);
      this.appDisplayName.set(t.app_display_name ?? '');
      this.logoUrl.set(t.logo_url ?? '');
      this.emailFromName.set(t.email_from_name ?? '');
      this.primaryColorHash.set((t.primary_color ?? '#0d9488').toLowerCase());
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Failed to load tenant.');
    }

    this.membersLoading.set(true);
    try {
      const members = await this.tenantService.listMembers(this.tenantId);
      this.members.set(members);
    } catch (e) {
      console.warn('agency-tenant-detail: members load failed', e);
      this.members.set([]);
    } finally {
      this.membersLoading.set(false);
    }
  }

  async onSave(): Promise<void> {
    const t = this.tenant();
    if (!t) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const branding: TenantBrandingUpdate = {};
      const displayName = this.appDisplayName();
      if (displayName !== (t.app_display_name ?? '')) {
        branding.app_display_name = displayName.trim() || t.name;
      }
      const primary = this.normalizeHash(this.primaryColorHash());
      if (primary !== (t.primary_color ?? '#0d9488').toLowerCase()) {
        branding.primary_color = primary;
      }
      const newLogo = this.logoUrl().trim() || null;
      if (newLogo !== (t.logo_url ?? null)) {
        branding.logo_url = newLogo;
      }
      const newFromName = this.emailFromName().trim() || null;
      if (newFromName !== (t.email_from_name ?? null)) {
        branding.email_from_name = newFromName ?? undefined;
      }

      if (Object.keys(branding).length === 0) {
        this.saving.set(false);
        return;
      }

      await this.agencyService.updateTenantBranding(this.tenantId, branding);
      this.messageService.add({
        severity: 'success',
        summary: 'Branding updated.',
        life: 3000,
      });
      await this.loadAll();
    } catch (e) {
      this.saveError.set(e instanceof Error ? e.message : 'Failed to save branding.');
    } finally {
      this.saving.set(false);
    }
  }

  onBack(): void {
    this.router.navigate(['/admin/tenants']);
  }

  openAddOwnerDialog(): void {
    this.resetAddOwnerForm();
    this.addOwnerDialogOpen.set(true);
  }

  resetAddOwnerForm(): void {
    this.newOwnerEmail.set('');
    this.addOwnerResult.set(null);
    this.addOwnerError.set(null);
  }

  async addOwner(): Promise<void> {
    const email = this.newOwnerEmail().trim();
    if (!email) return;
    this.addingOwner.set(true);
    this.addOwnerResult.set(null);
    this.addOwnerError.set(null);
    try {
      const result = await this.tenantService.addTenantOwner(this.tenantId, email);
      if (result.owner_invited) {
        this.addOwnerResult.set(`Invite held for ${email}. Code: ${result.invite_code}`);
      } else {
        this.addOwnerResult.set(`${email} added as tenant owner.`);
      }
      this.newOwnerEmail.set('');
      // Refresh members list.
      try {
        this.members.set(await this.tenantService.listMembers(this.tenantId));
      } catch (e) {
        console.warn('agency-tenant-detail: members refresh failed', e);
      }
    } catch (e) {
      this.addOwnerError.set(extractErrorMessage(e, 'Failed to add owner'));
    } finally {
      this.addingOwner.set(false);
    }
  }

  async removeOwner(member: TenantMember): Promise<void> {
    const ok = confirm(
      `Remove ${member.email || member.user_id} as a tenant owner? They will lose access immediately.`
    );
    if (!ok) return;
    try {
      await this.tenantService.removeMember(this.tenantId, member.user_id);
      this.members.set(await this.tenantService.listMembers(this.tenantId));
      this.messageService.add({
        severity: 'success',
        summary: 'Owner removed.',
        life: 3000,
      });
    } catch (e) {
      this.messageService.add({
        severity: 'error',
        summary: 'Failed to remove owner',
        detail: e instanceof Error ? e.message : String(e),
        life: 5000,
      });
    }
  }

  onOpenTenant(): void {
    const t = this.tenant();
    if (!t) return;
    const apex = environment.apexDomain;
    if (apex && t.subdomain) {
      const proto = window.location.protocol;
      window.open(`${proto}//${t.subdomain}.${apex}`, '_blank', 'noopener');
    } else {
      // Dev fallback: route via tenant id (assumes user has tenant_members access).
      this.router.navigate(['/t', t.id, 'spaces']);
    }
  }

  private normalizeHash(value: string): string {
    const stripped = value.replace(/^#/, '').toLowerCase();
    return '#' + stripped;
  }
}
