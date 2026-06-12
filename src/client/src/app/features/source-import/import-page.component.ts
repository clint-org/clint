import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { InputText } from 'primeng/inputtext';
import { Textarea } from 'primeng/textarea';
import { MessageModule } from 'primeng/message';
import { Tabs, TabList, Tab, TabPanels, TabPanel } from 'primeng/tabs';

import { SupabaseService } from '../../core/services/supabase.service';
import { SourceImportProposal, SourceImportService } from './source-import.service';
import {
  AiHealthResult,
  AiImportStatusResult,
  AiStatusLevel,
  AiStatusStrip,
  computeStatusStrip,
} from './ai-status';
import { IntelligenceBadgeComponent } from '../../shared/components/intelligence-badge/intelligence-badge.component';
import { LoaderComponent } from '../../shared/components/loader/loader.component';
import { NctInputComponent } from './nct-input/nct-input.component';

type ImportTab = 'nct' | 'url' | 'text';

type ExtractStep = 'idle' | 'fetching' | 'extracting' | 'enriching';

interface ExtractErrorBody {
  error: string;
  message?: string;
}

const EXTRACT_STEP_LABELS: Record<Exclude<ExtractStep, 'idle'>, string> = {
  fetching: 'Fetching source...',
  extracting: 'Extracting entities...',
  enriching: 'Enriching from CT.gov...',
};

const EXTRACT_STEP_SEQUENCE: Exclude<ExtractStep, 'idle'>[] = ['fetching', 'extracting', 'enriching'];
const EXTRACT_STEP_TIMINGS_MS = [1200, 3000, 6000];

function workerBase(): string {
  return (window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE ?? '';
}

function looksLikeUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

@Component({
  selector: 'app-import-page',
  imports: [
    FormsModule,
    RouterLink,
    ButtonModule,
    InputText,
    Textarea,
    MessageModule,
    Tabs,
    TabList,
    Tab,
    TabPanels,
    TabPanel,
    NctInputComponent,
    LoaderComponent,
    IntelligenceBadgeComponent,
  ],
  template: `
    <div class="mx-auto max-w-4xl px-6 py-8">
      <div class="mb-6 flex items-center justify-between">
        <div>
          <h1 class="text-xl font-semibold text-slate-900">Import</h1>
          <p class="mt-1 text-sm text-slate-500">
            Add companies, assets, and trials to this space from structured sources.
          </p>
        </div>
        <a
          [routerLink]="backRoute()"
          class="text-sm font-medium text-brand-600 hover:text-brand-700"
        >
          Back to space
        </a>
      </div>

      @if (statusStrip(); as strip) {
        <div
          [class]="'mb-4 rounded-md border px-4 py-3 text-sm ' + stripClasses(strip.level)"
          role="status"
          aria-live="polite"
        >
          {{ strip.message }}
        </div>
      }

      <p-tabs [value]="activeTab()" (valueChange)="onTabChange($event)">
        <p-tablist>
          <p-tab value="nct">NCT list</p-tab>
          <p-tab value="url">From URL</p-tab>
          <p-tab value="text">From text</p-tab>
        </p-tablist>
        <p-tabpanels>
          <p-tabpanel value="nct">
            <app-nct-input
              [aiBlocked]="aiBlocked()"
              [spaceId]="spaceId()"
              [tenantId]="tenantId()"
            />
          </p-tabpanel>

          <p-tabpanel value="url">
            <div class="flex flex-col gap-4 py-4">
              <input
                pInputText
                class="w-full"
                placeholder="https://..."
                [ngModel]="urlInput()"
                (ngModelChange)="urlInput.set($event)"
                [disabled]="extracting()"
                aria-label="Source URL"
              />

              @if (extracting()) {
                <div class="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div class="mb-2.5">
                    <app-intelligence-badge [active]="true" />
                  </div>
                  <div class="flex flex-col gap-2">
                    @for (s of extractStepSequence; track s) {
                      <div class="flex items-center gap-2.5">
                        @if (extractStepIndex() > $index) {
                          <span class="flex h-4 w-4 items-center justify-center rounded-full bg-brand-600">
                            <i class="pi pi-check text-[9px] text-white"></i>
                          </span>
                          <span class="text-xs text-slate-500">{{ extractStepLabels[s] }}</span>
                        } @else if (extractStepIndex() === $index) {
                          <app-loader [size]="16" />
                          <span class="text-xs font-medium text-slate-700">{{ extractStepLabels[s] }}</span>
                        } @else {
                          <span class="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white"></span>
                          <span class="text-xs text-slate-400">{{ extractStepLabels[s] }}</span>
                        }
                      </div>
                    }
                  </div>
                </div>
              }

              @if (extractError()) {
                <p-message severity="error" [closable]="false">{{ extractError() }}</p-message>
                @if (extractErrorCode()?.startsWith('fetch_')) {
                  <a
                    class="mt-1 block cursor-pointer text-sm text-brand-600"
                    (click)="switchUrlToText()"
                    (keydown.enter)="switchUrlToText()"
                    tabindex="0"
                    role="button"
                  >
                    Paste the text instead
                  </a>
                }
              }

              @if (duplicateInfo()) {
                <p-message severity="warn" [closable]="false">{{ duplicateInfo() }}</p-message>
                <div class="flex gap-2">
                  <p-button
                    label="Continue anyway"
                    size="small"
                    [outlined]="true"
                    (onClick)="extractFromUrl(true)"
                  />
                  <p-button
                    label="Cancel"
                    size="small"
                    [text]="true"
                    (onClick)="clearDuplicate()"
                  />
                </div>
              }

              @if (rateLimitCountdown() > 0) {
                <span class="text-sm text-slate-500">Try again in {{ rateLimitCountdown() }}s</span>
              }

              <div class="flex justify-end">
                <p-button
                  label="Extract"
                  size="small"
                  [outlined]="true"
                  [loading]="extracting()"
                  [disabled]="!canExtractUrl() || aiBlocked()"
                  (onClick)="extractFromUrl()"
                />
              </div>
            </div>
          </p-tabpanel>

          <p-tabpanel value="text">
            <div class="flex flex-col gap-4 py-4">
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

              @if (textInput().trim().length > 0 && textInput().trim().length < 50) {
                <span class="text-[11px] text-slate-400">
                  Paste at least 50 characters for the model to extract from.
                </span>
              }

              @if (extracting()) {
                <div class="rounded-lg border border-slate-200 bg-slate-50/80 px-4 py-3">
                  <div class="mb-2.5">
                    <app-intelligence-badge [active]="true" />
                  </div>
                  <div class="flex flex-col gap-2">
                    @for (s of extractStepSequence; track s) {
                      <div class="flex items-center gap-2.5">
                        @if (extractStepIndex() > $index) {
                          <span class="flex h-4 w-4 items-center justify-center rounded-full bg-brand-600">
                            <i class="pi pi-check text-[9px] text-white"></i>
                          </span>
                          <span class="text-xs text-slate-500">{{ extractStepLabels[s] }}</span>
                        } @else if (extractStepIndex() === $index) {
                          <app-loader [size]="16" />
                          <span class="text-xs font-medium text-slate-700">{{ extractStepLabels[s] }}</span>
                        } @else {
                          <span class="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white"></span>
                          <span class="text-xs text-slate-400">{{ extractStepLabels[s] }}</span>
                        }
                      </div>
                    }
                  </div>
                </div>
              }

              @if (extractError()) {
                <p-message severity="error" [closable]="false">{{ extractError() }}</p-message>
              }

              @if (rateLimitCountdown() > 0) {
                <span class="text-sm text-slate-500">Try again in {{ rateLimitCountdown() }}s</span>
              }

              <div class="flex justify-end">
                <p-button
                  label="Extract"
                  size="small"
                  [outlined]="true"
                  [loading]="extracting()"
                  [disabled]="!canExtractText() || aiBlocked()"
                  (onClick)="extractFromText()"
                />
              </div>
            </div>
          </p-tabpanel>
        </p-tabpanels>
      </p-tabs>
    </div>
  `,
  host: { class: 'block h-full overflow-y-auto bg-white' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportPageComponent implements OnInit, OnDestroy {
  private readonly supabase = inject(SupabaseService);
  private readonly sourceImportService = inject(SourceImportService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly activeTab = signal<ImportTab>('nct');
  protected readonly urlInput = signal('');
  protected readonly textInput = signal('');
  protected readonly extracting = signal(false);
  protected readonly extractError = signal<string | null>(null);
  protected readonly extractErrorCode = signal<string | null>(null);
  protected readonly extractStep = signal<ExtractStep>('idle');
  protected readonly duplicateInfo = signal<string | null>(null);
  protected readonly rateLimitCountdown = signal(0);

  protected readonly aiImportStatus = signal<AiImportStatusResult | null>(null);
  protected readonly aiHealth = signal<AiHealthResult | null>(null);
  protected readonly statusLoading = signal(true);

  protected readonly tenantId = signal('');
  protected readonly spaceId = signal('');
  private stepTimers: ReturnType<typeof setTimeout>[] = [];
  private countdownInterval: ReturnType<typeof setInterval> | null = null;

  protected readonly extractStepSequence = EXTRACT_STEP_SEQUENCE;
  protected readonly extractStepLabels = EXTRACT_STEP_LABELS;
  protected readonly extractStepIndex = computed(() =>
    EXTRACT_STEP_SEQUENCE.indexOf(this.extractStep() as Exclude<ExtractStep, 'idle'>)
  );

  protected readonly statusStrip = computed<AiStatusStrip | null>(() => {
    if (this.statusLoading()) return null;
    return computeStatusStrip(this.aiHealth(), this.aiImportStatus());
  });

  protected readonly aiBlocked = computed(() => {
    const strip = this.statusStrip();
    return strip !== null && strip.level === 'block';
  });

  protected readonly backRoute = computed(() => {
    const tid = this.tenantId();
    const sid = this.spaceId();
    if (!tid || !sid) return ['/'];
    return ['/t', tid, 's', sid];
  });

  protected readonly canExtractUrl = computed(() => {
    if (this.extracting()) return false;
    if (this.rateLimitCountdown() > 0) return false;
    if (this.duplicateInfo()) return false;
    const url = this.urlInput().trim();
    return url.length > 0 && looksLikeUrl(url);
  });

  protected readonly canExtractText = computed(() => {
    if (this.extracting()) return false;
    if (this.rateLimitCountdown() > 0) return false;
    return this.textInput().trim().length > 50;
  });

  ngOnInit(): void {
    this.extractRouteParams();
    void this.loadAiStatus();
  }

  ngOnDestroy(): void {
    this.clearStepTimers();
    this.clearCountdown();
  }

  protected onTabChange(value: unknown): void {
    if (typeof value === 'string') {
      this.activeTab.set(value as ImportTab);
    }
  }

  protected stripClasses(level: AiStatusLevel): string {
    switch (level) {
      case 'block':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'warn':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      case 'info':
        return 'bg-slate-50 border-slate-200 text-slate-600';
      case 'clear':
        return '';
    }
  }

  protected switchUrlToText(): void {
    this.activeTab.set('text');
    this.extractError.set(null);
    this.extractErrorCode.set(null);
  }

  protected clearDuplicate(): void {
    this.duplicateInfo.set(null);
  }

  protected async extractFromUrl(allowDuplicate = false): Promise<void> {
    await this.extract('url', allowDuplicate);
  }

  protected async extractFromText(): Promise<void> {
    await this.extract('text');
  }

  async refreshAiStatus(): Promise<void> {
    await this.loadAiStatus();
  }

  private extractRouteParams(): void {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent;
    }
  }

  private async loadAiStatus(): Promise<void> {
    this.statusLoading.set(true);

    const tid = this.tenantId();
    const [quotaResult, healthResult] = await Promise.allSettled([
      this.fetchQuotaStatus(tid),
      this.fetchHealthStatus(),
    ]);

    if (quotaResult.status === 'fulfilled') {
      this.aiImportStatus.set(quotaResult.value);
    }
    if (healthResult.status === 'fulfilled') {
      this.aiHealth.set(healthResult.value);
    }

    this.statusLoading.set(false);
  }

  private async fetchQuotaStatus(tenantId: string): Promise<AiImportStatusResult | null> {
    const { data, error } = await this.supabase.client.rpc('ai_import_status', {
      p_tenant_id: tenantId,
    });
    if (error || !data) return null;
    return data as AiImportStatusResult;
  }

  private async fetchHealthStatus(): Promise<AiHealthResult | null> {
    try {
      const res = await fetch(`${workerBase()}/api/ai/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return null;
      return (await res.json()) as AiHealthResult;
    } catch {
      return null;
    }
  }

  private async extract(mode: 'url' | 'text', allowDuplicate = false): Promise<void> {
    const session = this.supabase.session();
    if (!session) return;

    this.extractError.set(null);
    this.extractErrorCode.set(null);
    this.duplicateInfo.set(null);
    this.extracting.set(true);
    this.startStepCycle();

    const payload: Record<string, unknown> = {
      space_id: this.spaceId(),
      source_kind: mode,
    };
    if (mode === 'url') {
      payload['source_url'] = this.urlInput().trim();
    } else {
      payload['source_text'] = this.textInput();
    }
    if (allowDuplicate) {
      payload['allow_duplicate'] = true;
    }

    try {
      const res = await fetch(`${workerBase()}/api/source/extract`, {
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
      await this.router.navigate([
        '/t',
        this.tenantId(),
        's',
        this.spaceId(),
        'import',
        result.ai_call_id,
        'review',
      ]);
    } catch {
      this.extractError.set('Could not reach the server. Check your connection and try again.');
    } finally {
      this.extracting.set(false);
      this.extractStep.set('idle');
      this.clearStepTimers();
    }
  }

  private handleExtractError(body: ExtractErrorBody, status: number): void {
    const code = body.error ?? 'unknown';
    this.extractErrorCode.set(code);

    if (code === 'duplicate_source') {
      this.duplicateInfo.set(body.message ?? 'This source was already imported. Continue anyway?');
      return;
    }

    if (code === 'rate_limited' || code === 'rate_limited_minute' || code === 'rate_limited_hour') {
      this.extractError.set(body.message ?? 'Too many imports in a short window. Try again shortly.');
      this.startRateLimitCountdown(60);
      return;
    }

    if (code === 'preflight_rejected') {
      this.extractError.set(
        body.message ?? 'Daily AI usage limit reached. Try again tomorrow or contact your admin.'
      );
      void this.refreshAiStatus();
      return;
    }

    this.extractError.set(
      body.message ??
        (status >= 500
          ? 'Something went wrong on our end. Try again.'
          : 'Request failed. Check your input and try again.')
    );
  }

  private startStepCycle(): void {
    this.clearStepTimers();
    this.extractStep.set(EXTRACT_STEP_SEQUENCE[0]);
    for (let i = 1; i < EXTRACT_STEP_SEQUENCE.length; i++) {
      const timer = setTimeout(
        () => this.extractStep.set(EXTRACT_STEP_SEQUENCE[i]),
        EXTRACT_STEP_TIMINGS_MS[i - 1]
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
}
