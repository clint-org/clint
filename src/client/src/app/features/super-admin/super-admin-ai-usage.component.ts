import { DatePipe, DecimalPipe, PercentPipe } from '@angular/common';
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
import { SelectButton } from 'primeng/selectbutton';
import { Dialog } from 'primeng/dialog';
import { InputText } from 'primeng/inputtext';
import { ToggleSwitch } from 'primeng/toggleswitch';
import { MessageModule } from 'primeng/message';
import { Tooltip } from 'primeng/tooltip';

import { SupabaseService } from '../../core/services/supabase.service';

type Scope = 'tenants' | 'spaces' | 'imports';

interface WindowOption {
  label: string;
  value: number;
}

interface TenantRow {
  tenant_id: string;
  tenant_name: string;
  ai_enabled: boolean;
  imports: number;
  cost_usd: number;
  success_rate: number;
  p50_latency_ms: number;
  fail_count: number;
}

interface SpaceRow {
  space_id: string;
  space_name: string;
  imports: number;
  cost_usd: number;
  success_rate: number;
  p50_latency_ms: number;
  fail_count: number;
  entity_count: number;
}

interface ImportRow {
  ai_call_id: string;
  source_title: string;
  user_email: string;
  outcome: string;
  cost_usd: number;
  duration_ms: number;
  created_at: string;
}

@Component({
  selector: 'app-super-admin-ai-usage',
  imports: [
    DatePipe,
    DecimalPipe,
    PercentPipe,
    FormsModule,
    TableModule,
    ButtonModule,
    SelectButton,
    Dialog,
    InputText,
    ToggleSwitch,
    MessageModule,
    Tooltip,
  ],
  template: `
    <div class="p-6">
      <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div class="flex items-center gap-2">
            @if (scope() !== 'tenants') {
              <button
                pButton
                [text]="true"
                icon="pi pi-arrow-left"
                (click)="navigateBack()"
                pTooltip="Back"
                tooltipPosition="right"
                aria-label="Back"
              ></button>
            }
            <h1 class="text-base font-semibold text-slate-900">{{ heading() }}</h1>
          </div>
          <p class="mt-1 text-xs text-slate-500">{{ subheading() }}</p>
        </div>
        <p-selectButton
          [options]="windowOptions"
          [ngModel]="windowDays()"
          (ngModelChange)="onWindowChange($event)"
          optionLabel="label"
          optionValue="value"
          styleClass="text-xs"
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

      <!-- Level 1: Tenants -->
      @if (scope() === 'tenants') {
        <p-table
          styleClass="data-table"
          [value]="tenantRows()"
          [loading]="loading()"
          [tableStyle]="{ 'min-width': '60rem' }"
          aria-label="AI usage by tenant"
        >
          <ng-template #header>
            <tr>
              <th>Tenant</th>
              <th>AI enabled</th>
              <th pSortableColumn="imports">Imports <p-sortIcon field="imports" /></th>
              <th pSortableColumn="cost_usd">Cost ($) <p-sortIcon field="cost_usd" /></th>
              <th pSortableColumn="success_rate">
                Success rate <p-sortIcon field="success_rate" />
              </th>
              <th pSortableColumn="p50_latency_ms">
                P50 latency <p-sortIcon field="p50_latency_ms" />
              </th>
              <th pSortableColumn="fail_count">Failures <p-sortIcon field="fail_count" /></th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr
              class="cursor-pointer hover:bg-slate-50"
              (click)="drillToSpaces(row)"
              tabindex="0"
              (keydown.enter)="drillToSpaces(row)"
            >
              <td class="font-medium text-slate-900">{{ row.tenant_name }}</td>
              <td>
                <p-toggleSwitch
                  [ngModel]="row.ai_enabled"
                  (ngModelChange)="onToggleAi(row, $event)"
                  (click)="$event.stopPropagation()"
                />
              </td>
              <td class="tabular-nums">{{ row.imports }}</td>
              <td class="tabular-nums">{{ row.cost_usd | number: '1.2-2' }}</td>
              <td class="tabular-nums">{{ row.success_rate | percent: '1.0-0' }}</td>
              <td class="tabular-nums">{{ row.p50_latency_ms | number: '1.0-0' }} ms</td>
              <td class="tabular-nums">{{ row.fail_count }}</td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="7" class="py-8 text-center text-sm text-slate-500">
                No AI usage data in this window.
              </td>
            </tr>
          </ng-template>
        </p-table>
      }

      <!-- Level 2: Spaces -->
      @if (scope() === 'spaces') {
        <p-table
          styleClass="data-table"
          [value]="spaceRows()"
          [loading]="loading()"
          [tableStyle]="{ 'min-width': '60rem' }"
          aria-label="AI usage by space"
        >
          <ng-template #header>
            <tr>
              <th>Space</th>
              <th pSortableColumn="imports">Imports <p-sortIcon field="imports" /></th>
              <th pSortableColumn="cost_usd">Cost ($) <p-sortIcon field="cost_usd" /></th>
              <th pSortableColumn="success_rate">
                Success rate <p-sortIcon field="success_rate" />
              </th>
              <th pSortableColumn="p50_latency_ms">
                P50 latency <p-sortIcon field="p50_latency_ms" />
              </th>
              <th pSortableColumn="fail_count">Failures <p-sortIcon field="fail_count" /></th>
              <th pSortableColumn="entity_count">
                Entities <p-sortIcon field="entity_count" />
              </th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr
              class="cursor-pointer hover:bg-slate-50"
              (click)="drillToImports(row)"
              tabindex="0"
              (keydown.enter)="drillToImports(row)"
            >
              <td class="font-medium text-slate-900">{{ row.space_name }}</td>
              <td class="tabular-nums">{{ row.imports }}</td>
              <td class="tabular-nums">{{ row.cost_usd | number: '1.2-2' }}</td>
              <td class="tabular-nums">{{ row.success_rate | percent: '1.0-0' }}</td>
              <td class="tabular-nums">{{ row.p50_latency_ms | number: '1.0-0' }} ms</td>
              <td class="tabular-nums">{{ row.fail_count }}</td>
              <td class="tabular-nums">{{ row.entity_count }}</td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="7" class="py-8 text-center text-sm text-slate-500">
                No imports found for this tenant.
              </td>
            </tr>
          </ng-template>
        </p-table>
      }

      <!-- Level 3: Imports -->
      @if (scope() === 'imports') {
        <p-table
          styleClass="data-table"
          [value]="importRows()"
          [loading]="loading()"
          [tableStyle]="{ 'min-width': '50rem' }"
          aria-label="Import details"
        >
          <ng-template #header>
            <tr>
              <th>Source</th>
              <th>User</th>
              <th>Outcome</th>
              <th pSortableColumn="cost_usd">Cost ($) <p-sortIcon field="cost_usd" /></th>
              <th pSortableColumn="duration_ms">
                Duration <p-sortIcon field="duration_ms" />
              </th>
              <th pSortableColumn="created_at">Date <p-sortIcon field="created_at" /></th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr>
              <td class="max-w-[20rem] truncate font-medium text-slate-900">
                {{ row.source_title }}
              </td>
              <td class="text-xs text-slate-600">{{ row.user_email }}</td>
              <td>
                <span
                  [class]="'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' + outcomeClass(row.outcome)"
                >
                  {{ row.outcome }}
                </span>
              </td>
              <td class="tabular-nums">{{ row.cost_usd | number: '1.4-4' }}</td>
              <td class="tabular-nums">{{ row.duration_ms | number: '1.0-0' }} ms</td>
              <td class="text-xs tabular-nums text-slate-600">
                {{ row.created_at | date: 'MMM d, y HH:mm' }}
              </td>
            </tr>
          </ng-template>
          <ng-template #emptymessage>
            <tr>
              <td colspan="6" class="py-8 text-center text-sm text-slate-500">
                No imports found for this space.
              </td>
            </tr>
          </ng-template>
        </p-table>
      }

      <!-- Confirm dialog for toggling ai_enabled -->
      <p-dialog
        header="Change AI access"
        [visible]="confirmVisible()"
        (visibleChange)="confirmVisible.set($event)"
        [modal]="true"
        [closable]="true"
        styleClass="w-[28rem]"
      >
        <div class="flex flex-col gap-3">
          <p class="text-sm text-slate-700">
            {{ confirmAction() === 'enable' ? 'Enable' : 'Disable' }} AI imports for
            <strong>{{ confirmTenantName() }}</strong
            >?
          </p>
          <label class="text-xs font-semibold text-slate-600" for="confirm-reason">
            Reason (required)
          </label>
          <input
            pInputText
            id="confirm-reason"
            [ngModel]="confirmReason()"
            (ngModelChange)="confirmReason.set($event)"
            placeholder="Reason for change"
          />
        </div>
        <ng-template #footer>
          <button
            pButton
            label="Cancel"
            [text]="true"
            aria-label="Cancel"
            (click)="confirmVisible.set(false)"
          >Cancel</button>
          <button
            pButton
            [label]="confirmAction() === 'enable' ? 'Enable' : 'Disable'"
            [disabled]="!confirmReason().trim()"
            [attr.aria-label]="confirmAction() === 'enable' ? 'Enable' : 'Disable'"
            (click)="executeToggle()"
          >{{ confirmAction() === 'enable' ? 'Enable' : 'Disable' }}</button>
        </ng-template>
      </p-dialog>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SuperAdminAiUsageComponent implements OnInit {
  private readonly supabase = inject(SupabaseService);

  readonly windowOptions: WindowOption[] = [
    { label: '7 days', value: 7 },
    { label: '30 days', value: 30 },
    { label: '90 days', value: 90 },
  ];

  readonly scope = signal<Scope>('tenants');
  readonly windowDays = signal(30);
  readonly loading = signal(false);
  readonly loadError = signal<string | null>(null);

  readonly selectedTenantId = signal<string | null>(null);
  readonly selectedTenantName = signal('');
  readonly selectedSpaceId = signal<string | null>(null);
  readonly selectedSpaceName = signal('');

  readonly tenantRows = signal<TenantRow[]>([]);
  readonly spaceRows = signal<SpaceRow[]>([]);
  readonly importRows = signal<ImportRow[]>([]);

  readonly confirmVisible = signal(false);
  readonly confirmReason = signal('');
  readonly confirmAction = signal<'enable' | 'disable'>('disable');
  readonly confirmTenantName = signal('');
  private pendingToggleRow: TenantRow | null = null;

  readonly heading = computed(() => {
    switch (this.scope()) {
      case 'tenants':
        return 'AI Usage';
      case 'spaces':
        return this.selectedTenantName();
      case 'imports':
        return this.selectedSpaceName();
    }
  });

  readonly subheading = computed(() => {
    switch (this.scope()) {
      case 'tenants':
        return 'Source import usage and cost across all tenants.';
      case 'spaces':
        return 'Spaces within the selected tenant.';
      case 'imports':
        return 'Individual import calls for the selected space.';
    }
  });

  ngOnInit(): void {
    void this.loadData();
  }

  onWindowChange(days: number): void {
    this.windowDays.set(days);
    void this.loadData();
  }

  drillToSpaces(row: TenantRow): void {
    this.selectedTenantId.set(row.tenant_id);
    this.selectedTenantName.set(row.tenant_name);
    this.scope.set('spaces');
    void this.loadData();
  }

  drillToImports(row: SpaceRow): void {
    this.selectedSpaceId.set(row.space_id);
    this.selectedSpaceName.set(row.space_name);
    this.scope.set('imports');
    void this.loadData();
  }

  navigateBack(): void {
    if (this.scope() === 'imports') {
      this.scope.set('spaces');
      this.selectedSpaceId.set(null);
      this.selectedSpaceName.set('');
    } else if (this.scope() === 'spaces') {
      this.scope.set('tenants');
      this.selectedTenantId.set(null);
      this.selectedTenantName.set('');
    }
    void this.loadData();
  }

  onToggleAi(row: TenantRow, newValue: boolean): void {
    this.pendingToggleRow = row;
    this.confirmAction.set(newValue ? 'enable' : 'disable');
    this.confirmTenantName.set(row.tenant_name);
    this.confirmReason.set('');
    this.confirmVisible.set(true);
  }

  async executeToggle(): Promise<void> {
    const row = this.pendingToggleRow;
    if (!row) return;
    const enabled = this.confirmAction() === 'enable';
    const reason = this.confirmReason().trim();

    const { error } = await this.supabase.client.rpc('platform_admin_set_ai_enabled', {
      p_tenant_id: row.tenant_id,
      p_enabled: enabled,
      p_reason: reason,
    });

    this.confirmVisible.set(false);
    if (error) {
      this.loadError.set(error.message);
      return;
    }
    row.ai_enabled = enabled;
    this.tenantRows.update((rows) => [...rows]);
  }

  outcomeClass(outcome: string): string {
    switch (outcome) {
      case 'committed':
        return 'bg-green-50 text-green-800';
      case 'failed':
        return 'bg-red-50 text-red-800';
      case 'pending_review':
        return 'bg-amber-50 text-amber-800';
      default:
        return 'bg-slate-50 text-slate-700';
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      const s = this.scope();
      const { data, error } = await this.supabase.client.rpc('get_ai_usage_rollup', {
        p_scope: s === 'tenants' ? 'platform' : s === 'spaces' ? 'tenant' : 'space',
        p_id: s === 'tenants' ? null : s === 'spaces' ? this.selectedTenantId() : this.selectedSpaceId() ?? null,
        p_window: `${this.windowDays()} days`,
      });

      if (error) {
        this.loadError.set(error.message);
        return;
      }

      if (s === 'tenants') {
        this.tenantRows.set((data ?? []) as TenantRow[]);
      } else if (s === 'spaces') {
        this.spaceRows.set((data ?? []) as SpaceRow[]);
      } else {
        this.importRows.set((data ?? []) as ImportRow[]);
      }
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load AI usage data.');
    } finally {
      this.loading.set(false);
    }
  }
}
