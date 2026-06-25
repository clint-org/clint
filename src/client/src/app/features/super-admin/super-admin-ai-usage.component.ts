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
import { InputNumberModule } from 'primeng/inputnumber';
import { Select } from 'primeng/select';
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

interface EntityCounts {
  companies: number;
  assets: number;
  trials: number;
  markers: number;
  events: number;
}

interface ImportRow {
  ai_call_id: string;
  source_title: string;
  source_kind?: string | null;
  import_kind?: string | null;
  user_email: string;
  outcome: string;
  cost_usd: number;
  duration_ms: number;
  created_at: string;
  closed_at?: string | null;
  model?: string;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  error_code?: string | null;
  error_message?: string | null;
  warnings?: string[] | null;
  entity_counts?: EntityCounts | null;
}

// Full request/response for one call, fetched on expand via get_ai_call_detail.
interface AiCallDetail {
  request?: { kind?: string; input?: unknown } | null;
  output?: { prompt?: string; params?: unknown; raw?: string } | null;
}

interface ModelRow {
  model_id: string;
  display_name: string;
  family: string;
  released_on: string | null;
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
    InputNumberModule,
    Select,
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
                icon="fa-solid fa-arrow-left"
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
              <th>Limits</th>
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
              <td>
                <button
                  pButton
                  type="button"
                  [text]="true"
                  size="small"
                  icon="fa-solid fa-sliders"
                  label="Edit limits"
                  aria-label="Edit AI limits"
                  (click)="openEditLimits(row, $event)"
                  pTooltip="Set cost caps and rate limits"
                  tooltipPosition="top"
                ></button>
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
              <td colspan="8" class="py-8 text-center text-sm text-slate-500">
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
              <th pSortableColumn="entity_count">Entities <p-sortIcon field="entity_count" /></th>
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
              <th pSortableColumn="duration_ms">Duration <p-sortIcon field="duration_ms" /></th>
              <th pSortableColumn="created_at">Date <p-sortIcon field="created_at" /></th>
            </tr>
          </ng-template>
          <ng-template #body let-row>
            <tr>
              <td class="max-w-[20rem] font-medium text-slate-900">
                <div class="flex items-start gap-1.5">
                  <button
                    type="button"
                    class="mt-0.5 shrink-0 text-slate-400 hover:text-slate-700"
                    [attr.aria-expanded]="expandedCallId() === row.ai_call_id"
                    [attr.aria-label]="
                      expandedCallId() === row.ai_call_id
                        ? 'Hide import details'
                        : 'Show import details'
                    "
                    pTooltip="Toggle details"
                    tooltipPosition="top"
                    (click)="toggleRow(row.ai_call_id)"
                  >
                    <i
                      [class]="
                        'fa-solid text-[11px] ' +
                        (expandedCallId() === row.ai_call_id
                          ? 'fa-chevron-down'
                          : 'fa-chevron-right')
                      "
                    ></i>
                  </button>
                  <div class="min-w-0">
                    <div class="truncate">{{ row.source_title }}</div>
                    @if (row.error_message) {
                      <div class="mt-0.5 text-[11px] font-normal text-red-700">
                        {{ row.error_message }}
                      </div>
                    }
                    @if (row.warnings?.length) {
                      <div class="mt-0.5 text-[11px] font-normal text-amber-700">
                        {{ row.warnings.join(', ') }}
                      </div>
                    }
                  </div>
                </div>
              </td>
              <td class="text-xs text-slate-600">{{ row.user_email }}</td>
              <td>
                <span
                  [class]="
                    'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ' +
                    outcomeClass(row.outcome)
                  "
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
            @if (expandedCallId() === row.ai_call_id) {
              <tr class="bg-slate-50/60">
                <td colspan="6" class="px-4 py-3">
                  <dl class="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5 text-xs">
                    <dt class="text-slate-500">Mode</dt>
                    <dd class="text-slate-800">{{ row.import_kind ?? 'n/a' }}</dd>

                    <dt class="text-slate-500">Model</dt>
                    <dd class="text-slate-800">{{ row.model ?? 'n/a' }}</dd>

                    <dt class="text-slate-500">Tokens</dt>
                    <dd class="tabular-nums text-slate-800">
                      {{ (row.prompt_tokens ?? 0) | number }} in /
                      {{ (row.completion_tokens ?? 0) | number }} out
                    </dd>

                    <dt class="text-slate-500">Source</dt>
                    <dd class="text-slate-800">
                      {{ row.source_title ?? 'n/a' }}
                      @if (row.source_kind) {
                        <span class="text-slate-400">({{ row.source_kind }})</span>
                      }
                    </dd>

                    <dt class="text-slate-500">Created entities</dt>
                    <dd class="text-slate-800">{{ entitySummary(row.entity_counts) }}</dd>

                    @if (row.error_code) {
                      <dt class="text-slate-500">Error</dt>
                      <dd class="text-red-700">
                        {{ row.error_code }}@if (row.error_message) {
                          : {{ row.error_message }}
                        }
                      </dd>
                    }

                    @if (row.warnings?.length) {
                      <dt class="text-slate-500">Warnings</dt>
                      <dd class="text-amber-700">{{ row.warnings.join(', ') }}</dd>
                    }

                    @if (row.closed_at) {
                      <dt class="text-slate-500">Completed</dt>
                      <dd class="tabular-nums text-slate-800">
                        {{ row.closed_at | date: 'MMM d, y HH:mm:ss' }}
                      </dd>
                    }
                  </dl>

                  @if (detailLoading(row.ai_call_id)) {
                    <p class="mt-3 text-xs text-slate-400">
                      Loading request and response&hellip;
                    </p>
                  } @else if (detailError(row.ai_call_id)) {
                    <p class="mt-3 text-xs text-red-600">Could not load request/response.</p>
                  } @else if (loadedDetail(row.ai_call_id); as detail) {
                    <div class="mt-3 space-y-3">
                      @if (detail.request?.input; as input) {
                        <div>
                          <div class="mb-1 flex items-center justify-between">
                            <span
                              class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                            >
                              Input
                            </span>
                            <button
                              type="button"
                              class="text-[11px] font-medium text-brand-600 hover:text-brand-700"
                              (click)="copy(pretty(input))"
                            >
                              Copy
                            </button>
                          </div>
                          <pre
                            class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-[11px] text-slate-700 ring-1 ring-slate-200"
                            >{{ pretty(input) }}</pre
                          >
                        </div>
                      }
                      @if (detail.output?.prompt; as prompt) {
                        <div>
                          <div class="mb-1 flex items-center justify-between">
                            <span
                              class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                            >
                              Prompt
                            </span>
                            <button
                              type="button"
                              class="text-[11px] font-medium text-brand-600 hover:text-brand-700"
                              (click)="copy(prompt)"
                            >
                              Copy
                            </button>
                          </div>
                          <pre
                            class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-[11px] text-slate-700 ring-1 ring-slate-200"
                            >{{ prompt }}</pre
                          >
                        </div>
                      }
                      @if (detail.output?.raw; as raw) {
                        <div>
                          <div class="mb-1 flex items-center justify-between">
                            <span
                              class="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
                            >
                              Model output
                            </span>
                            <button
                              type="button"
                              class="text-[11px] font-medium text-brand-600 hover:text-brand-700"
                              (click)="copy(raw)"
                            >
                              Copy
                            </button>
                          </div>
                          <pre
                            class="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-white p-2 text-[11px] text-slate-700 ring-1 ring-slate-200"
                            >{{ raw }}</pre
                          >
                        </div>
                      }
                    </div>
                  }
                </td>
              </tr>
            }
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
          ></button>
          <button
            pButton
            [label]="confirmAction() === 'enable' ? 'Enable' : 'Disable'"
            [disabled]="!confirmReason().trim()"
            [attr.aria-label]="confirmAction() === 'enable' ? 'Enable' : 'Disable'"
            (click)="executeToggle()"
          ></button>
        </ng-template>
      </p-dialog>

      <!-- Edit cost caps + rate limits (platform-admin-only spend controls) -->
      <p-dialog
        header="AI spend limits"
        [visible]="editVisible()"
        (visibleChange)="editVisible.set($event)"
        [modal]="true"
        [closable]="true"
        styleClass="w-[30rem]"
      >
        <div class="flex flex-col gap-4">
          <p class="text-sm text-slate-700">
            Limits and model for <strong>{{ editTenantName() }}</strong
            >. The daily token cap is a deterministic ceiling on usage; cost shown elsewhere is an
            estimate from current model prices.
          </p>

          @if (editError()) {
            <p-message severity="error" [closable]="false">{{ editError() }}</p-message>
          }

          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2 flex flex-col gap-1">
              <label class="text-xs font-semibold text-slate-600" for="edit-model">Model</label>
              <p-select
                inputId="edit-model"
                [options]="modelOptions()"
                [ngModel]="editModel()"
                (ngModelChange)="editModel.set($event)"
                optionLabel="label"
                optionValue="value"
                styleClass="w-full"
              />
              @if (newerModelHint(); as hint) {
                <span class="text-[11px] text-amber-700">{{ hint }}</span>
              }
            </div>
            <div class="col-span-2 flex flex-col gap-1">
              <label class="text-xs font-semibold text-slate-600" for="edit-token-cap">
                Daily token cap (input + output, rolling 24h)
              </label>
              <p-inputnumber
                inputId="edit-token-cap"
                [ngModel]="editTokenCap()"
                (ngModelChange)="editTokenCap.set($event)"
                [min]="0"
                [max]="1000000000"
                inputStyleClass="w-full text-right"
                styleClass="w-full"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs font-semibold text-slate-600" for="edit-rate-min">
                Per-user rate (per minute)
              </label>
              <p-inputnumber
                inputId="edit-rate-min"
                [ngModel]="editRatePerMin()"
                (ngModelChange)="editRatePerMin.set($event)"
                [min]="1"
                [max]="120"
                inputStyleClass="w-full text-right"
                styleClass="w-full"
              />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs font-semibold text-slate-600" for="edit-rate-hour">
                Per-user rate (per hour)
              </label>
              <p-inputnumber
                inputId="edit-rate-hour"
                [ngModel]="editRatePerHour()"
                (ngModelChange)="editRatePerHour.set($event)"
                [min]="1"
                [max]="2000"
                inputStyleClass="w-full text-right"
                styleClass="w-full"
              />
            </div>
          </div>

          <div class="flex flex-col gap-1">
            <label class="text-xs font-semibold text-slate-600" for="edit-reason">
              Reason (required)
            </label>
            <input
              pInputText
              id="edit-reason"
              [ngModel]="editReason()"
              (ngModelChange)="editReason.set($event)"
              placeholder="Reason for change"
            />
          </div>
        </div>
        <ng-template #footer>
          <button
            pButton
            label="Cancel"
            [text]="true"
            aria-label="Cancel"
            (click)="editVisible.set(false)"
          ></button>
          <button
            pButton
            label="Save limits"
            aria-label="Save limits"
            [loading]="savingLimits()"
            [disabled]="!editReason().trim() || savingLimits()"
            (click)="saveLimits()"
          ></button>
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
  // Which import row's detail panel is expanded (one at a time).
  readonly expandedCallId = signal<string | null>(null);
  // Lazy-loaded full request/response per ai_call (fetched on first expand).
  readonly callDetails = signal<Record<string, AiCallDetail | 'loading' | 'error'>>({});

  readonly confirmVisible = signal(false);
  readonly confirmReason = signal('');
  readonly confirmAction = signal<'enable' | 'disable'>('disable');
  readonly confirmTenantName = signal('');
  private pendingToggleRow: TenantRow | null = null;

  // Edit model + token cap + rate limits (platform-admin-only controls).
  readonly editVisible = signal(false);
  readonly editTenantName = signal('');
  readonly editModel = signal<string>('claude-sonnet-4-6');
  readonly editTokenCap = signal(1000000);
  readonly editRatePerMin = signal(6);
  readonly editRatePerHour = signal(60);
  readonly editReason = signal('');
  readonly savingLimits = signal(false);
  readonly editError = signal<string | null>(null);
  private editTenantId: string | null = null;

  // Active model catalog (drives the chooser + the "newer available" hint).
  readonly models = signal<ModelRow[]>([]);
  readonly modelOptions = computed(() =>
    this.models().map((m) => ({ label: `${m.display_name} (${m.model_id})`, value: m.model_id }))
  );
  readonly newerModelHint = computed<string | null>(() => {
    const selected = this.models().find((m) => m.model_id === this.editModel());
    if (!selected) return null;
    const newer = this.models()
      .filter(
        (m) => m.family === selected.family && (m.released_on ?? '') > (selected.released_on ?? '')
      )
      .sort((a, b) => (b.released_on ?? '').localeCompare(a.released_on ?? ''))[0];
    return newer ? `A newer ${selected.family} model is available: ${newer.display_name}.` : null;
  });

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

  async openEditLimits(row: TenantRow, event: Event): Promise<void> {
    event.stopPropagation();
    this.editTenantId = row.tenant_id;
    this.editTenantName.set(row.tenant_name);
    this.editReason.set('');
    this.editError.set(null);

    // Load the active model catalog for the chooser (any authenticated read).
    if (this.models().length === 0) {
      const { data: cat } = await this.supabase.client
        .from('ai_model_pricing')
        .select('model_id, display_name, family, released_on')
        .eq('status', 'active')
        .order('family', { ascending: true });
      this.models.set((cat as ModelRow[]) ?? []);
    }

    // Platform admins can read ai_config directly (RLS allows is_platform_admin).
    const { data } = await this.supabase.client
      .from('ai_config')
      .select('ai_model, daily_token_cap, per_user_rate_per_min, per_user_rate_per_hour')
      .eq('tenant_id', row.tenant_id)
      .maybeSingle();
    this.editModel.set((data?.['ai_model'] as string) ?? 'claude-sonnet-4-6');
    this.editTokenCap.set((data?.['daily_token_cap'] as number) ?? 1000000);
    this.editRatePerMin.set((data?.['per_user_rate_per_min'] as number) ?? 6);
    this.editRatePerHour.set((data?.['per_user_rate_per_hour'] as number) ?? 60);
    this.editVisible.set(true);
  }

  async saveLimits(): Promise<void> {
    if (!this.editTenantId) return;
    const reason = this.editReason().trim();
    if (!reason) return;
    this.savingLimits.set(true);
    this.editError.set(null);

    const { error } = await this.supabase.client.rpc('platform_admin_update_ai_config', {
      p_tenant_id: this.editTenantId,
      p_reason: reason,
      p_ai_model: this.editModel(),
      p_daily_token_cap: this.editTokenCap(),
      p_per_user_rate_per_min: this.editRatePerMin(),
      p_per_user_rate_per_hour: this.editRatePerHour(),
    });

    this.savingLimits.set(false);
    if (error) {
      this.editError.set(error.message);
      return;
    }
    this.editVisible.set(false);
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

  async toggleRow(callId: string): Promise<void> {
    const next = this.expandedCallId() === callId ? null : callId;
    this.expandedCallId.set(next);
    if (next && this.callDetails()[next] === undefined) {
      await this.loadCallDetail(next);
    }
  }

  private async loadCallDetail(callId: string): Promise<void> {
    this.callDetails.update((m) => ({ ...m, [callId]: 'loading' }));
    const { data, error } = await this.supabase.client.rpc('get_ai_call_detail', {
      p_ai_call_id: callId,
    });
    this.callDetails.update((m) => ({
      ...m,
      [callId]: error || !data ? 'error' : (data as AiCallDetail),
    }));
  }

  detailLoading(callId: string): boolean {
    return this.callDetails()[callId] === 'loading';
  }

  detailError(callId: string): boolean {
    return this.callDetails()[callId] === 'error';
  }

  loadedDetail(callId: string): AiCallDetail | null {
    const d = this.callDetails()[callId];
    return d && d !== 'loading' && d !== 'error' ? d : null;
  }

  async copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // clipboard may be unavailable (non-secure context); ignore
    }
  }

  pretty(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    return JSON.stringify(value, null, 2);
  }

  // "3 companies, 2 assets, 1 trial" -- omits zero counts; falls back when the
  // import produced nothing (or has no provenance link, e.g. a failed call).
  entitySummary(counts: EntityCounts | null | undefined): string {
    if (!counts) return 'No entities created';
    const parts: string[] = [];
    const add = (n: number, singular: string, plural: string) => {
      if (n > 0) parts.push(`${n} ${n === 1 ? singular : plural}`);
    };
    add(counts.companies, 'company', 'companies');
    add(counts.assets, 'asset', 'assets');
    add(counts.trials, 'trial', 'trials');
    add(counts.markers, 'marker', 'markers');
    add(counts.events, 'event', 'events');
    return parts.length ? parts.join(', ') : 'No entities created';
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);

    try {
      const s = this.scope();
      const { data, error } = await this.supabase.client.rpc('get_ai_usage_rollup', {
        p_scope: s === 'tenants' ? 'platform' : s === 'spaces' ? 'tenant' : 'space',
        p_id:
          s === 'tenants'
            ? null
            : s === 'spaces'
              ? this.selectedTenantId()
              : (this.selectedSpaceId() ?? null),
        p_window: `${this.windowDays()} days`,
      });

      if (error) {
        this.loadError.set(error.message);
        return;
      }

      const rows = (data as Record<string, unknown>)?.['data'] ?? [];
      if (s === 'tenants') {
        this.tenantRows.set(rows as TenantRow[]);
      } else if (s === 'spaces') {
        this.spaceRows.set(rows as SpaceRow[]);
      } else {
        this.importRows.set(rows as ImportRow[]);
      }
    } catch (err) {
      this.loadError.set(err instanceof Error ? err.message : 'Failed to load AI usage data.');
    } finally {
      this.loading.set(false);
    }
  }
}
