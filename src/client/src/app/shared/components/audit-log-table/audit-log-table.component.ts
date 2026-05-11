import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';

import { AuditEventService } from '../../../core/services/audit-event.service';
import { AuditEvent, AuditEventFilter, AuditScopeKind } from '../../../core/models/audit-event.model';

@Component({
  selector: 'app-audit-log-table',
  standalone: true,
  imports: [DatePipe, FormsModule, JsonPipe, ButtonModule, InputTextModule, TableModule, TooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './audit-log-table.component.html',
})
export class AuditLogTableComponent {
  private readonly service = inject(AuditEventService);

  readonly scopeKind = input.required<AuditScopeKind>();
  readonly scopeId = input.required<string | null>();
  readonly exportFilename = input<string>('audit-log.csv');

  protected readonly filter = signal<AuditEventFilter>({});
  protected readonly page = signal<{ limit: number; offset: number }>({ limit: 50, offset: 0 });
  protected readonly rows = signal<AuditEvent[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);

  // Separate signal per filter field so the template can bind [ngModel] / (ngModelChange) cleanly.
  protected readonly filterActor = signal<string>('');
  protected readonly filterAction = signal<string>('');

  constructor() {
    effect(() => {
      const kind = this.scopeKind();
      const id = this.scopeId();
      const f = this.filter();
      const p = this.page();
      void this.loadRows(kind, id, f, p);
    });
  }

  private async loadRows(
    kind: AuditScopeKind,
    id: string | null,
    f: AuditEventFilter,
    p: { limit: number; offset: number },
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.service.list(kind, id, f, p);
      this.rows.set(data);
    } catch (e) {
      this.error.set((e as Error).message);
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }

  protected applyFilters(): void {
    this.filter.set({
      actor_user_id: this.filterActor() || undefined,
      action: this.filterAction() || undefined,
    });
    this.page.set({ limit: 50, offset: 0 });
  }

  protected clearFilters(): void {
    this.filterActor.set('');
    this.filterAction.set('');
    this.filter.set({});
    this.page.set({ limit: 50, offset: 0 });
  }

  protected async onExport(): Promise<void> {
    try {
      const csv = await this.service.exportCsv(this.scopeKind(), this.scopeId(), this.filter());
      this.service.downloadCsv(csv, this.exportFilename());
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }
}
