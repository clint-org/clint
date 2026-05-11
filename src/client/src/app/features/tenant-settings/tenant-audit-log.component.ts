import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuditLogTableComponent } from '../../shared/components/audit-log-table/audit-log-table.component';

@Component({
  selector: 'app-tenant-audit-log',
  imports: [AuditLogTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6">
      <header class="mb-4">
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Audit log</h1>
        <p class="mt-1 text-sm text-slate-600">
          Admin and security events for this workspace. Only tenant owners can view this log.
        </p>
      </header>
      <app-audit-log-table
        scopeKind="tenant"
        [scopeId]="tenantId()"
        exportFilename="tenant-audit-log.csv"
      />
    </section>
  `,
})
export class TenantAuditLogComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly tenantId = computed(
    () => this.route.snapshot.paramMap.get('tenantId') ?? null
  );
}
