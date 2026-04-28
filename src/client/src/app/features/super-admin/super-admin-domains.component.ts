import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { MessageModule } from 'primeng/message';

import {
  SuperAdminService,
  RetiredHostname,
} from '../../core/services/super-admin.service';
import { StatusTagComponent } from '../../shared/components/status-tag.component';

@Component({
  selector: 'app-super-admin-domains',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    TableModule,
    ButtonModule,
    CheckboxModule,
    MessageModule,
    StatusTagComponent,
  ],
  template: `
    <div class="p-6">
      <div class="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 class="text-base font-semibold text-slate-900">Retired hostnames</h1>
          <p class="mt-1 text-xs text-slate-500">
            Hostnames in the holdback window. They cannot be re-claimed until they are released.
          </p>
        </div>
        <div class="flex items-center gap-2 text-xs text-slate-700">
          <p-checkbox
            inputId="include-expired"
            [(ngModel)]="includeExpired"
            (onChange)="load()"
            [binary]="true"
          />
          <label for="include-expired" class="cursor-pointer">
            Include expired (released)
          </label>
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
        [value]="rows()"
        [loading]="loading()"
        [tableStyle]="{ 'min-width': '60rem' }"
        aria-label="Retired hostnames"
      >
        <ng-template #header>
          <tr>
            <th>Hostname</th>
            <th>Previous kind</th>
            <th>Retired</th>
            <th>Released</th>
            <th>Status</th>
            <th>Previous id</th>
          </tr>
        </ng-template>
        <ng-template #body let-row>
          <tr>
            <td class="col-identifier text-xs font-medium text-slate-900">{{ row.hostname }}</td>
            <td>
              <app-status-tag
                [label]="row.previous_kind"
                [tone]="row.previous_kind === 'tenant' ? 'teal' : 'slate'"
              />
            </td>
            <td class="col-identifier text-xs">{{ row.retired_at | date: 'MMM d, y, HH:mm' }}</td>
            <td class="col-identifier text-xs">{{ row.released_at | date: 'MMM d, y, HH:mm' }}</td>
            <td>
              @if (isReleased(row)) {
                <app-status-tag label="released" tone="slate" />
              } @else {
                <app-status-tag label="held" tone="amber" />
              }
            </td>
            <td class="col-identifier text-[10px] text-slate-500">{{ row.previous_id || '--' }}</td>
          </tr>
        </ng-template>
        <ng-template #emptymessage>
          <tr>
            <td colspan="6" class="text-center py-8 text-sm text-slate-500">
              No hostnames are currently in the holdback window.
            </td>
          </tr>
        </ng-template>
      </p-table>
    </div>
  `,
})
export class SuperAdminDomainsComponent implements OnInit {
  private readonly service = inject(SuperAdminService);

  readonly rows = signal<RetiredHostname[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  includeExpired = false;

  readonly nowIso = computed(() => new Date().toISOString());

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const data = await this.service.listRetiredHostnames(this.includeExpired);
      this.rows.set(data);
    } catch (e) {
      this.loadError.set(
        e instanceof Error ? e.message : 'Failed to load retired hostnames.'
      );
    } finally {
      this.loading.set(false);
    }
  }

  isReleased(row: RetiredHostname): boolean {
    return new Date(row.released_at).getTime() <= Date.now();
  }
}
