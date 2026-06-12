import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { AuditLogTableComponent } from '../../shared/components/audit-log-table/audit-log-table.component';

@Component({
  selector: 'app-space-audit-log',
  imports: [AuditLogTableComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="p-6">
      <!-- Page title renders in the topbar (app-shell titleMap), matching
           the other settings pages; only the description lives here. -->
      <header class="mb-4">
        <p class="text-sm text-slate-600">
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
