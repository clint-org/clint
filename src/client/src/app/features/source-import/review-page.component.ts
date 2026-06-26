import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MessageService, TreeNode } from 'primeng/api';
import { TreeTableModule } from 'primeng/treetable';
import { Checkbox } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';

import { ChangeEventService } from '../../core/services/change-event.service';
import { RpcCache } from '../../core/services/rpc-cache.service';
import { SupabaseService } from '../../core/services/supabase.service';
import {
  type CtgovCandidate,
  type FuzzyAlternate,
  SourceImportService,
} from './source-import.service';
import {
  entityState,
  deriveTrialFlags,
  deriveAssetFlags,
  duplicateTrialIndexes,
  deriveCtgovFlag,
  deriveFuzzyFlag,
  readableSummary,
  blockingReason,
  trialMissingAsset as trialMissingAssetLogic,
  resolveTrialAssetIndexes,
  resolveTrialPrimaryAssetIndex,
  orphanTrialIndexes,
  countFilterMatches,
  markerLeafDisplay,
  eventLeafDisplay,
  type ReviewFlag,
} from './review-grid.logic';
import { HasUnsavedImport } from '../../core/guards/source-import-deactivate.guard';
import { ReviewEditDialogComponent } from './review-edit-dialog.component';

type EditableEntityType = 'companies' | 'assets' | 'trials';

type EntityType = 'companies' | 'assets' | 'trials' | 'markers' | 'events';

const ENTITY_ORDER: EntityType[] = ['companies', 'assets', 'trials', 'markers', 'events'];

interface CompanyNode {
  companyIdx: number;
  assets: AssetNode[];
  events: number[];
}

interface AssetNode {
  assetIdx: number;
  trials: TrialNode[];
  markers: number[];
  events: number[];
}

interface TrialNode {
  trialIdx: number;
  markers: number[];
  events: number[];
}

interface HierarchicalTree {
  companies: CompanyNode[];
  orphanTrials: number[];
  orphanMarkers: number[];
  orphanEvents: number[];
}

interface GridRow {
  key: string;
  type: EntityType;
  idx: number;
  kind: 'company' | 'asset' | 'trial' | 'marker' | 'event';
  name: string;
  state: 'new' | 'existing';
  phase: string | null;
  status: string | null;
  moaRoa: string;
  indication: string | null;
  flags: ReviewFlag[];
  // For a trial that tests more than one asset, marks whether this particular
  // nesting is under its primary (headline) asset or a secondary one. Undefined
  // for single-asset trials and for non-trial rows.
  multiAssetRole?: 'primary' | 'secondary';
  // Marker/event leaf rows carry their identity in the entity cell instead of
  // the trial-shaped columns: a category chip (marker_type / event category)
  // and a date. Undefined for company/asset/trial rows.
  category?: string | null;
  date?: string | null;
}

// Row kinds that are leaf attributes of an entity (markers, events) rather than
// structural records. They render in the entity cell, leave the trial columns
// blank, and are not editable through the dialog.
const LEAF_KINDS = new Set<GridRow['kind']>(['marker', 'event']);

@Component({
  selector: 'app-review-page',
  imports: [
    FormsModule,
    NgTemplateOutlet,
    Checkbox,
    ButtonModule,
    Tooltip,
    MessageModule,
    TreeTableModule,
    ReviewEditDialogComponent,
  ],
  host: {
    class: 'block h-full',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    <div class="flex h-full flex-col">
      <!-- Header -->
      <header class="flex items-center justify-between border-b border-slate-200 px-6 py-3">
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-base font-semibold text-slate-900">Review import proposals</h1>
          @if (proposal(); as p) {
            <p class="mt-0.5 truncate text-xs text-slate-500">
              {{ p.source_title ?? 'Untitled source' }}
              @if (p.source_date) {
                <span class="mx-1 text-slate-300">|</span>
                {{ p.source_date }}
              }
              @if (p.source_url) {
                <span class="mx-1 text-slate-300">|</span>
                <a
                  [href]="p.source_url"
                  target="_blank"
                  rel="noopener"
                  class="text-brand-600 hover:underline"
                  [pTooltip]="p.source_url"
                  tooltipPosition="bottom"
                  >{{ sourceHostname() }}</a
                >
              }
            </p>
          }
        </div>
        <div class="flex items-center gap-2">
          <p-button
            label="Download JSON"
            icon="fa-solid fa-download"
            size="small"
            [text]="true"
            severity="secondary"
            pTooltip="Download full proposal as JSON"
            tooltipPosition="bottom"
            (onClick)="downloadProposal()"
          />
          <p-button
            label="Back"
            icon="fa-solid fa-arrow-left"
            size="small"
            [outlined]="true"
            severity="secondary"
            (onClick)="navigateBack()"
          />
        </div>
      </header>

      <!-- Two-pane body (single pane for NCT imports: no source text) -->
      <div
        class="grid min-h-0 flex-1"
        [style.gridTemplateColumns]="isNctImport() ? '1fr' : 'minmax(280px,1fr) minmax(400px,2fr)'"
      >
        @if (!isNctImport()) {
          <!-- Left pane: source text -->
          <aside class="overflow-y-auto border-r border-slate-200 bg-slate-50/50 p-4">
            <h2 class="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
              Source text
            </h2>
            @if (proposal(); as p) {
              <p
                class="mt-3 text-sm leading-relaxed text-slate-700 whitespace-pre-wrap break-words"
                [innerHTML]="highlightedSourceText()"
              ></p>
            }
          </aside>
        }

        <!-- Right pane: proposals -->
        <main class="overflow-y-auto p-4">
          <!-- Warnings -->
          @for (w of proposal()?.warnings ?? []; track w) {
            <p-message severity="warn" [closable]="false" styleClass="mb-3 w-full">
              {{ warningLabel(w) }}
            </p-message>
          }

          <!-- Dropped items -->
          @if (droppedItems().length > 0) {
            <details class="mb-4">
              <summary
                class="cursor-pointer font-mono text-[11px] uppercase tracking-[0.12em] text-slate-400"
              >
                Dropped ({{ droppedItems().length }})
              </summary>
              <div class="mt-2 space-y-1">
                @for (d of droppedItems(); track d.index) {
                  <div class="rounded bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
                    <span class="font-medium text-slate-600">{{ d.name }}</span>
                    <span class="mx-1 text-slate-300">--</span>
                    {{ d.reason }}
                  </div>
                }
              </div>
            </details>
          }

          <!-- CT.gov enrichment summary -->
          @let ctgovSummaryVal = ctgovSummary();
          @if (ctgovSummaryVal.status === 'matched') {
            <div
              class="mb-3 inline-flex items-center gap-1 rounded bg-green-50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-green-700"
            >
              <i class="fa-solid fa-circle-check text-[10px]"></i>
              CT.gov: {{ ctgovSummaryVal.matchedCount }}
              {{ ctgovSummaryVal.matchedCount === 1 ? 'trial' : 'trials' }} enriched
            </div>
          } @else if (ctgovSummaryVal.status === 'failed') {
            <div
              class="mb-3 inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.08em] text-amber-700"
            >
              <i class="fa-solid fa-triangle-exclamation text-[10px]"></i>
              CT.gov: lookup failed
            </div>
          }

          <!-- Hierarchical tree view -->
          @let tree = hierarchicalTree();

          <div
            class="mb-3 inline-flex overflow-hidden rounded border border-slate-200 bg-white text-xs"
          >
            @for (opt of filterOptions; track opt.value) {
              <button
                type="button"
                class="border-r border-slate-200 px-3 py-1.5 last:border-r-0"
                [class.bg-brand-50]="gridFilter() === opt.value"
                [class.text-brand-800]="gridFilter() === opt.value"
                [class.font-semibold]="gridFilter() === opt.value"
                [class.text-slate-500]="gridFilter() !== opt.value"
                (click)="gridFilter.set(opt.value)"
              >
                {{ opt.label }}
                <span class="ml-1 font-mono text-[10px] tabular-nums opacity-60">{{
                  filterCounts()[opt.countKey]
                }}</span>
              </button>
            }
          </div>

          <div class="overflow-x-auto">
            <p-treeTable
              [value]="filteredNodes()"
              dataKey="key"
              styleClass="min-w-[72rem] review-grid"
            >
              <ng-template pTemplate="header">
                <tr class="font-mono text-[10px] uppercase tracking-[0.06em] text-slate-400">
                  <th class="w-10"></th>
                  <th class="min-w-80">Entity</th>
                  <th class="w-[5.25rem]">Type</th>
                  <th class="w-16">Phase</th>
                  <th class="w-28">Status</th>
                  <th class="w-48">MOA / ROA</th>
                  <th class="w-48">Indication</th>
                  <th class="w-[4.5rem]">Source</th>
                  <th class="w-16 text-right">Edit</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-rowNode let-rowData="rowData">
                @let row = asGridRow(rowData);
                <tr
                  [class.opacity-50]="!isSelected(row.key)"
                  [class.bg-amber-50]="hasBlockingFlag(row)"
                >
                  <td>
                    <p-checkbox
                      [ngModel]="isSelected(row.key)"
                      (ngModelChange)="toggleSelection(row.key, $event)"
                      [binary]="true"
                      size="small"
                    />
                  </td>
                  <td class="align-top">
                    @if (isLeafRow(row)) {
                      <!-- Marker/event leaf: title on its own line, a muted meta
                           line below for category + date, so nothing competes for
                           horizontal room in the deeply-indented cell. -->
                      <div class="flex items-start gap-2">
                        <p-treeTableToggler [rowNode]="rowNode" />
                        <i
                          class="mt-1 text-[10px] text-slate-400"
                          [class.fa-solid]="true"
                          [class.fa-location-dot]="row.kind === 'marker'"
                          [class.fa-bolt]="row.kind === 'event'"
                          aria-hidden="true"
                        ></i>
                        <div class="min-w-0">
                          <div class="whitespace-normal break-words text-slate-600">
                            {{ row.name }}
                          </div>
                          @if (row.category || row.date || row.state === 'existing') {
                            <div
                              class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-[0.04em] text-slate-400"
                            >
                              @if (row.category) {
                                <span class="text-slate-500">{{ row.category }}</span>
                              }
                              @if (row.date) {
                                <span class="tabular-nums">{{ row.date }}</span>
                              }
                              @if (row.state === 'existing') {
                                <span>existing</span>
                              }
                            </div>
                          }
                        </div>
                      </div>
                    } @else {
                      <div class="flex items-start gap-2">
                        <p-treeTableToggler [rowNode]="rowNode" />
                        <span
                          class="whitespace-normal break-words"
                          [class.font-mono]="row.kind === 'company'"
                          [class.font-bold]="row.kind === 'company'"
                          [class.uppercase]="row.kind === 'company'"
                          [class.font-semibold]="row.kind === 'asset'"
                          [class.text-brand-600]="row.kind === 'trial'"
                          >{{ row.name }}</span
                        >
                        @if (row.state === 'existing') {
                          <span
                            class="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500"
                            >existing</span
                          >
                        }
                        @if (row.multiAssetRole === 'primary') {
                          <span
                            class="rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-cyan-700"
                            pTooltip="This trial tests more than one asset; this is its primary (headline) asset"
                            tooltipPosition="top"
                            >primary</span
                          >
                        } @else if (row.multiAssetRole === 'secondary') {
                          <span
                            class="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-400"
                            pTooltip="This trial also tests this asset; its primary asset is shown elsewhere"
                            tooltipPosition="top"
                            >also tested</span
                          >
                        }
                        @for (f of row.flags; track f.id) {
                          <span
                            class="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-amber-700"
                            >{{ f.label }}</span
                          >
                        }
                      </div>
                    }
                  </td>
                  <td class="align-top font-mono text-[10px] uppercase text-slate-400">
                    {{ row.kind === 'company' ? '' : row.kind }}
                  </td>
                  <td class="align-top">
                    @if (row.phase) {
                      <span
                        class="rounded border border-brand-200 bg-brand-50 px-1 py-0.5 font-mono text-[10px] uppercase text-brand-700"
                        >{{ row.phase }}</span
                      >
                    }
                  </td>
                  <td class="align-top whitespace-normal break-words text-slate-500">
                    {{ row.status }}
                  </td>
                  <td class="align-top whitespace-normal break-words text-slate-500">
                    {{ row.moaRoa }}
                  </td>
                  <td class="align-top whitespace-normal break-words text-slate-500">
                    {{ row.indication }}
                  </td>
                  <td class="align-top">
                    @if (row.kind === 'trial') {
                      <span
                        class="rounded border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 font-mono text-[10px] uppercase text-cyan-700"
                        >ct.gov</span
                      >
                    }
                  </td>
                  <td class="align-top text-right">
                    @if (!isLeafRow(row)) {
                      <button
                        type="button"
                        class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
                        (click)="openEdit(row.type, row.idx)"
                        [pTooltip]="'Edit ' + row.kind"
                        tooltipPosition="left"
                        [attr.aria-label]="'Edit ' + row.name"
                      >
                        <i class="fa-solid fa-pen text-[11px]"></i>
                      </button>
                    }
                  </td>
                </tr>
              </ng-template>
              <ng-template pTemplate="emptymessage">
                <tr>
                  <td colspan="9" class="px-4 py-10 text-center text-sm text-slate-500">
                    {{ emptyFilterMessage() }}
                  </td>
                </tr>
              </ng-template>
            </p-treeTable>
          </div>

          <!-- Reusable read-only orphan row -->
          <ng-template #orphanRow let-type="type" let-idx="idx" let-editable="editable">
            @let orphKey = entityKey(type, idx);
            <div class="flex items-center gap-2 py-1">
              <p-checkbox
                [ngModel]="isSelected(orphKey)"
                (ngModelChange)="toggleSelection(orphKey, $event)"
                [binary]="true"
                [inputId]="orphKey"
                size="small"
              />
              <span class="min-w-0 flex-1 truncate text-sm text-slate-700">{{
                entityName(type, idx)
              }}</span>
              @if (type === 'trials') {
                @let orphPhase = trialPhase(idx);
                @if (orphPhase) {
                  <span
                    class="rounded border border-brand-200 bg-brand-50 px-1 py-0.5 font-mono text-[10px] uppercase text-brand-700"
                    >{{ orphPhase }}</span
                  >
                }
              }
              @if (!isNew(type, idx)) {
                <span
                  class="rounded border border-slate-200 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500"
                  >existing</span
                >
              }
              @if (editable) {
                <button
                  type="button"
                  class="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-brand-600"
                  (click)="openEdit(type, idx)"
                  pTooltip="Edit"
                  tooltipPosition="left"
                  [attr.aria-label]="'Edit ' + entityName(type, idx)"
                >
                  <i class="fa-solid fa-pen text-[11px]"></i>
                </button>
              }
            </div>
          </ng-template>

          <!-- Orphaned trials (asset_ref does not resolve to an asset) -->
          @if (tree.orphanTrials.length > 0) {
            <section class="mb-4">
              <h2 class="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Unlinked trials ({{ tree.orphanTrials.length }})
              </h2>
              <div class="rounded border border-amber-200 bg-white px-4 py-2">
                <p class="mb-1 text-[11px] text-amber-700">
                  These trials have no resolvable asset. Edit each to assign one before confirming.
                </p>
                @for (ti of tree.orphanTrials; track ti) {
                  <ng-container
                    [ngTemplateOutlet]="orphanRow"
                    [ngTemplateOutletContext]="{ type: 'trials', idx: ti, editable: true }"
                  />
                }
              </div>
            </section>
          }

          <!-- Orphaned markers (no trial_refs) -->
          @if (tree.orphanMarkers.length > 0) {
            <section class="mb-4">
              <h2 class="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Unlinked markers ({{ tree.orphanMarkers.length }})
              </h2>
              <div class="rounded border border-slate-200 bg-white px-4 py-2">
                @for (mi of tree.orphanMarkers; track mi) {
                  <ng-container
                    [ngTemplateOutlet]="orphanRow"
                    [ngTemplateOutletContext]="{ type: 'markers', idx: mi, editable: false }"
                  />
                }
              </div>
            </section>
          }

          <!-- Orphaned events (space-level) -->
          @if (tree.orphanEvents.length > 0) {
            <section class="mb-4">
              <h2 class="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
                Unlinked events ({{ tree.orphanEvents.length }})
              </h2>
              <div class="rounded border border-slate-200 bg-white px-4 py-2">
                @for (ei of tree.orphanEvents; track ei) {
                  <ng-container
                    [ngTemplateOutlet]="orphanRow"
                    [ngTemplateOutletContext]="{ type: 'events', idx: ei, editable: false }"
                  />
                }
              </div>
            </section>
          }
        </main>
      </div>

      <!-- Footer -->
      <footer
        class="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-3"
      >
        <span class="text-xs text-slate-500">
          {{ selectedCount() }} of {{ totalCount() }} selected: {{ footerSummary() }}
        </span>
        @if (blockingMessage(); as msg) {
          <span class="text-xs text-amber-700">{{ msg }}</span>
        }

        @if (commitError()) {
          <span class="text-xs text-red-600">{{ commitError() }}</span>
        }

        <div class="flex items-center gap-2">
          <p-button
            label="Cancel"
            size="small"
            severity="secondary"
            [text]="true"
            (onClick)="navigateBack()"
          />
          <p-button
            [label]="'Confirm ' + selectedCount() + ' items'"
            size="small"
            [loading]="committing()"
            [disabled]="!canConfirm()"
            (onClick)="confirm()"
            pTooltip="Cmd/Ctrl+Enter"
            tooltipPosition="top"
          />
        </div>
      </footer>

      <app-review-edit-dialog
        [type]="editType()"
        [index]="editIndex()"
        [spaceId]="spaceId()"
        (saved)="proposalEdited.set(true)"
        (closed)="closeEdit()"
      />
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReviewPageComponent implements OnInit, HasUnsavedImport {
  private readonly sourceImportService = inject(SourceImportService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly supabase = inject(SupabaseService);
  private readonly messages = inject(MessageService);
  private readonly rpcCache = inject(RpcCache);
  private readonly changeEventService = inject(ChangeEventService);

  protected readonly entityOrder = ENTITY_ORDER;

  private static readonly WARNING_LABELS: Record<string, string> = {
    empty_extraction:
      'No companies, assets, or trials could be extracted from this source. The text may be too short, off-topic, or in a format the model did not recognize.',
  };

  protected warningLabel(code: string): string {
    if (code.startsWith('ctgov_partial:')) {
      return 'Some trial enrichment from ClinicalTrials.gov failed. You can still commit, but CT.gov fields may be incomplete.';
    }
    return ReviewPageComponent.WARNING_LABELS[code] ?? code;
  }

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly aiCallId = signal('');

  readonly proposal = computed(() => this.sourceImportService.proposal());
  readonly isNctImport = computed(() => this.proposal()?.source_kind === 'nct');

  readonly selections = signal<Record<string, boolean>>({});
  readonly matchOverrides = signal<Record<string, string>>({});
  readonly fieldEdits = signal<Record<string, Record<string, string>>>({});
  readonly nctOverrides = signal<Record<number, string>>({});
  // Per-trial-index overrides for asset membership. When a key is absent the
  // proposal's own asset_refs / primary_asset_ref are used; an entry replaces them.
  readonly assetRefsOverrides = signal<Record<number, number[]>>({});
  readonly primaryRefOverrides = signal<Record<number, number>>({});

  readonly committing = signal(false);
  readonly commitError = signal<string | null>(null);
  readonly committed = signal(false);
  readonly highlightedEvidence = signal<{ text: string; pinned: boolean } | null>(null);

  // The entity currently open in the edit dialog (null when closed).
  private readonly editTarget = signal<{ type: EditableEntityType; index: number } | null>(null);
  protected readonly editType = computed<EditableEntityType | null>(
    () => this.editTarget()?.type ?? null
  );
  protected readonly editIndex = computed<number | null>(() => this.editTarget()?.index ?? null);

  // Set once the user saves an edit through the dialog; the dialog mutates the
  // proposal in place, so the override-based dirty check below cannot see it.
  protected readonly proposalEdited = signal(false);

  protected openEdit(type: EntityType, index: number): void {
    if (type !== 'companies' && type !== 'assets' && type !== 'trials') return;
    this.editTarget.set({ type, index });
  }

  protected closeEdit(): void {
    this.editTarget.set(null);
  }

  readonly dirty = computed(() => {
    const sel = this.selections();
    const edits = this.fieldEdits();
    const overrides = this.matchOverrides();
    return (
      this.proposalEdited() ||
      Object.values(sel).some((v) => v === false) ||
      Object.keys(edits).length > 0 ||
      Object.keys(overrides).length > 0
    );
  });

  readonly droppedItems = computed(() => this.proposal()?.dropped ?? []);

  readonly ctgovSummary = computed<{
    status: 'matched' | 'no_matches' | 'failed' | 'no_new';
    matchedCount: number;
  }>(() => {
    const p = this.proposal();
    if (!p) return { status: 'no_new', matchedCount: 0 };

    const trials = p.proposals.trials ?? [];
    const newTrials = trials.filter((t) => {
      const match = t['match'] as { kind: string } | undefined;
      return !match || match.kind !== 'existing';
    });

    if (newTrials.length === 0) return { status: 'no_new', matchedCount: 0 };

    const anyFailed = p.warnings.some((w) => w.startsWith('ctgov_partial:'));
    let matchedCount = 0;
    for (let i = 0; i < trials.length; i++) {
      const match = trials[i]['match'] as { kind: string } | undefined;
      if (match?.kind === 'existing') continue;
      const candidates = p.ctgov_candidates[`trials_${i}`] ?? [];
      if (candidates.length > 0) matchedCount++;
    }

    if (matchedCount > 0) return { status: 'matched', matchedCount };
    if (anyFailed) return { status: 'failed', matchedCount: 0 };
    return { status: 'no_matches', matchedCount: 0 };
  });

  readonly selectedCount = computed(() => {
    const sel = this.selections();
    return Object.values(sel).filter((v) => v).length;
  });

  readonly totalCount = computed(() => {
    const p = this.proposal()?.proposals;
    if (!p) return 0;
    return ENTITY_ORDER.reduce((sum, t) => sum + (p[t]?.length ?? 0), 0);
  });

  readonly canConfirm = computed(() => {
    if (this.committing()) return false;
    if (this.selectedCount() === 0) return false;

    const p = this.proposal()?.proposals;
    if (!p) return false;
    const sel = this.selections();
    const trials = p.trials ?? [];
    const dupes = duplicateTrialIndexes(trials);
    for (let i = 0; i < trials.length; i++) {
      if (sel[`trials_${i}`] === false) continue;
      if (this.trialMissingAsset(trials[i])) return false;
      if (dupes.has(i)) return false;
    }
    return true;
  });

  protected readonly footerSummary = computed(() => {
    const p = this.proposal()?.proposals;
    const sel = this.selections();
    const count = (type: EntityType) =>
      (p?.[type] ?? []).filter((_, i) => sel[`${type}_${i}`] !== false).length;
    return readableSummary({
      companies: count('companies'),
      assets: count('assets'),
      trials: count('trials'),
      markers: count('markers'),
      events: count('events'),
    });
  });

  protected readonly blockingMessage = computed(() => {
    const p = this.proposal()?.proposals;
    if (!p) return null;
    const trials = p.trials ?? [];
    const sel = this.selections();
    const dupes = duplicateTrialIndexes(trials);
    let noAsset = 0;
    trials.forEach((t, idx) => {
      if (sel[`trials_${idx}`] !== false && this.trialMissingAsset(t)) noAsset++;
    });
    let duplicates = 0;
    dupes.forEach((idx) => {
      if (sel[`trials_${idx}`] !== false) duplicates++;
    });
    return blockingReason({ noAsset, duplicates });
  });

  readonly hierarchicalTree = computed<HierarchicalTree>(() => {
    const p = this.proposal();
    if (!p) return { companies: [], orphanTrials: [], orphanMarkers: [], orphanEvents: [] };

    const companies = p.proposals.companies ?? [];
    const assets = p.proposals.assets ?? [];
    const trials = p.proposals.trials ?? [];
    const markers = p.proposals.markers ?? [];
    const events = p.proposals.events ?? [];

    const trialMarkersMap = new Map<number, number[]>();
    const assignedMarkers = new Set<number>();
    for (let mi = 0; mi < markers.length; mi++) {
      const refs = (markers[mi]['trial_refs'] as number[]) ?? [];
      for (const tr of refs) {
        if (tr < trials.length) {
          if (!trialMarkersMap.has(tr)) trialMarkersMap.set(tr, []);
          trialMarkersMap.get(tr)!.push(mi);
          assignedMarkers.add(mi);
        }
      }
    }

    const trialEventsMap = new Map<number, number[]>();
    const assetEventsMap = new Map<number, number[]>();
    const companyEventsMap = new Map<number, number[]>();
    const assignedEvents = new Set<number>();
    for (let ei = 0; ei < events.length; ei++) {
      const anchor = events[ei]['anchor'] as { level: string; ref: number | null } | undefined;
      if (!anchor || anchor.ref == null) continue;
      const ref = anchor.ref;
      if (anchor.level === 'trial' && ref < trials.length) {
        if (!trialEventsMap.has(ref)) trialEventsMap.set(ref, []);
        trialEventsMap.get(ref)!.push(ei);
        assignedEvents.add(ei);
      } else if (anchor.level === 'asset' && ref < assets.length) {
        if (!assetEventsMap.has(ref)) assetEventsMap.set(ref, []);
        assetEventsMap.get(ref)!.push(ei);
        assignedEvents.add(ei);
      } else if (anchor.level === 'company' && ref < companies.length) {
        if (!companyEventsMap.has(ref)) companyEventsMap.set(ref, []);
        companyEventsMap.get(ref)!.push(ei);
        assignedEvents.add(ei);
      }
    }

    // A trial nests under EVERY asset it tests, so a master-protocol trial
    // appears beneath each of its assets (orphan when it resolves to none).
    const assetTrialsMap = new Map<number, number[]>();
    for (let ti = 0; ti < trials.length; ti++) {
      for (const ai of resolveTrialAssetIndexes(trials[ti], assets.length)) {
        if (!assetTrialsMap.has(ai)) assetTrialsMap.set(ai, []);
        assetTrialsMap.get(ai)!.push(ti);
      }
    }

    const companyAssetsMap = new Map<number, number[]>();
    for (let ai = 0; ai < assets.length; ai++) {
      const cr = assets[ai]['company_ref'] as number | undefined;
      if (cr != null && cr < companies.length) {
        if (!companyAssetsMap.has(cr)) companyAssetsMap.set(cr, []);
        companyAssetsMap.get(cr)!.push(ai);
      }
    }

    const companyNodes: CompanyNode[] = companies.map((_, ci) => ({
      companyIdx: ci,
      assets: (companyAssetsMap.get(ci) ?? []).map((ai) => ({
        assetIdx: ai,
        trials: (assetTrialsMap.get(ai) ?? []).map((ti) => ({
          trialIdx: ti,
          markers: trialMarkersMap.get(ti) ?? [],
          events: trialEventsMap.get(ti) ?? [],
        })),
        markers: [] as number[],
        events: assetEventsMap.get(ai) ?? [],
      })),
      events: companyEventsMap.get(ci) ?? [],
    }));

    const orphanMarkers: number[] = [];
    for (let mi = 0; mi < markers.length; mi++) {
      if (!assignedMarkers.has(mi)) orphanMarkers.push(mi);
    }

    const orphanEvents: number[] = [];
    for (let ei = 0; ei < events.length; ei++) {
      if (!assignedEvents.has(ei)) orphanEvents.push(ei);
    }

    // Trials whose asset_ref does not resolve to an asset have no place in the
    // company -> asset -> trial tree. Surface them so they cannot vanish while
    // still counting toward the "(N trials)" header (the master-protocol case).
    const orphanTrials = orphanTrialIndexes(trials, assets.length);

    return { companies: companyNodes, orphanTrials, orphanMarkers, orphanEvents };
  });

  protected hasBlockingFlag(row: GridRow): boolean {
    return row.flags.some((f) => f.tier === 'blocking');
  }
  // Marker/event leaf rows render their identity in the entity cell and have no
  // edit dialog, so the template branches on this.
  protected isLeafRow(row: GridRow): boolean {
    return LEAF_KINDS.has(row.kind);
  }
  // PrimeNG TreeTable rowData is untyped; cast once so the template is type-checked.
  protected asGridRow(rowData: unknown): GridRow {
    return rowData as GridRow;
  }

  protected readonly gridNodes = computed<TreeNode[]>(() => {
    const tree = this.hierarchicalTree();
    const trials = this.entitiesOf('trials');
    const assetCount = this.entitiesOf('assets').length;
    const dupes = duplicateTrialIndexes(trials);

    // Markers and events nest as leaf rows under the entity they describe. The
    // selection key stays per-entity (so a marker shared by two trials toggles
    // together) while the tree-node key is namespaced by the parent node, since
    // the same leaf can appear under several parents (mirrors multi-asset trials).
    const leafRow = (type: 'markers' | 'events', idx: number, parentNodeKey: string): TreeNode => {
      const e = this.entitiesOf(type)[idx];
      const disp = type === 'markers' ? markerLeafDisplay(e) : eventLeafDisplay(e);
      const row: GridRow = {
        key: this.entityKey(type, idx),
        type,
        idx,
        kind: type === 'markers' ? 'marker' : 'event',
        name: this.entityName(type, idx),
        state: entityState(e),
        phase: null,
        status: null,
        moaRoa: '',
        indication: null,
        flags: [],
        category: disp.category,
        date: disp.date,
      };
      return { key: `${parentNodeKey}/${row.key}`, data: row };
    };

    const branch = (key: string, data: GridRow, children: TreeNode[]): TreeNode =>
      children.length > 0 ? { key, data, expanded: true, children } : { key, data };

    const trialRow = (tn: TrialNode, parentAssetIdx: number): TreeNode => {
      const idx = tn.trialIdx;
      const t = trials[idx];
      const flags = [
        ...deriveTrialFlags(t),
        deriveCtgovFlag(this.ctgovCandidatesFor(idx).length),
        deriveFuzzyFlag(this.fuzzyAlternatesFor('trials', idx).length),
      ].filter((f): f is ReviewFlag => f !== null);
      if (dupes.has(idx)) {
        flags.unshift({ id: 'duplicate', tier: 'blocking', label: 'Duplicate in batch' });
      }
      const assetIdxs = resolveTrialAssetIndexes(t, assetCount);
      const multiAssetRole =
        assetIdxs.length > 1
          ? resolveTrialPrimaryAssetIndex(t, assetCount) === parentAssetIdx
            ? 'primary'
            : 'secondary'
          : undefined;
      const row: GridRow = {
        key: this.entityKey('trials', idx),
        type: 'trials',
        idx,
        kind: 'trial',
        name: this.entityName('trials', idx),
        state: entityState(t),
        phase: this.trialPhase(idx),
        status: this.trialStatus(idx),
        moaRoa: '',
        indication: this.trialIndicationLabel(t),
        flags,
        multiAssetRole,
      };
      // The tree-node key must be unique per nesting: a multi-asset trial appears
      // under several assets, so namespace it by the parent asset. row.key (the
      // selection key) stays per-trial so both copies share state.
      const nodeKey = `assets_${parentAssetIdx}/${row.key}`;
      return branch(nodeKey, row, [
        ...tn.markers.map((mi) => leafRow('markers', mi, nodeKey)),
        ...tn.events.map((ei) => leafRow('events', ei, nodeKey)),
      ]);
    };

    const assetRow = (an: AssetNode): TreeNode => {
      const idx = an.assetIdx;
      const a = this.entitiesOf('assets')[idx];
      const flags = [
        ...deriveAssetFlags(a),
        deriveFuzzyFlag(this.fuzzyAlternatesFor('assets', idx).length),
      ].filter((f): f is ReviewFlag => f !== null);
      const row: GridRow = {
        key: this.entityKey('assets', idx),
        type: 'assets',
        idx,
        kind: 'asset',
        name: this.entityName('assets', idx),
        state: entityState(a),
        phase: null,
        status: null,
        moaRoa: [...this.assetMoas(idx), ...this.assetRoas(idx)].join(' / '),
        indication: null,
        flags,
      };
      return branch(row.key, row, [
        ...an.trials.map((tn) => trialRow(tn, an.assetIdx)),
        ...an.events.map((ei) => leafRow('events', ei, row.key)),
      ]);
    };

    return tree.companies.map((cn) => {
      const row: GridRow = {
        key: this.entityKey('companies', cn.companyIdx),
        type: 'companies',
        idx: cn.companyIdx,
        kind: 'company',
        name: this.entityName('companies', cn.companyIdx),
        state: entityState(this.entitiesOf('companies')[cn.companyIdx]),
        phase: null,
        status: null,
        moaRoa: '',
        indication: null,
        flags: [],
      };
      return branch(row.key, row, [
        ...cn.assets.map((an) => assetRow(an)),
        ...cn.events.map((ei) => leafRow('events', ei, row.key)),
      ]);
    });
  });

  protected readonly gridFilter = signal<'all' | 'flagged' | 'new'>('all');

  protected readonly filteredNodes = computed<TreeNode[]>(() => {
    const f = this.gridFilter();
    if (f === 'all') return this.gridNodes();
    const keep = (row: GridRow) => (f === 'flagged' ? row.flags.length > 0 : row.state === 'new');
    // Keep a parent if it or any descendant matches, so linkage context is preserved.
    const filterNode = (node: TreeNode): TreeNode | null => {
      const children = (node.children ?? [])
        .map(filterNode)
        .filter((n): n is TreeNode => n !== null);
      const selfKeep = keep(node.data as GridRow);
      if (!selfKeep && children.length === 0) return null;
      return { ...node, children, expanded: true };
    };
    return this.gridNodes()
      .map(filterNode)
      .filter((n): n is TreeNode => n !== null);
  });

  protected readonly filterCounts = computed(() => countFilterMatches(this.gridNodes()));

  protected readonly emptyFilterMessage = computed(() => {
    switch (this.gridFilter()) {
      case 'flagged':
        return 'Nothing needs review. Every proposal in this batch is complete and matched.';
      case 'new':
        return 'No new records. Every proposal in this batch matched an existing record.';
      default:
        return 'No proposals in this batch.';
    }
  });

  protected readonly filterOptions = [
    { value: 'all' as const, label: 'All', countKey: 'all' as const },
    { value: 'flagged' as const, label: 'Needs review', countKey: 'flagged' as const },
    { value: 'new' as const, label: 'New', countKey: 'new' as const },
  ];

  readonly highlightedSourceText = computed(() => {
    const p = this.proposal();
    if (!p) return '';
    const evidence = this.highlightedEvidence();
    const raw = p.source_text;
    if (!evidence?.text) return escapeHtml(raw);

    const needle = evidence.text
      .replace(/\.\.\./g, '')
      .replace(/…/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    const rawLower = raw.toLowerCase();
    const idx = fuzzyIndexOf(rawLower, needle);
    if (idx < 0) return escapeHtml(raw);

    const endIdx = fuzzyEndIndex(rawLower, needle, idx);
    return (
      escapeHtml(raw.slice(0, idx)) +
      '<mark class="bg-amber-200 rounded px-0.5">' +
      escapeHtml(raw.slice(idx, endIdx)) +
      '</mark>' +
      escapeHtml(raw.slice(endIdx))
    );
  });

  ngOnInit(): void {
    this.extractRouteParams();
    this.initSelections();
  }

  hasUnsavedChanges(): boolean {
    return this.dirty() && !this.committed();
  }

  protected sourceHostname(): string {
    const url = this.proposal()?.source_url;
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  protected entitiesOf(type: EntityType): Record<string, unknown>[] {
    return this.proposal()?.proposals[type] ?? [];
  }

  protected entityKey(type: EntityType, index: number): string {
    return `${type}_${index}`;
  }

  protected isSelected(key: string): boolean {
    return this.selections()[key] !== false;
  }

  protected isNew(type: EntityType, index: number): boolean {
    const entity = this.entitiesOf(type)[index];
    if (!entity) return true;
    const match = entity['match'] as { kind: string } | undefined;
    if (!match) return true;
    return match.kind !== 'existing';
  }

  protected entityName(type: EntityType, index: number): string {
    const entity = this.entitiesOf(type)[index];
    if (!entity) return '';
    const resolved = this.proposal()?.resolved_names?.[`${type}_${index}`];
    if (resolved) return resolved;
    return (entity['name'] as string) ?? (entity['title'] as string) ?? `${type} #${index + 1}`;
  }

  protected trialPhase(index: number): string | null {
    const entity = this.entitiesOf('trials')[index];
    return (entity?.['phase'] as string) ?? null;
  }

  protected trialStatus(index: number): string | null {
    const entity = this.entitiesOf('trials')[index];
    return (entity?.['status'] as string) ?? null;
  }

  // Display label for a trial's indication(s): the indications[] array joined,
  // falling back to a legacy scalar indication.
  private trialIndicationLabel(entity: Record<string, unknown>): string | null {
    const many = entity['indications'];
    if (Array.isArray(many)) {
      const names = many.filter((i): i is string => typeof i === 'string' && i.length > 0);
      return names.length ? names.join(', ') : null;
    }
    const one = entity['indication'];
    return typeof one === 'string' && one.length > 0 ? one : null;
  }

  protected assetMoas(index: number): string[] {
    const entity = this.entitiesOf('assets')[index];
    return (entity?.['moa'] as string[]) ?? [];
  }

  protected assetRoas(index: number): string[] {
    const entity = this.entitiesOf('assets')[index];
    return (entity?.['roa'] as string[]) ?? [];
  }

  protected fuzzyAlternatesFor(type: EntityType, index: number): FuzzyAlternate[] {
    const p = this.proposal();
    if (!p) return [];
    const key = `${type}_${index}`;
    return p.fuzzy_alternates[key] ?? [];
  }

  protected ctgovCandidatesFor(index: number): CtgovCandidate[] {
    const p = this.proposal();
    if (!p) return [];
    return p.ctgov_candidates[`trials_${index}`] ?? [];
  }

  protected trialMissingAsset(entity: Record<string, unknown>): boolean {
    // Delegate to the pure logic module so the grid's no-asset flag and the
    // commit gate share one definition (an existing_id match also counts).
    return trialMissingAssetLogic(entity);
  }

  protected toggleSelection(key: string, value: boolean): void {
    this.selections.update((prev) => ({ ...prev, [key]: value }));
  }

  protected toggleAllOfType(type: EntityType): void {
    const items = this.entitiesOf(type);
    const allSelected = this.allOfTypeSelected(type);
    this.selections.update((prev) => {
      const next = { ...prev };
      for (let i = 0; i < items.length; i++) {
        next[`${type}_${i}`] = !allSelected;
      }
      return next;
    });
  }

  protected allOfTypeSelected(type: EntityType): boolean {
    const items = this.entitiesOf(type);
    const sel = this.selections();
    return items.every((_, i) => sel[`${type}_${i}`] !== false);
  }

  protected downloadProposal(): void {
    const blob = new Blob([JSON.stringify(this.buildExportPayload(), null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `import-${this.aiCallId()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  protected async confirm(): Promise<void> {
    this.committing.set(true);
    this.commitError.set(null);

    const session = this.supabase.session();
    if (!session) {
      this.committing.set(false);
      return;
    }

    const payload = this.buildCommitPayload();

    const { data, error } = await this.supabase.client.rpc('commit_source_import', {
      p_space_id: this.spaceId(),
      p_ai_call_id: this.aiCallId(),
      p_source_document: payload.sourceDocument,
      p_proposal: payload.proposal,
      p_inventory_snapshot_hash: this.proposal()!.inventory_snapshot_hash,
    });

    if (error) {
      this.committing.set(false);
      this.commitError.set(error.message);
      return;
    }

    if (this.isNctImport()) {
      const result = data as { created?: { trials?: string[] } } | null;
      const createdTrialIds = result?.created?.trials ?? [];
      for (const trialId of createdTrialIds) {
        // fire-and-forget: sync runs in the background via the worker
        this.changeEventService
          .triggerSingleTrialSync(trialId)
          .catch(Function.prototype as () => void);
      }
    }

    this.committed.set(true);
    this.committing.set(false);
    this.sourceImportService.clearProposal();

    const sid = this.spaceId();
    this.rpcCache.invalidateTags([
      `space:${sid}:dashboard`,
      `space:${sid}:landing-stats`,
      `space:${sid}:companies`,
      `space:${sid}:products`,
      `space:${sid}:trials`,
      `space:${sid}:activity`,
      `space:${sid}:events`,
      `space:${sid}:tags`,
      `space:${sid}:moa`,
      `space:${sid}:roa`,
    ]);

    const title = this.proposal()?.source_title ?? 'source';
    this.messages.add({
      severity: 'success',
      summary: `Committed ${this.selectedCount()} items from ${title}. View in timeline.`,
      life: 5000,
    });

    void this.router.navigate(['/t', this.tenantId(), 's', this.spaceId()]);
  }

  protected navigateBack(): void {
    void this.router.navigate(['/t', this.tenantId(), 's', this.spaceId()]);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.navigateBack();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (this.canConfirm()) {
        void this.confirm();
      }
    }
  }

  private extractRouteParams(): void {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      if (snap.paramMap.has('aiCallId')) this.aiCallId.set(snap.paramMap.get('aiCallId')!);
      snap = snap.parent;
    }
  }

  private initSelections(): void {
    const proposal = this.proposal();
    const p = proposal?.proposals;
    if (!p) return;
    const sel: Record<string, boolean> = {};
    for (const type of ENTITY_ORDER) {
      const items = p[type] ?? [];
      for (let i = 0; i < items.length; i++) {
        sel[`${type}_${i}`] = true;
      }
    }
    this.selections.set(sel);

    if (proposal) {
      const nctDefaults: Record<number, string> = {};
      const trials = p['trials'] ?? [];
      for (let i = 0; i < trials.length; i++) {
        const match = trials[i]['match'] as { kind: string } | undefined;
        if (match?.kind === 'existing') continue;
        const candidates = proposal.ctgov_candidates[`trials_${i}`] ?? [];
        if (candidates.length > 0) {
          nctDefaults[i] = candidates[0].nct_id;
        }
      }
      if (Object.keys(nctDefaults).length > 0) {
        this.nctOverrides.set(nctDefaults);
      }
    }
  }

  private buildCommitPayload(): {
    sourceDocument: Record<string, unknown>;
    proposal: Record<string, unknown>;
  } {
    const p = this.proposal()!;
    const sel = this.selections();
    const overrides = this.matchOverrides();
    const edits = this.fieldEdits();
    const nctOvr = this.nctOverrides();
    const assetRefsOvr = this.assetRefsOverrides();
    const primaryRefOvr = this.primaryRefOverrides();

    const filteredProposals: Record<string, unknown[]> = {};
    for (const type of ENTITY_ORDER) {
      const items = p.proposals[type] ?? [];
      filteredProposals[type] = items
        .map((item, i) => {
          const key = `${type}_${i}`;
          if (sel[key] === false) return null;

          const patched = { ...item };

          const matchOvr = overrides[key];
          if (matchOvr === '__new__') {
            patched['match'] = { kind: 'new', name: (patched['name'] as string) ?? '' };
          } else if (matchOvr) {
            patched['match'] = { kind: 'existing', id: matchOvr };
          }

          if (type === 'trials') {
            const nctId = nctOvr[i] ?? p.resolved_identifiers?.[`trials_${i}`];
            if (nctId) {
              patched['nct_id'] = nctId;
            }
            // Apply analyst edits to asset membership / primary, if any.
            const arOvr = assetRefsOvr[i];
            if (arOvr) {
              patched['asset_refs'] = arOvr;
            }
            const pOvr = primaryRefOvr[i];
            if (pOvr != null) {
              patched['primary_asset_ref'] = pOvr;
            }
          }

          const fieldPatch = edits[key];
          if (fieldPatch) {
            for (const [field, value] of Object.entries(fieldPatch)) {
              patched[field] = value;
            }
          }

          return patched;
        })
        .filter((item): item is Record<string, unknown> => item !== null);
    }

    const assets = (filteredProposals['assets'] ?? []) as Record<string, unknown>[];
    for (const asset of assets) {
      if (asset['moa'] && !asset['moas']) {
        asset['moas'] = asset['moa'];
        delete asset['moa'];
      }
      if (asset['roa'] && !asset['roas']) {
        asset['roas'] = asset['roa'];
        delete asset['roa'];
      }
    }

    const moaSet = new Set<string>();
    const roaSet = new Set<string>();
    for (const asset of assets) {
      for (const m of (asset['moas'] as string[]) ?? []) moaSet.add(m);
      for (const r of (asset['roas'] as string[]) ?? []) roaSet.add(r);
    }

    return {
      sourceDocument: {
        source_kind: p.source_kind,
        source_url: p.source_url,
        source_title: p.source_title,
        source_date: p.source_date,
        source_summary: p.source_summary,
        source_text: p.source_text,
        text_hash: p.source_text_hash,
      },
      proposal: {
        ...filteredProposals,
        new_moas: [...moaSet].map((name) => ({ name })),
        new_roas: [...roaSet].map((name) => ({ name })),
        dropped: p.dropped,
      },
    };
  }

  private buildExportPayload(): Record<string, unknown> {
    const p = this.proposal()!;
    return {
      ai_call_id: p.ai_call_id,
      source_title: p.source_title,
      source_date: p.source_date,
      source_summary: p.source_summary,
      proposals: p.proposals,
      dropped: p.dropped,
      fuzzy_alternates: p.fuzzy_alternates,
      ctgov_candidates: p.ctgov_candidates,
      selections: this.selections(),
      match_overrides: this.matchOverrides(),
      field_edits: this.fieldEdits(),
      nct_overrides: this.nctOverrides(),
    };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fuzzyIndexOf(haystack: string, needle: string): number {
  const h = haystack.replace(/\s+/g, ' ');
  const n = needle.replace(/\s+/g, ' ').trim();
  const pos = h.indexOf(n);
  if (pos < 0) return -1;

  let realPos = 0;
  let normPos = 0;
  while (normPos < pos && realPos < haystack.length) {
    if (/\s/.test(haystack[realPos]) && realPos > 0 && /\s/.test(haystack[realPos - 1])) {
      realPos++;
    } else {
      realPos++;
      normPos++;
    }
  }
  return realPos;
}

function fuzzyEndIndex(haystack: string, needle: string, startIdx: number): number {
  const n = needle.replace(/\s+/g, ' ').trim();
  let matched = 0;
  let pos = startIdx;
  while (matched < n.length && pos < haystack.length) {
    if (haystack[pos].toLowerCase() === n[matched].toLowerCase()) {
      matched++;
      pos++;
    } else if (/\s/.test(haystack[pos])) {
      pos++;
    } else {
      pos++;
      matched++;
    }
  }
  return pos;
}
