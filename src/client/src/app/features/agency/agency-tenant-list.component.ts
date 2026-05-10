import { DatePipe, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { MessageService } from 'primeng/api';
import { MessageModule } from 'primeng/message';

import { AgencyService } from '../../core/services/agency.service';
import { Agency, AgencyTenantSummary } from '../../core/models/agency.model';
import { BrandContextService } from '../../core/services/brand-context.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { StatusTagComponent } from '../../shared/components/status-tag.component';

@Component({
  selector: 'app-agency-tenant-list',
  standalone: true,
  imports: [
    DatePipe,
    NgOptimizedImage,
    TableModule,
    ButtonModule,
    MessageModule,
    ManagePageShellComponent,
    StatusTagComponent,
  ],
  template: `
    <app-manage-page-shell>
      <div class="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-base font-semibold text-slate-900">Tenants</h1>
          <p class="mt-1 text-xs text-slate-500">
            Pharma client tenants provisioned by this agency.
          </p>
        </div>
        <p-button
          label="Provision tenant"
          icon="fa-solid fa-plus"
          size="small"
          (onClick)="onProvision()"
          [disabled]="!agencyId()"
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

      <p-table
        styleClass="data-table"
        [value]="tenants()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '60rem' }"
        aria-label="Agency tenants"
      >
        <ng-template #header>
          <tr>
            <th style="width: 60px"></th>
            <th>Name</th>
            <th>Subdomain</th>
            <th class="text-right">Members</th>
            <th>Created</th>
            <th>Status</th>
          </tr>
        </ng-template>
        <ng-template #body let-tenant>
          <tr
            class="cursor-pointer hover:bg-slate-50"
            (click)="openTenant(tenant)"
            tabindex="0"
            (keydown.enter)="openTenant(tenant)"
          >
            <td>
              @if (tenant.logo_url) {
                <img
                  [ngSrc]="tenant.logo_url"
                  [alt]="tenant.name + ' logo'"
                  width="28"
                  height="28"
                  class="h-7 w-7 rounded object-contain border border-slate-200"
                />
              } @else {
                <div
                  class="h-7 w-7 rounded border border-slate-200 bg-slate-50 flex items-center justify-center text-[10px] text-slate-400 font-mono uppercase"
                >
                  {{ tenant.name.slice(0, 2) }}
                </div>
              }
            </td>
            <td class="font-medium text-slate-900">
              {{ tenant.name }}
              @if (tenant.app_display_name && tenant.app_display_name !== tenant.name) {
                <span class="ml-1 text-[11px] text-slate-400">({{ tenant.app_display_name }})</span>
              }
            </td>
            <td class="col-identifier text-xs">
              @if (tenant.subdomain) {
                {{ tenant.subdomain }}
              } @else {
                <span class="text-slate-400">--</span>
              }
            </td>
            <td class="text-right tabular-nums">{{ tenant.member_count }}</td>
            <td class="col-identifier text-xs">{{ tenant.created_at | date: 'MMM d, y' }}</td>
            <td>
              @if (tenant.suspended_at) {
                <app-status-tag label="suspended" tone="amber" />
              } @else {
                <app-status-tag label="active" tone="teal" />
              }
            </td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="6" class="text-center py-8 text-sm text-slate-500">
              No tenants yet. Provision your first one to get started.
            </td>
          </tr>
        </ng-template>
      </p-table>
    </app-manage-page-shell>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgencyTenantListComponent implements OnInit {
  private readonly agencyService = inject(AgencyService);
  private readonly router = inject(Router);
  private readonly messageService = inject(MessageService);
  private readonly brand = inject(BrandContextService);

  readonly tenants = signal<AgencyTenantSummary[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly agency = signal<Agency | null>(null);

  readonly agencyId = computed(() => this.agency()?.id ?? null);

  async ngOnInit(): Promise<void> {
    this.loading.set(true);
    try {
      const agencies = await this.agencyService.listMyAgencies();
      const brandId = this.brand.brand().id;
      const match = brandId ? agencies.find((a) => a.id === brandId) : null;
      const current = match ?? agencies[0] ?? null;
      this.agency.set(current);
      if (!current) {
        this.loadError.set('No agency available for this account.');
        this.tenants.set([]);
        return;
      }
      const tenants = await this.agencyService.listAgencyTenants(current.id);
      this.tenants.set(tenants);
    } catch (e) {
      this.loadError.set(e instanceof Error ? e.message : 'Failed to load tenants.');
      this.messageService.add({
        severity: 'error',
        summary: 'Failed to load tenants',
        life: 4000,
      });
    } finally {
      this.loading.set(false);
    }
  }

  openTenant(tenant: AgencyTenantSummary): void {
    this.router.navigate(['/admin/tenants', tenant.id]);
  }

  onProvision(): void {
    this.router.navigate(['/admin/tenants/new']);
  }
}
