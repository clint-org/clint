import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AuditLogTableComponent } from '../../shared/components/audit-log-table/audit-log-table.component';
import { BrandContextService } from '../../core/services/brand-context.service';

@Component({
  selector: 'app-agency-audit-log',
  imports: [AuditLogTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6">
      <header class="mb-4">
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Audit log</h1>
        <p class="mt-1 text-sm text-slate-600">
          Agency-level admin and security events. Only agency owners can view this log.
        </p>
      </header>
      <app-audit-log-table
        scopeKind="agency"
        [scopeId]="agencyId()"
        exportFilename="agency-audit-log.csv"
      />
    </section>
  `,
})
export class AgencyAuditLogComponent {
  private readonly brand = inject(BrandContextService);
  protected readonly agencyId = computed(() => this.brand.brand().id);
}
