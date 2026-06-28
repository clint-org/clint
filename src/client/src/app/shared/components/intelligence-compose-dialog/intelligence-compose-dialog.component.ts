import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { SelectModule } from 'primeng/select';

import { IntelligenceEntityType } from '../../../core/models/primary-intelligence.model';
import { SupabaseService } from '../../../core/services/supabase.service';
import {
  buildComposeEntityOptions,
  buildComposeTarget,
  ComposeEntityRow,
  ComposeTarget,
} from './compose-entity-options';

export type { ComposeTarget };

interface EntityOption {
  label: string;
  sub_label: string;
  value: string;
}

const LEVEL_OPTIONS: { label: string; value: IntelligenceEntityType }[] = [
  { label: 'Trial', value: 'trial' },
  { label: 'Company', value: 'company' },
  { label: 'Asset', value: 'product' },
  { label: 'Space', value: 'space' },
];

/**
 * Entity picker that fronts the primary-intelligence author drawer when
 * composing from the Intelligence feed (which is not entity-scoped). The
 * author picks a level (trial / company / asset / engagement) and, for the
 * entity-scoped levels, the specific entity to attach the intelligence to. On
 * confirm it emits the chosen anchor; the feed opens the shared
 * IntelligenceDrawerComponent against it. No author form is duplicated here.
 *
 * Engagement is a per-space singleton, so it has no entity select: its
 * anchor id is the space id.
 */
@Component({
  selector: 'app-intelligence-compose-dialog',
  standalone: true,
  imports: [FormsModule, ButtonModule, Dialog, SelectModule],
  template: `
    <p-dialog
      [visible]="open()"
      (visibleChange)="onVisibleChange($event)"
      header="Publish intelligence"
      [modal]="true"
      styleClass="!w-[32rem]"
      [closable]="true"
    >
      <div class="space-y-4">
        <p class="text-sm text-slate-700">
          The feed spans the whole space, so choose what this intelligence is about before authoring
          it.
        </p>
        <div>
          <label
            for="pi-compose-level"
            class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
          >
            Level
          </label>
          <p-select
            inputId="pi-compose-level"
            [options]="levelOptions"
            [ngModel]="level()"
            (ngModelChange)="onLevelChange($event)"
            optionLabel="label"
            optionValue="value"
            styleClass="w-full"
            appendTo="body"
          />
        </div>

        @if (level() !== 'space') {
          <div>
            <label
              for="pi-compose-entity"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              {{ entityLabel() }}
            </label>
            <p-select
              inputId="pi-compose-entity"
              [options]="entityOptions()"
              [ngModel]="entityId()"
              (ngModelChange)="entityId.set($event)"
              optionLabel="label"
              optionValue="value"
              [filter]="true"
              filterBy="label,sub_label"
              [placeholder]="loading() ? 'Loading...' : entityPlaceholder()"
              [emptyMessage]="emptyMessage()"
              styleClass="w-full"
              appendTo="body"
            >
              <ng-template let-option pTemplate="item">
                <div class="flex min-w-0 flex-col">
                  <span class="truncate text-sm text-slate-800">{{ option.label }}</span>
                  @if (option.sub_label) {
                    <span class="truncate font-mono text-[10px] text-slate-400">
                      {{ option.sub_label }}
                    </span>
                  }
                </div>
              </ng-template>
            </p-select>
          </div>
        }
      </div>

      <ng-template #footer>
        <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="onCancel()" />
        <p-button
          label="Write intelligence"
          icon="fa-solid fa-pen-nib"
          size="small"
          [disabled]="!canContinue()"
          (onClick)="onContinue()"
        />
      </ng-template>
    </p-dialog>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceComposeDialogComponent {
  private readonly supabase = inject(SupabaseService);

  readonly visible = input<boolean>(false);
  readonly spaceId = input.required<string>();

  readonly cancelled = output<void>();
  readonly chosen = output<ComposeTarget>();

  protected readonly levelOptions = LEVEL_OPTIONS;

  protected readonly open = signal<boolean>(false);
  protected readonly level = signal<IntelligenceEntityType>('trial');
  protected readonly entityId = signal<string | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly rows = signal<ComposeEntityRow[]>([]);

  protected readonly entityOptions = computed<EntityOption[]>(() => {
    const lvl = this.level();
    if (lvl === 'space') return [];
    return this.rows()
      .filter((r) => r.entity_type === lvl)
      .map((r) => ({ label: r.label, sub_label: r.sub_label, value: r.entity_id }));
  });

  protected readonly entityLabel = computed<string>(() => {
    switch (this.level()) {
      case 'company':
        return 'Company';
      case 'product':
        return 'Asset';
      default:
        return 'Trial';
    }
  });

  protected readonly entityPlaceholder = computed<string>(
    () => `Select a ${this.entityLabel().toLowerCase()}`
  );

  protected readonly emptyMessage = computed<string>(
    () => `No ${this.entityLabel().toLowerCase()} records in this space yet.`
  );

  protected readonly canContinue = computed<boolean>(() => {
    if (this.level() === 'space') return true;
    return !!this.entityId();
  });

  private readonly visibleEffect = effect(() => {
    const next = this.visible();
    this.open.set(next);
    if (next) {
      this.level.set('trial');
      this.entityId.set(null);
      void this.loadOptions();
    }
  });

  protected onLevelChange(next: IntelligenceEntityType): void {
    this.level.set(next);
    this.entityId.set(null);
  }

  protected onVisibleChange(next: boolean): void {
    this.open.set(next);
    if (!next) this.cancelled.emit();
  }

  protected onCancel(): void {
    this.open.set(false);
    this.cancelled.emit();
  }

  protected onContinue(): void {
    if (!this.canContinue()) return;
    const lvl = this.level();
    const id = lvl === 'space' ? this.spaceId() : this.entityId();
    if (!id) return;
    this.open.set(false);
    // anchorId is always null from the compose path: the drawer opens in
    // new-brief mode and creates a fresh anchor for the chosen entity.
    this.chosen.emit(buildComposeTarget(lvl, id));
  }

  private async loadOptions(): Promise<void> {
    if (this.rows().length > 0) return;
    this.loading.set(true);
    try {
      const sid = this.spaceId();
      const client = this.supabase.client;
      const [trials, companies, assets] = await Promise.all([
        client.from('trials').select('id, name, identifier').eq('space_id', sid).order('name'),
        client.from('companies').select('id, name').eq('space_id', sid).order('name'),
        client.from('assets').select('id, name, companies(name)').eq('space_id', sid).order('name'),
      ]);
      this.rows.set(
        buildComposeEntityOptions({
          trials: trials.data ?? [],
          companies: companies.data ?? [],
          assets: assets.data ?? [],
        })
      );
    } finally {
      this.loading.set(false);
    }
  }
}
