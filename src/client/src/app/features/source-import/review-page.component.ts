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
import { MessageService } from 'primeng/api';
import { Checkbox } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { Tooltip } from 'primeng/tooltip';
import { MessageModule } from 'primeng/message';

import { SupabaseService } from '../../core/services/supabase.service';
import {
  type CtgovCandidate,
  type FuzzyAlternate,
  SourceImportService,
} from './source-import.service';
import { HasUnsavedImport } from '../../core/guards/source-import-deactivate.guard';

type EntityType = 'companies' | 'assets' | 'trials' | 'markers' | 'events';

const ENTITY_LABELS: Record<EntityType, string> = {
  companies: 'Companies',
  assets: 'Assets',
  trials: 'Trials',
  markers: 'Markers',
  events: 'Events',
};

const ENTITY_SHORT: Record<EntityType, string> = {
  companies: 'C',
  assets: 'A',
  trials: 'T',
  markers: 'M',
  events: 'E',
};

const ENTITY_ORDER: EntityType[] = ['companies', 'assets', 'trials', 'markers', 'events'];

interface FieldEdit {
  field: string;
  value: string;
}

@Component({
  selector: 'app-review-page',
  imports: [FormsModule, Checkbox, ButtonModule, Tooltip, MessageModule],
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
            </p>
          }
        </div>
        <div class="flex items-center gap-2">
          <p-button
            label="Download JSON"
            icon="pi pi-download"
            size="small"
            [text]="true"
            severity="secondary"
            pTooltip="Download full proposal as JSON"
            tooltipPosition="bottom"
            (onClick)="downloadProposal()"
          />
          <p-button
            label="Back"
            icon="pi pi-arrow-left"
            size="small"
            [outlined]="true"
            severity="secondary"
            (onClick)="navigateBack()"
          />
        </div>
      </header>

      <!-- Two-pane body -->
      <div class="grid min-h-0 flex-1 grid-cols-[minmax(280px,1fr)_minmax(400px,2fr)]">
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

        <!-- Right pane: proposals -->
        <main class="overflow-y-auto p-4">
          <!-- Warnings -->
          @for (w of proposal()?.warnings ?? []; track w) {
            <p-message severity="warn" [closable]="false" styleClass="mb-3 w-full">
              {{ w }}
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

          <!-- Entity sections -->
          @for (type of entityOrder; track type) {
            @let items = entitiesOf(type);
            @if (items.length > 0) {
              <section class="mb-6">
                <div class="mb-2 flex items-center gap-2">
                  <h2 class="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {{ entityLabel(type) }} ({{ items.length }})
                  </h2>
                  <button
                    class="font-mono text-[10px] uppercase tracking-[0.12em] text-slate-400 hover:text-brand-600"
                    (click)="toggleAllOfType(type)"
                  >
                    {{ allOfTypeSelected(type) ? 'Deselect all' : 'Select all' }}
                  </button>

                  <!-- CT.gov enrichment summary for trials -->
                  @if (type === 'trials') {
                    @let summary = ctgovSummary();
                    @if (summary.status === 'matched') {
                      <span
                        class="ml-auto inline-flex items-center gap-1 rounded bg-green-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-green-700"
                      >
                        <i class="pi pi-check-circle text-[10px]"></i>
                        CT.gov: {{ summary.matchedCount }}
                        {{ summary.matchedCount === 1 ? 'trial' : 'trials' }} enriched
                      </span>
                    } @else if (summary.status === 'no_new') {
                      <span
                        class="ml-auto inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500"
                      >
                        CT.gov: all trials already in inventory
                      </span>
                    } @else if (summary.status === 'no_matches') {
                      <span
                        class="ml-auto inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500"
                      >
                        CT.gov: no matches found
                      </span>
                    } @else if (summary.status === 'failed') {
                      <span
                        class="ml-auto inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-amber-700"
                      >
                        <i class="pi pi-exclamation-triangle text-[10px]"></i>
                        CT.gov: lookup failed
                      </span>
                    }
                  }
                </div>

                @for (entity of items; track $index) {
                  @let key = entityKey(type, $index);
                  @let selected = isSelected(key);
                  <div
                    class="flex items-start gap-3 rounded border border-transparent px-3 py-2 transition-colors hover:bg-slate-50"
                    [class.bg-white]="selected"
                    [class.border-slate-200]="selected"
                    [class.opacity-50]="!selected"
                  >
                    <p-checkbox
                      [ngModel]="selected"
                      (ngModelChange)="toggleSelection(key, $event)"
                      [binary]="true"
                      [inputId]="key"
                      size="small"
                    />

                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-2">
                        <!-- Entity name -->
                        <label
                          [for]="key"
                          class="cursor-pointer truncate text-sm"
                          [class.font-semibold]="isNew(type, $index)"
                          [class.text-slate-900]="isNew(type, $index)"
                          [class.text-slate-700]="!isNew(type, $index)"
                        >
                          {{ entityName(type, $index) }}
                        </label>

                        <!-- Match status badge -->
                        @if (isNew(type, $index)) {
                          <span
                            class="inline-block rounded bg-brand-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-brand-700"
                            >New</span
                          >
                        } @else {
                          <span
                            class="inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500"
                            >Existing</span
                          >
                        }

                        <!-- Evidence pill -->
                        @let evidence = entityEvidence(type, $index);
                        @if (evidence) {
                          <button
                            class="inline-block cursor-pointer rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                            (mouseenter)="
                              highlightedEvidence.set({ text: evidence, pinned: false })
                            "
                            (mouseleave)="clearHighlightIfNotPinned()"
                            (click)="highlightedEvidence.set({ text: evidence, pinned: true })"
                            pTooltip="Click to pin highlight in source pane"
                            tooltipPosition="top"
                          >
                            Evidence
                          </button>
                        }
                      </div>

                      <!-- Fuzzy alternates for match override -->
                      @let alts = fuzzyAlternatesFor(type, $index);
                      @if (alts.length > 0) {
                        <div class="mt-1 flex flex-wrap gap-1">
                          @let override = getMatchOverride(key);
                          <button
                            class="rounded px-1.5 py-0.5 text-[10px]"
                            [class.bg-brand-100]="!override"
                            [class.text-brand-700]="!override"
                            [class.bg-slate-100]="!!override"
                            [class.text-slate-500]="!!override"
                            (click)="clearMatchOverride(key)"
                          >
                            LLM pick
                          </button>
                          @for (alt of alts; track alt.id) {
                            <button
                              class="rounded px-1.5 py-0.5 text-[10px]"
                              [class.bg-brand-100]="override === alt.id"
                              [class.text-brand-700]="override === alt.id"
                              [class.bg-slate-100]="override !== alt.id"
                              [class.text-slate-500]="override !== alt.id"
                              (click)="setMatchOverride(key, alt.id)"
                              [pTooltip]="'Score: ' + alt.score.toFixed(2)"
                              tooltipPosition="top"
                            >
                              {{ alt.name }}
                            </button>
                          }
                          <button
                            class="rounded px-1.5 py-0.5 text-[10px]"
                            [class.bg-brand-100]="override === '__new__'"
                            [class.text-brand-700]="override === '__new__'"
                            [class.bg-slate-100]="override !== '__new__'"
                            [class.text-slate-500]="override !== '__new__'"
                            (click)="setMatchOverride(key, '__new__')"
                          >
                            Create new
                          </button>
                        </div>
                      }

                      <!-- Trial-specific: CT.gov enrichment -->
                      @if (type === 'trials') {
                        @let ctgovStatus = trialCtgovStatus($index);
                        @if (ctgovStatus !== 'skipped') {
                          <div
                            class="mt-1.5 rounded border border-slate-100 bg-slate-50/60 px-3 py-2"
                          >
                            <div class="flex items-center gap-2">
                              <span
                                class="font-mono text-[10px] uppercase tracking-[0.08em] text-slate-400"
                              >
                                ClinicalTrials.gov
                              </span>
                              @if (ctgovStatus === 'matched') {
                                @let candidates = ctgovCandidatesFor($index);
                                <span
                                  class="inline-block rounded bg-green-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-green-700"
                                  >{{ candidates.length }}
                                  {{ candidates.length === 1 ? 'match' : 'matches' }}</span
                                >
                              } @else if (ctgovStatus === 'no_matches') {
                                <span
                                  class="inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500"
                                  >No matches</span
                                >
                              } @else if (ctgovStatus === 'failed') {
                                <span
                                  class="inline-block rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-amber-700"
                                  >Lookup failed</span
                                >
                              }
                            </div>

                            @let candidates = ctgovCandidatesFor($index);
                            @if (candidates.length > 0) {
                              <div class="mt-1.5 flex flex-col gap-1">
                                @let currentNct = getTrialNctOverride($index);
                                @for (c of candidates; track c.nct_id) {
                                  <label
                                    class="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-white"
                                    [class.bg-white]="currentNct === c.nct_id"
                                    [class.ring-1]="currentNct === c.nct_id"
                                    [class.ring-brand-300]="currentNct === c.nct_id"
                                  >
                                    <input
                                      type="radio"
                                      [name]="'nct_' + $index"
                                      [value]="c.nct_id"
                                      [checked]="currentNct === c.nct_id"
                                      (change)="setTrialNctOverride($index, c.nct_id)"
                                      class="accent-brand-600"
                                    />
                                    <span class="font-mono text-slate-600">{{ c.nct_id }}</span>
                                    <span class="truncate text-slate-500">{{ c.brief_title }}</span>
                                    <span
                                      class="ml-auto shrink-0 font-mono text-[10px] text-slate-400"
                                    >
                                      {{ c.phase }} / {{ c.status }}
                                    </span>
                                  </label>
                                }
                              </div>
                            }
                          </div>
                        }

                        <!-- Trial validation: asset required -->
                        @if (trialMissingAsset(entity)) {
                          <p-message
                            severity="warn"
                            [closable]="false"
                            styleClass="mt-1.5 w-full text-xs"
                          >
                            Asset required: link this trial to an asset above.
                          </p-message>
                        }
                      }

                      <!-- Inline field edits -->
                      @let fields = editableFields(type, $index);
                      @if (fields.length > 0) {
                        <div class="mt-1.5 flex flex-wrap gap-2">
                          @for (f of fields; track f.field) {
                            <label class="flex items-center gap-1 text-[11px] text-slate-500">
                              <span class="font-mono uppercase">{{ f.field }}:</span>
                              <input
                                type="text"
                                class="w-36 rounded border border-slate-200 px-1.5 py-0.5 text-xs text-slate-700 focus:border-brand-400 focus:outline-none"
                                [value]="getFieldEdit(key, f.field) ?? f.value"
                                (input)="onFieldEdit(key, f.field, $event)"
                              />
                            </label>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
              </section>
            }
          }
        </main>
      </div>

      <!-- Footer -->
      <footer
        class="flex items-center justify-between border-t border-slate-200 bg-white px-6 py-3"
      >
        <span class="text-xs text-slate-500">
          {{ selectedCount() }} of {{ totalCount() }} selected ({{ selectionSummary() }})
        </span>

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

  protected readonly entityOrder = ENTITY_ORDER;

  readonly tenantId = signal('');
  readonly spaceId = signal('');
  readonly aiCallId = signal('');

  readonly proposal = computed(() => this.sourceImportService.proposal());

  readonly selections = signal<Record<string, boolean>>({});
  readonly matchOverrides = signal<Record<string, string>>({});
  readonly fieldEdits = signal<Record<string, Record<string, string>>>({});
  readonly nctOverrides = signal<Record<number, string>>({});

  readonly committing = signal(false);
  readonly commitError = signal<string | null>(null);
  readonly committed = signal(false);
  readonly highlightedEvidence = signal<{ text: string; pinned: boolean } | null>(null);

  readonly dirty = computed(() => {
    const sel = this.selections();
    const edits = this.fieldEdits();
    const overrides = this.matchOverrides();
    return (
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

  readonly selectionSummary = computed(() => {
    const p = this.proposal()?.proposals;
    const sel = this.selections();
    if (!p) return '';
    return ENTITY_ORDER.map((type) => {
      const items = p[type] ?? [];
      const count = items.filter((_, i) => sel[`${type}_${i}`] !== false).length;
      return `${count}${ENTITY_SHORT[type]}`;
    }).join('/');
  });

  readonly canConfirm = computed(() => {
    if (this.committing()) return false;
    if (this.selectedCount() === 0) return false;

    const p = this.proposal()?.proposals;
    if (!p) return false;
    const sel = this.selections();
    const trials = p.trials ?? [];
    for (let i = 0; i < trials.length; i++) {
      if (sel[`trials_${i}`] === false) continue;
      if (this.trialMissingAsset(trials[i])) return false;
    }
    return true;
  });

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

  protected entityLabel(type: EntityType): string {
    return ENTITY_LABELS[type];
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

  protected entityEvidence(type: EntityType, index: number): string | null {
    const entity = this.entitiesOf(type)[index];
    if (!entity) return null;
    return (entity['evidence'] as string) ?? null;
  }

  protected editableFields(type: EntityType, index: number): FieldEdit[] {
    const entity = this.entitiesOf(type)[index];
    if (!entity) return [];
    const skip = new Set([
      'match',
      'name',
      'title',
      'existing_id',
      'evidence',
      'asset_ref',
      'company_ref',
      'trial_ref',
      'marker_ref',
      'sponsor_ref',
      'moa',
      'roa',
      'trial_refs',
      'tags',
      'anchor',
    ]);
    const out: FieldEdit[] = [];
    for (const [k, v] of Object.entries(entity)) {
      if (skip.has(k)) continue;
      if (typeof v === 'string' && v.length < 200) {
        out.push({ field: k, value: v });
      }
    }
    return out;
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

  protected trialCtgovStatus(index: number): 'matched' | 'no_matches' | 'failed' | 'skipped' {
    const entity = this.entitiesOf('trials')[index];
    if (!entity) return 'skipped';
    const match = entity['match'] as { kind: string } | undefined;
    if (match?.kind === 'existing') return 'skipped';

    const p = this.proposal();
    if (!p) return 'skipped';

    const hasFailed = p.warnings.some((w) => w === `ctgov_partial:trial_${index}`);
    if (hasFailed) return 'failed';

    const candidates = p.ctgov_candidates[`trials_${index}`] ?? [];
    return candidates.length > 0 ? 'matched' : 'no_matches';
  }

  protected trialMissingAsset(entity: Record<string, unknown>): boolean {
    const match = entity['match'] as { kind: string } | undefined;
    if (match?.kind === 'existing') return false;
    return entity['asset_ref'] == null;
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

  protected getMatchOverride(key: string): string | undefined {
    return this.matchOverrides()[key];
  }

  protected setMatchOverride(key: string, id: string): void {
    this.matchOverrides.update((prev) => ({ ...prev, [key]: id }));
  }

  protected clearMatchOverride(key: string): void {
    this.matchOverrides.update((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  protected getTrialNctOverride(index: number): string | undefined {
    return this.nctOverrides()[index];
  }

  protected setTrialNctOverride(index: number, nctId: string): void {
    this.nctOverrides.update((prev) => ({ ...prev, [index]: nctId }));
  }

  protected getFieldEdit(key: string, field: string): string | undefined {
    return this.fieldEdits()[key]?.[field];
  }

  protected onFieldEdit(key: string, field: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.fieldEdits.update((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), [field]: value },
    }));
  }

  protected clearHighlightIfNotPinned(): void {
    const current = this.highlightedEvidence();
    if (current && !current.pinned) {
      this.highlightedEvidence.set(null);
    }
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

    const { error } = await this.supabase.client.rpc('commit_source_import', {
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

    this.committed.set(true);
    this.committing.set(false);
    this.sourceImportService.clearProposal();

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
    const p = this.proposal()?.proposals;
    if (!p) return;
    const sel: Record<string, boolean> = {};
    for (const type of ENTITY_ORDER) {
      const items = p[type] ?? [];
      for (let i = 0; i < items.length; i++) {
        sel[`${type}_${i}`] = true;
      }
    }
    this.selections.set(sel);
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

          if (type === 'trials' && nctOvr[i]) {
            patched['nct_id'] = nctOvr[i];
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
