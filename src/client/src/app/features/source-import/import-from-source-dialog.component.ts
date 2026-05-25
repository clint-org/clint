import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  OnDestroy,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Dialog } from 'primeng/dialog';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { ProgressSpinner } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';

import { SupabaseService } from '../../core/services/supabase.service';
import {
  SourceImportProposal,
  SourceImportService,
} from './source-import.service';

type Mode = 'url' | 'text';
type Step = 'idle' | 'fetching' | 'extracting' | 'enriching';

interface ExtractErrorBody {
  error: string;
  message?: string;
}

const WORKER_BASE =
  ((window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE) ?? '';

const STEP_LABELS: Record<Exclude<Step, 'idle'>, string> = {
  fetching: 'Fetching source...',
  extracting: 'Extracting entities...',
  enriching: 'Enriching from CT.gov...',
};

const STEP_SEQUENCE: Exclude<Step, 'idle'>[] = [
  'fetching',
  'extracting',
  'enriching',
];
const STEP_TIMINGS_MS = [1200, 3000, 6000];

@Component({
  selector: 'app-import-from-source-dialog',
  imports: [
    FormsModule,
    Dialog,
    ButtonModule,
    InputText,
    Textarea,
    ProgressSpinner,
    MessageModule,
  ],
  template: `
    <p-dialog
      header="Import from source"
      [(visible)]="visible"
      [modal]="true"
      [dismissableMask]="true"
      styleClass="!w-[35rem]"
      (onHide)="onHide()"
    >
      <div class="flex flex-col gap-4">
        <!-- Mode toggle -->
        <div class="flex gap-2">
          <p-button
            label="URL"
            size="small"
            [outlined]="mode() !== 'url'"
            [text]="mode() !== 'url'"
            (onClick)="mode.set('url')"
          />
          <p-button
            label="Paste text"
            size="small"
            [outlined]="mode() !== 'text'"
            [text]="mode() !== 'text'"
            (onClick)="mode.set('text')"
          />
        </div>

        <!-- URL input -->
        @if (mode() === 'url') {
          <input
            pInputText
            class="w-full"
            placeholder="https://..."
            [ngModel]="urlInput()"
            (ngModelChange)="urlInput.set($event)"
            [disabled]="extracting()"
            aria-label="Source URL"
          />
        }

        <!-- Text input -->
        @if (mode() === 'text') {
          <textarea
            pTextarea
            class="w-full"
            rows="10"
            placeholder="Paste press release or source text..."
            [ngModel]="textInput()"
            (ngModelChange)="textInput.set($event)"
            [disabled]="extracting()"
            aria-label="Source text"
          ></textarea>
        }

        <!-- Progress steps -->
        @if (extracting()) {
          <div class="flex items-center gap-2">
            <p-progressspinner
              strokeWidth="4"
              styleClass="w-[1.25rem] h-[1.25rem]"
              aria-label="Extracting"
            />
            <span class="text-sm text-slate-600">{{ stepLabel() }}</span>
          </div>
        }

        <!-- Error -->
        @if (error()) {
          <p-message severity="error" [closable]="false">{{ error() }}</p-message>
          @if (errorCode()?.startsWith('fetch_')) {
            <a
              class="mt-1 block cursor-pointer text-sm text-brand-600"
              (click)="switchToPaste()"
              (keydown.enter)="switchToPaste()"
              tabindex="0"
              role="button"
            >
              Paste the text instead
            </a>
          }
        }

        <!-- Duplicate source prompt -->
        @if (duplicateInfo()) {
          <p-message severity="warn" [closable]="false">
            {{ duplicateInfo() }}
          </p-message>
          <div class="flex gap-2">
            <p-button
              label="Continue anyway"
              size="small"
              [outlined]="true"
              (onClick)="extract(true)"
            />
            <p-button
              label="Cancel"
              size="small"
              [text]="true"
              (onClick)="clearDuplicate()"
            />
          </div>
        }

        <!-- Rate limit countdown -->
        @if (rateLimitCountdown() > 0) {
          <span class="text-sm text-slate-500">
            Try again in {{ rateLimitCountdown() }}s
          </span>
        }
      </div>

      <ng-template #footer>
        <p-button
          label="Cancel"
          severity="secondary"
          [text]="true"
          size="small"
          (onClick)="visible.set(false)"
        />
        <p-button
          label="Extract"
          size="small"
          [outlined]="true"
          [loading]="extracting()"
          [disabled]="!canExtract()"
          (onClick)="extract()"
        />
      </ng-template>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportFromSourceDialogComponent implements OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly sourceImportService = inject(SourceImportService);
  private readonly router = inject(Router);

  readonly visible = model(false);
  readonly spaceId = input.required<string>();
  readonly tenantId = input.required<string>();

  readonly mode = signal<Mode>('url');
  readonly urlInput = signal('');
  readonly textInput = signal('');
  readonly extracting = signal(false);
  readonly error = signal<string | null>(null);
  readonly errorCode = signal<string | null>(null);
  readonly step = signal<Step>('idle');
  readonly duplicateInfo = signal<string | null>(null);
  readonly rateLimitCountdown = signal(0);

  private stepTimers: ReturnType<typeof setTimeout>[] = [];
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  protected readonly stepLabel = computed(
    () => STEP_LABELS[this.step() as Exclude<Step, 'idle'>] ?? ''
  );

  protected readonly canExtract = computed(() => {
    if (this.extracting()) return false;
    if (this.rateLimitCountdown() > 0) return false;
    if (this.duplicateInfo()) return false;
    if (this.mode() === 'url') {
      const url = this.urlInput().trim();
      return url.length > 0 && looksLikeUrl(url);
    }
    return this.textInput().trim().length > 50;
  });

  ngOnDestroy(): void {
    this.clearStepTimers();
    this.clearCountdown();
  }

  protected onHide(): void {
    this.resetState();
  }

  protected switchToPaste(): void {
    this.mode.set('text');
    this.error.set(null);
    this.errorCode.set(null);
  }

  protected clearDuplicate(): void {
    this.duplicateInfo.set(null);
  }

  protected async extract(allowDuplicate = false): Promise<void> {
    const session = this.supabase.session();
    if (!session) return;

    this.error.set(null);
    this.errorCode.set(null);
    this.duplicateInfo.set(null);
    this.extracting.set(true);
    this.startStepCycle();

    const payload: Record<string, unknown> = {
      space_id: this.spaceId(),
      source_kind: this.mode(),
    };
    if (this.mode() === 'url') {
      payload['source_url'] = this.urlInput().trim();
    } else {
      payload['source_text'] = this.textInput();
    }
    if (allowDuplicate) {
      payload['allow_duplicate'] = true;
    }

    try {
      const res = await fetch(`${WORKER_BASE}/api/source/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ExtractErrorBody;
        this.handleExtractError(body, res.status);
        return;
      }

      const result = (await res.json()) as SourceImportProposal;
      this.sourceImportService.setProposal(result);
      this.visible.set(false);
      await this.router.navigate([
        '/t', this.tenantId(),
        's', this.spaceId(),
        'import', result.ai_call_id, 'review',
      ]);
    } catch {
      this.error.set(
        'Could not reach the server. Check your connection and try again.'
      );
    } finally {
      this.extracting.set(false);
      this.step.set('idle');
      this.clearStepTimers();
    }
  }

  private handleExtractError(body: ExtractErrorBody, status: number): void {
    const code = body.error ?? 'unknown';
    this.errorCode.set(code);

    if (code === 'duplicate_source') {
      this.duplicateInfo.set(
        body.message ?? 'This source was already imported. Continue anyway?'
      );
      return;
    }

    if (code === 'rate_limited' || code === 'rate_limited_minute' || code === 'rate_limited_hour') {
      this.error.set(body.message ?? 'Too many imports in a short window. Try again shortly.');
      this.startRateLimitCountdown(60);
      return;
    }

    this.error.set(
      body.message ??
        (status >= 500
          ? 'Something went wrong on our end. Try again.'
          : 'Request failed. Check your input and try again.')
    );
  }

  private startStepCycle(): void {
    this.clearStepTimers();
    this.step.set(STEP_SEQUENCE[0]);
    for (let i = 1; i < STEP_SEQUENCE.length; i++) {
      const timer = setTimeout(
        () => this.step.set(STEP_SEQUENCE[i]),
        STEP_TIMINGS_MS[i - 1]
      );
      this.stepTimers.push(timer);
    }
  }

  private startRateLimitCountdown(seconds: number): void {
    this.clearCountdown();
    this.rateLimitCountdown.set(seconds);
    this.countdownInterval = setInterval(() => {
      const remaining = this.rateLimitCountdown() - 1;
      this.rateLimitCountdown.set(remaining);
      if (remaining <= 0) {
        this.clearCountdown();
      }
    }, 1000);
  }

  private clearStepTimers(): void {
    for (const t of this.stepTimers) clearTimeout(t);
    this.stepTimers = [];
  }

  private clearCountdown(): void {
    if (this.countdownInterval !== null) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
  }

  private resetState(): void {
    this.extracting.set(false);
    this.error.set(null);
    this.errorCode.set(null);
    this.step.set('idle');
    this.duplicateInfo.set(null);
    this.clearStepTimers();
    this.clearCountdown();
    this.rateLimitCountdown.set(0);
  }
}

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
