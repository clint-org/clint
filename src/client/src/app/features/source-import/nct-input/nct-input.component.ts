import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  OnDestroy,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { Textarea } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';

import { SupabaseService } from '../../../core/services/supabase.service';
import { IntelligenceBadgeComponent } from '../../../shared/components/intelligence-badge/intelligence-badge.component';
import { LoaderComponent } from '../../../shared/components/loader/loader.component';
import { SourceImportProposal, SourceImportService } from '../source-import.service';
import { MAX_NCTS, nctCountStatus, parseNctIds } from './nct-parse';

type NctPhase = 'idle' | 'checking-dupes' | 'fetching' | 'resolving' | 'done' | 'error';

interface NctErrorBody {
  error: string;
  message?: string;
}

interface DuplicateNct {
  nct_id: string;
  trial_name: string;
}

function workerBase(): string {
  return (window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE ?? '';
}

const NCT_STEP_LABELS: Record<Exclude<NctPhase, 'idle' | 'error'>, string> = {
  'checking-dupes': 'Checking for existing trials...',
  fetching: 'Fetching trial data from ClinicalTrials.gov...',
  resolving: 'Resolving companies and assets...',
  done: 'Done.',
};

const NCT_STEP_SEQUENCE: Exclude<NctPhase, 'idle' | 'error'>[] = [
  'checking-dupes',
  'fetching',
  'resolving',
  'done',
];

const ERROR_MESSAGES: Record<string, string> = {
  all_ncts_failed: 'Could not reach ClinicalTrials.gov. Check your connection and try again.',
  ai_resolution_failed: 'We fetched your trial data but could not resolve companies and assets.',
  preflight_rejected: 'Daily AI usage limit reached. Try again tomorrow or contact your admin.',
  no_valid_ncts: 'No valid NCT IDs found. IDs should look like NCT01234567.',
  too_many_ncts: 'Maximum 50 NCT IDs per import. Please split into batches.',
};

@Component({
  selector: 'app-nct-input',
  imports: [
    FormsModule,
    ButtonModule,
    Textarea,
    MessageModule,
    IntelligenceBadgeComponent,
    LoaderComponent,
  ],
  template: `
    @if (phase() === 'idle' || phase() === 'error') {
      <div class="flex flex-col gap-4 py-4">
        <div
          class="rounded-md border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-[12px] leading-relaxed text-slate-600"
        >
          <p class="font-medium text-slate-700">Resolve trials from ClinicalTrials.gov</p>
          <ul class="mt-1.5 list-disc space-y-1 pl-4">
            <li>
              Enter up to {{ maxNcts }} NCT IDs (NCT followed by 8 digits), one per line or
              comma-separated.
            </li>
            <li>
              Each trial is resolved into its companies and assets. You review and edit everything
              before it is saved.
            </li>
            <li>Malformed or not-found IDs are skipped and listed back to you.</li>
            <li>
              Long lists resolve in parallel batches; if a batch can't be resolved, those trials are
              skipped with a note so you can re-import them.
            </li>
          </ul>
        </div>

        <textarea
          pTextarea
          class="w-full font-mono text-[13px] leading-relaxed"
          rows="8"
          placeholder="Paste NCT IDs, one per line or comma-separated"
          [ngModel]="rawInput()"
          (ngModelChange)="rawInput.set($event)"
          aria-label="NCT IDs"
        ></textarea>

        @if (rawInput().trim().length > 0) {
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            @if (parsed().valid.length > 0) {
              <span [class]="'font-medium ' + countClass()">
                {{ parsed().valid.length }} / {{ maxNcts }} NCT
                {{ parsed().valid.length === 1 ? 'ID' : 'IDs' }}
                @if (countStatus().severity === 'over') {
                  ({{ countStatus().over }} over the limit)
                } @else if (countStatus().severity === 'at-cap') {
                  (at the limit)
                }
              </span>
            }
            @if (parsed().malformed.length > 0) {
              <span class="text-amber-700">
                {{ parsed().malformed.length }} malformed
                {{ parsed().malformed.length === 1 ? 'entry' : 'entries' }}:
                {{ parsed().malformed.join(', ') }}
              </span>
            }
            @if (parsed().valid.length === 0 && parsed().malformed.length === 0) {
              <span class="text-slate-400">No NCT IDs detected</span>
            }
          </div>
        }

        @if (tooManyError()) {
          <p-message severity="error" [closable]="false">
            Maximum {{ maxNcts }} NCT IDs per import. Please split into batches.
          </p-message>
        }

        @if (errorMessage()) {
          <p-message severity="error" [closable]="false">{{ errorMessage() }}</p-message>
          <div class="flex gap-2">
            <p-button label="Retry" size="small" [outlined]="true" (onClick)="submit()" />
          </div>
        }

        @if (duplicates().length > 0 && !dupeConfirmed()) {
          <div
            class="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            <p class="font-medium">
              {{ duplicates().length }} of {{ parsed().valid.length }} NCTs already in this space
            </p>
            <ul class="mt-2 list-inside list-disc text-[12px]">
              @for (d of duplicates(); track d.nct_id) {
                <li>{{ d.nct_id }}: {{ d.trial_name }}</li>
              }
            </ul>
          </div>
          <div class="flex gap-2">
            <p-button
              [label]="'Proceed with ' + newNctCount() + ' new trials'"
              size="small"
              [outlined]="true"
              [disabled]="newNctCount() === 0"
              (onClick)="confirmDuplicates()"
            />
            <p-button label="Cancel" size="small" [text]="true" (onClick)="resetDuplicates()" />
          </div>
        }

        <div class="flex justify-end">
          <p-button
            [label]="submitLabel()"
            size="small"
            [outlined]="true"
            [disabled]="!canSubmit()"
            (onClick)="submit()"
          />
        </div>
      </div>
    } @else {
      <div class="flex flex-col gap-3 py-6">
        <div class="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-4">
          <div class="mb-2.5">
            <app-intelligence-badge [active]="phase() !== 'done'" />
          </div>
          <div class="flex flex-col gap-2.5">
            @for (s of stepSequence; track s) {
              <div class="flex items-center gap-2.5">
                @if (stepIndex() > $index) {
                  <span class="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600">
                    <i class="fa-solid fa-check text-[11px] text-white"></i>
                  </span>
                  <span class="text-xs text-slate-500">{{ stepLabel(s) }}</span>
                } @else if (stepIndex() === $index) {
                  <app-loader [size]="20" />
                  <span class="text-xs font-medium text-slate-700">{{ stepLabel(s) }}</span>
                } @else {
                  <span
                    class="flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white"
                  ></span>
                  <span class="text-xs text-slate-400">{{ stepLabel(s) }}</span>
                }
              </div>
            }
          </div>
        </div>

        @if (doneMessage()) {
          <p class="text-center text-sm font-medium text-slate-700">{{ doneMessage() }}</p>
        }
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NctInputComponent implements OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly sourceImportService = inject(SourceImportService);
  private readonly router = inject(Router);

  readonly aiBlocked = input<boolean>(false);
  readonly spaceId = input.required<string>();
  readonly tenantId = input.required<string>();

  protected readonly rawInput = signal('');
  protected readonly phase = signal<NctPhase>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly errorCode = signal<string | null>(null);
  protected readonly duplicates = signal<DuplicateNct[]>([]);
  protected readonly dupeConfirmed = signal(false);
  protected readonly doneMessage = signal<string | null>(null);
  protected readonly progressCount = signal<string | null>(null);

  private autoNavTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly maxNcts = MAX_NCTS;

  protected readonly parsed = computed(() => parseNctIds(this.rawInput()));

  // Running status of the valid count against the cap, so the input can warn as
  // the user approaches the limit and blocks past it (instead of only erroring
  // on submit).
  protected readonly countStatus = computed(() => nctCountStatus(this.parsed().valid.length));

  protected readonly countClass = computed(() => {
    switch (this.countStatus().severity) {
      case 'over':
        return 'text-red-700';
      case 'at-cap':
        return 'text-amber-700';
      default:
        return 'text-slate-700';
    }
  });

  protected readonly tooManyError = computed(() => this.countStatus().severity === 'over');

  protected readonly newNctCount = computed(() => {
    const dupeIds = new Set(this.duplicates().map((d) => d.nct_id));
    return this.parsed().valid.filter((id) => !dupeIds.has(id)).length;
  });

  protected readonly nctIdsToSubmit = computed(() => {
    if (this.dupeConfirmed() && this.duplicates().length > 0) {
      const dupeIds = new Set(this.duplicates().map((d) => d.nct_id));
      return this.parsed().valid.filter((id) => !dupeIds.has(id));
    }
    return this.parsed().valid;
  });

  protected readonly canSubmit = computed(() => {
    if (this.aiBlocked()) return false;
    if (this.phase() !== 'idle' && this.phase() !== 'error') return false;
    if (this.tooManyError()) return false;
    if (this.duplicates().length > 0 && !this.dupeConfirmed()) return false;
    return this.parsed().valid.length > 0;
  });

  protected readonly submitLabel = computed(() => {
    const ids = this.nctIdsToSubmit();
    if (ids.length === 0) return 'Fetch and resolve';
    return `Fetch and resolve (${ids.length} ${ids.length === 1 ? 'trial' : 'trials'})`;
  });

  protected readonly stepSequence = NCT_STEP_SEQUENCE;

  protected readonly stepIndex = computed(() => {
    const p = this.phase();
    const idx = NCT_STEP_SEQUENCE.indexOf(p as Exclude<NctPhase, 'idle' | 'error'>);
    return idx === -1 ? -1 : idx;
  });

  protected stepLabel(step: Exclude<NctPhase, 'idle' | 'error'>): string {
    if (step === 'fetching' && this.progressCount()) {
      return `Fetching trial data from ClinicalTrials.gov... ${this.progressCount()}`;
    }
    if (step === 'done' && this.doneMessage()) {
      return this.doneMessage()!;
    }
    return NCT_STEP_LABELS[step];
  }

  ngOnDestroy(): void {
    if (this.autoNavTimer !== null) {
      clearTimeout(this.autoNavTimer);
    }
  }

  protected confirmDuplicates(): void {
    this.dupeConfirmed.set(true);
  }

  protected resetDuplicates(): void {
    this.duplicates.set([]);
    this.dupeConfirmed.set(false);
  }

  protected async submit(): Promise<void> {
    const session = this.supabase.session();
    if (!session) return;

    this.errorMessage.set(null);
    this.errorCode.set(null);
    this.doneMessage.set(null);
    this.progressCount.set(null);

    const nctIds = this.nctIdsToSubmit();
    if (nctIds.length === 0) return;

    if (!this.dupeConfirmed()) {
      await this.checkDuplicates(nctIds);
      if (this.duplicates().length > 0) return;
    }

    this.phase.set('fetching');
    this.simulateProgress(nctIds.length);

    try {
      const res = await fetch(`${workerBase()}/api/source/nct-resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          space_id: this.spaceId(),
          nct_ids: nctIds,
        }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as NctErrorBody;
        this.handleError(body);
        return;
      }

      const result = (await res.json()) as SourceImportProposal;

      this.phase.set('done');
      const trialCount = result.proposals?.trials?.length ?? nctIds.length;
      const companyCount = result.proposals?.companies?.length ?? 0;
      this.doneMessage.set(
        `Done. ${trialCount} ${trialCount === 1 ? 'trial' : 'trials'} across ${companyCount} ${companyCount === 1 ? 'company' : 'companies'}.`
      );

      this.sourceImportService.setProposal(result);

      this.autoNavTimer = setTimeout(() => {
        void this.router.navigate([
          '/t',
          this.tenantId(),
          's',
          this.spaceId(),
          'import',
          result.ai_call_id,
          'review',
        ]);
      }, 1000);
    } catch {
      this.errorMessage.set('Could not reach the server. Check your connection and try again.');
      this.phase.set('error');
    }
  }

  private async checkDuplicates(nctIds: string[]): Promise<void> {
    this.phase.set('checking-dupes');

    try {
      const { data, error } = await this.supabase.client
        .from('trials')
        .select('identifier, name, acronym')
        .eq('space_id', this.spaceId())
        .in('identifier', nctIds);

      if (error || !data || data.length === 0) {
        this.phase.set('idle');
        return;
      }

      const dupes: DuplicateNct[] = data.map(
        (row: { identifier: string; name: string; acronym?: string | null }) => ({
          nct_id: row.identifier,
          trial_name:
            row.acronym ?? (row.name && row.name !== row.identifier ? row.name : row.identifier),
        })
      );

      this.duplicates.set(dupes);
      this.phase.set('idle');
    } catch {
      this.phase.set('idle');
    }
  }

  private simulateProgress(total: number): void {
    let current = 0;
    const interval = setInterval(() => {
      if (this.phase() !== 'fetching') {
        clearInterval(interval);
        return;
      }
      current = Math.min(current + Math.ceil(total * 0.15), total);
      this.progressCount.set(`${current}/${total}`);
      if (current >= total) {
        clearInterval(interval);
        this.phase.set('resolving');
      }
    }, 800);
  }

  private handleError(body: NctErrorBody): void {
    const code = body.error ?? 'unknown';
    this.errorCode.set(code);
    this.errorMessage.set(
      ERROR_MESSAGES[code] ?? body.message ?? 'Something went wrong. Try again.'
    );
    this.phase.set('error');
  }
}
