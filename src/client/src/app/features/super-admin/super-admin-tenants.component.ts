import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { Select } from 'primeng/select';
import { MessageModule } from 'primeng/message';
import { MessageService } from 'primeng/api';

import {
  SuperAdminService,
  SuperAdminAgencySummary,
  SuperAdminTenantSummary,
} from '../../core/services/super-admin.service';
import { StatusTagComponent } from '../../shared/components/status-tag.component';

const HOSTNAME_REGEX = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

interface AgencyOption {
  label: string;
  value: string | null;
}

@Component({
  selector: 'app-super-admin-tenants',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    ButtonModule,
    Dialog,
    InputText,
    Select,
    MessageModule,
    StatusTagComponent,
  ],
  template: `
    <div class="p-6">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 class="text-base font-semibold text-slate-900">Tenants</h1>
          <p class="mt-1 text-xs text-slate-500">
            Every pharma client tenant across every agency. Click a row to register a custom domain.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <label
            for="agency-filter"
            class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Agency
          </label>
          <p-select
            id="agency-filter"
            [options]="agencyOptions()"
            [ngModel]="agencyFilter()"
            (ngModelChange)="agencyFilter.set($event)"
            placeholder="All agencies"
            [style]="{ width: '14rem' }"
            optionLabel="label"
            optionValue="value"
          />
        </div>
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

      <p-table
        styleClass="data-table"
        [value]="filtered()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '70rem' }"
        aria-label="All tenants"
      >
        <ng-template #header>
          <tr>
            <th>Name</th>
            <th>Agency</th>
            <th>Subdomain</th>
            <th>Custom domain</th>
            <th>Status</th>
            <th>Created</th>
          </tr>
        </ng-template>
        <ng-template #body let-tenant>
          <tr
            class="cursor-pointer hover:bg-slate-50"
            (click)="openTenant(tenant)"
            tabindex="0"
            (keydown.enter)="openTenant(tenant)"
          >
            <td class="font-medium text-slate-900">
              {{ tenant.name }}
              @if (tenant.app_display_name && tenant.app_display_name !== tenant.name) {
                <span class="ml-1 text-[11px] text-slate-400">
                  ({{ tenant.app_display_name }})
                </span>
              }
            </td>
            <td class="text-xs text-slate-700">
              {{ tenant.agency_name || '--' }}
              @if (tenant.agency_slug) {
                <span class="ml-1 text-[10px] text-slate-400 font-mono">{{
                  tenant.agency_slug
                }}</span>
              }
            </td>
            <td class="col-identifier text-xs">
              @if (tenant.subdomain) {
                {{ tenant.subdomain }}
              } @else {
                <span class="text-slate-400">--</span>
              }
            </td>
            <td class="col-identifier text-xs">
              @if (tenant.custom_domain) {
                {{ tenant.custom_domain }}
              } @else {
                <span class="text-slate-400">--</span>
              }
            </td>
            <td>
              @if (tenant.suspended_at) {
                <app-status-tag label="suspended" tone="amber" />
              } @else {
                <app-status-tag label="active" tone="teal" />
              }
            </td>
            <td class="col-identifier text-xs">{{ tenant.created_at | date: 'MMM d, y' }}</td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="6" class="text-center py-8 text-sm text-slate-500">
              No tenants match the current filter.
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>

    <!-- Tenant detail / register-domain dialog -->
    <p-dialog
      [(visible)]="dialogOpen"
      [modal]="true"
      [closable]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: '32rem' }"
      [header]="selected()?.name || 'Tenant'"
      (onHide)="resetDialog()"
    >
      @if (selected(); as t) {
        <div class="space-y-4">
          <dl class="grid grid-cols-3 gap-y-2 text-xs">
            <dt class="col-span-1 text-slate-500">Agency</dt>
            <dd class="col-span-2 text-slate-900">{{ t.agency_name || '--' }}</dd>
            <dt class="col-span-1 text-slate-500">Subdomain</dt>
            <dd class="col-span-2 font-mono text-slate-900">{{ t.subdomain || '--' }}</dd>
            <dt class="col-span-1 text-slate-500">Custom domain</dt>
            <dd class="col-span-2 font-mono text-slate-900">
              {{ t.custom_domain || '(none)' }}
            </dd>
            <dt class="col-span-1 text-slate-500">Created</dt>
            <dd class="col-span-2 text-slate-900">{{ t.created_at | date: 'MMM d, y' }}</dd>
          </dl>

          <hr class="border-slate-200" />

          <form (ngSubmit)="onRegisterDomain()" class="space-y-3">
            <div>
              <label
                for="custom-domain"
                class="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
              >
                Register custom domain
              </label>
              <input
                pInputText
                id="custom-domain"
                class="w-full font-mono text-xs"
                [ngModel]="customDomain()"
                (ngModelChange)="onDomainChange($event)"
                name="customDomain"
                placeholder="trials.client.com"
                spellcheck="false"
                autocomplete="off"
                [attr.aria-invalid]="domainInvalid() ? 'true' : 'false'"
              />
              <p class="mt-1 text-[11px] text-slate-400">
                Lowercase fully qualified domain. The customer must have a CNAME pointed at the
                platform before this resolves.
              </p>
              @if (domainInvalid()) {
                <p class="mt-1 text-[11px] text-red-600">Not a valid hostname.</p>
              }
            </div>

            @if (submitError()) {
              <p-message severity="error" [closable]="false">{{ submitError() }}</p-message>
            }

            <div class="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
              <p-button
                label="Close"
                severity="secondary"
                [outlined]="true"
                type="button"
                (onClick)="dialogOpen = false"
              />
              <p-button
                label="Register domain"
                type="submit"
                [loading]="submitting()"
                [disabled]="!canSubmit()"
              />
            </div>
          </form>
        </div>
      }
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuperAdminTenantsComponent implements OnInit {
  private readonly service = inject(SuperAdminService);
  private readonly messageService = inject(MessageService);

  readonly tenants = signal<SuperAdminTenantSummary[]>([]);
  readonly agencies = signal<SuperAdminAgencySummary[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly agencyFilter = signal<string | null>(null);

  readonly agencyOptions = computed<AgencyOption[]>(() => [
    { label: 'All agencies', value: null },
    ...this.agencies().map((a) => ({ label: a.name, value: a.id })),
  ]);

  readonly filtered = computed<SuperAdminTenantSummary[]>(() => {
    const f = this.agencyFilter();
    const list = this.tenants();
    if (!f) return list;
    return list.filter((t) => t.agency_id === f);
  });

  // Dialog state
  dialogOpen = false;
  readonly selected = signal<SuperAdminTenantSummary | null>(null);
  readonly customDomain = signal('');
  readonly submitting = signal(false);
  readonly submitError = signal<string | null>(null);

  readonly domainInvalid = computed(() => {
    const v = this.customDomain().trim().toLowerCase();
    if (v.length === 0) return false;
    return !HOSTNAME_REGEX.test(v);
  });

  readonly canSubmit = computed(() => {
    return (
      !this.submitting() &&
      !!this.selected() &&
      HOSTNAME_REGEX.test(this.customDomain().trim().toLowerCase())
    );
  });

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [tenants, agencies] = await Promise.all([
        this.service.listAllTenants(),
        this.service.listAllAgencies(),
      ]);
      this.tenants.set(tenants);
      this.agencies.set(agencies);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Failed to load tenants.');
    } finally {
      this.loading.set(false);
    }
  }

  openTenant(tenant: SuperAdminTenantSummary): void {
    this.selected.set(tenant);
    this.customDomain.set(tenant.custom_domain ?? '');
    this.submitError.set(null);
    this.dialogOpen = true;
  }

  resetDialog(): void {
    this.selected.set(null);
    this.customDomain.set('');
    this.submitError.set(null);
  }

  onDomainChange(value: string): void {
    this.customDomain.set((value || '').toLowerCase().trim());
  }

  async onRegisterDomain(): Promise<void> {
    const t = this.selected();
    if (!t || !this.canSubmit()) return;
    this.submitting.set(true);
    this.submitError.set(null);
    try {
      await this.service.registerCustomDomain(t.id, this.customDomain().trim().toLowerCase());
      this.messageService.add({
        severity: 'success',
        summary: `Custom domain registered for ${t.name}.`,
        life: 3000,
      });
      this.dialogOpen = false;
      this.resetDialog();
      await this.load();
    } catch (e) {
      this.submitError.set(e instanceof Error ? e.message : 'Failed to register domain.');
    } finally {
      this.submitting.set(false);
    }
  }
}
