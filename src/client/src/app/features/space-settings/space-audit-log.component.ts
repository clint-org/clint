import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuditLogTableComponent } from '../../shared/components/audit-log-table/audit-log-table.component';

@Component({
  selector: 'app-space-audit-log',
  imports: [AuditLogTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6">
      <header class="mb-4">
        <h1 class="text-2xl font-semibold tracking-tight text-slate-900">Audit log</h1>
        <p class="mt-1 text-sm text-slate-600">
          Security and membership events for this space. Only space owners can view this log.
        </p>
      </header>
      <app-audit-log-table
        scopeKind="space"
        [scopeId]="spaceId()"
        exportFilename="space-audit-log.csv"
      />
    </section>
  `,
})
export class SpaceAuditLogComponent {
  private readonly route = inject(ActivatedRoute);
  protected readonly spaceId = computed(
    () => this.route.snapshot.paramMap.get('spaceId') ?? null
  );
}
