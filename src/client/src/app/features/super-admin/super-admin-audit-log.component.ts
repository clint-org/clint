import { ChangeDetectionStrategy, Component } from '@angular/core';
import { AuditLogTableComponent } from '../../shared/components/audit-log-table/audit-log-table.component';

@Component({
  selector: 'app-super-admin-audit-log',
  imports: [AuditLogTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6">
      <header class="mb-4">
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Platform audit log</h1>
        <p class="mt-1 text-sm text-slate-600">
          All admin and security events across the platform.
        </p>
      </header>
      <app-audit-log-table
        scopeKind="platform"
        [scopeId]="null"
        exportFilename="platform-audit-log.csv"
      />
    </section>
  `,
})
export class SuperAdminAuditLogComponent {}
