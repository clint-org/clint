import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { DrawerModule } from 'primeng/drawer';
import { MessageService } from 'primeng/api';

import {
  IntelligenceDetailBundle,
  IntelligenceEntityType,
  PrimaryIntelligenceLink,
  UpsertIntelligenceInput,
} from '../../../core/models/primary-intelligence.model';
import { PrimaryIntelligenceService } from '../../../core/services/primary-intelligence.service';
import { ProseMirrorEditorComponent } from '../prose-mirror-editor/prose-mirror-editor.component';
import { LinkedEntitiesPickerComponent } from '../linked-entities-picker/linked-entities-picker.component';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/**
 * Authoring drawer for primary intelligence. Same drawer regardless of
 * entity level: callers pre-set the primary anchor via inputs. Loads any
 * existing draft (or seeds from published content), auto-saves drafts on
 * field blur, and supports an explicit publish action with a change-note.
 */
@Component({
  selector: 'app-intelligence-drawer',
  standalone: true,
  imports: [
    FormsModule,
    ButtonModule,
    InputTextModule,
    DrawerModule,
    ProseMirrorEditorComponent,
    LinkedEntitiesPickerComponent,
  ],
  template: `
    <p-drawer
      [visible]="open()"
      (visibleChange)="onVisibleChange($event)"
      position="right"
      styleClass="!w-full md:!w-[640px]"
      [modal]="true"
      [dismissible]="false"
      [closeOnEscape]="true"
      header="Primary intelligence"
      (onHide)="closed.emit()"
    >
      @if (loading()) {
        <p class="px-2 py-4 text-sm text-slate-500">Loading...</p>
      } @else {
        <div class="space-y-5 px-1">
          <div>
            <label
              for="pi-headline"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Headline
            </label>
            <input
              id="pi-headline"
              pInputText
              type="text"
              [ngModel]="headline()"
              (ngModelChange)="headline.set($event); markDirty()"
              (blur)="autoSave()"
              placeholder="One-line read"
              class="!w-full"
            />
          </div>

          <div>
            <span
              id="pi-thesis-label"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Thesis
            </span>
            <app-prose-mirror-editor
              [value]="thesis()"
              ariaLabel="Thesis"
              (valueChange)="thesis.set($event); scheduleAutoSave()"
            />
          </div>

          <div>
            <span
              id="pi-watch-label"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              What to watch
            </span>
            <app-prose-mirror-editor
              [value]="watch()"
              ariaLabel="What to watch"
              (valueChange)="watch.set($event); scheduleAutoSave()"
            />
          </div>

          <div>
            <span
              id="pi-implications-label"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Implications
            </span>
            <app-prose-mirror-editor
              [value]="implications()"
              ariaLabel="Implications"
              (valueChange)="implications.set($event); scheduleAutoSave()"
            />
          </div>

          <div>
            <span
              id="pi-links-label"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Linked entities
            </span>
            <app-linked-entities-picker
              [spaceId]="spaceId()"
              [value]="links()"
              (valueChange)="links.set($event); markDirty(); autoSave()"
            />
          </div>

          <div>
            <label
              for="pi-change-note"
              class="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500"
            >
              Change note (optional)
            </label>
            <input
              id="pi-change-note"
              pInputText
              type="text"
              [ngModel]="changeNote()"
              (ngModelChange)="changeNote.set($event)"
              placeholder="What changed and why"
              class="!w-full"
            />
          </div>

          <div class="flex items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <span
              class="font-mono text-[10px] uppercase tracking-wider text-slate-400"
              aria-live="polite"
            >
              {{ saveStateLabel() }}
            </span>
            <div class="flex items-center gap-2">
              <p-button label="Cancel" severity="secondary" [text]="true" (onClick)="cancel()" />
              <p-button
                label="Save draft"
                icon="fa-solid fa-save"
                [outlined]="true"
                size="small"
                (onClick)="saveDraft()"
              />
              <p-button
                label="Publish"
                icon="fa-solid fa-paper-plane"
                size="small"
                [disabled]="!canPublish()"
                (onClick)="publish()"
              />
            </div>
          </div>
        </div>
      }
    </p-drawer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IntelligenceDrawerComponent implements OnDestroy {
  private intelligence = inject(PrimaryIntelligenceService);
  private messageService = inject(MessageService);

  readonly visible = input<boolean>(false);
  readonly spaceId = input.required<string>();
  readonly entityType = input.required<IntelligenceEntityType>();
  readonly entityId = input.required<string>();

  readonly closed = output<void>();
  readonly published = output<void>();

  protected readonly open = signal<boolean>(false);
  protected readonly loading = signal<boolean>(false);
  protected readonly currentId = signal<string | null>(null);

  protected readonly headline = signal<string>('');
  protected readonly thesis = signal<string>('');
  protected readonly watch = signal<string>('');
  protected readonly implications = signal<string>('');
  protected readonly links = signal<PrimaryIntelligenceLink[]>([]);
  protected readonly changeNote = signal<string>('');

  protected readonly saveState = signal<SaveState>('idle');
  protected readonly dirty = signal<boolean>(false);

  protected readonly canPublish = computed(() => this.headline().trim().length > 0);

  protected readonly saveStateLabel = computed<string>(() => {
    switch (this.saveState()) {
      case 'saving':
        return 'Saving...';
      case 'saved':
        return 'Saved';
      case 'error':
        return 'Save failed';
      default:
        return this.dirty() ? 'Unsaved changes' : '';
    }
  });

  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly visibleEffect = effect(() => {
    const next = this.visible();
    this.open.set(next);
    if (next) {
      void this.load();
    }
  });

  ngOnDestroy(): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
  }

  protected markDirty(): void {
    this.dirty.set(true);
  }

  protected scheduleAutoSave(): void {
    this.markDirty();
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    this.autoSaveTimer = setTimeout(() => {
      void this.persist('draft', false);
    }, 1500);
  }

  protected autoSave(): void {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    void this.persist('draft', false);
  }

  protected async saveDraft(): Promise<void> {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    await this.persist('draft', true);
  }

  protected async publish(): Promise<void> {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);
    await this.persist('published', true);
    if (this.saveState() !== 'error') {
      this.published.emit();
      this.open.set(false);
      this.closed.emit();
    }
  }

  protected cancel(): void {
    this.open.set(false);
    this.closed.emit();
  }

  protected onVisibleChange(next: boolean): void {
    this.open.set(next);
    if (!next) {
      this.closed.emit();
    }
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.dirty.set(false);
    this.saveState.set('idle');
    try {
      const bundle = await this.fetchBundle();
      this.applyBundle(bundle);
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Could not load intelligence',
        life: 4000,
      });
    } finally {
      this.loading.set(false);
    }
  }

  private async fetchBundle(): Promise<IntelligenceDetailBundle | null> {
    switch (this.entityType()) {
      case 'trial':
        return this.intelligence.getTrialDetail(this.entityId());
      case 'marker':
        return this.intelligence.getMarkerDetail(this.entityId());
      case 'company':
        return this.intelligence.getCompanyDetail(this.entityId());
      case 'product':
        return this.intelligence.getAssetDetail(this.entityId());
      case 'space':
        return this.intelligence.getSpaceIntelligence(this.entityId());
      default:
        return null;
    }
  }

  private applyBundle(bundle: IntelligenceDetailBundle | null): void {
    const draft = bundle?.draft ?? null;
    const pub = bundle?.published ?? null;
    const source = draft ?? pub;

    if (source) {
      // Only adopt a draft id as the upsert target; a published id stays
      // null so Save Draft / Publish fork into a new versioned row instead
      // of overwriting the live read in place.
      this.currentId.set(draft?.record.id ?? null);
      this.headline.set(source.record.headline ?? '');
      this.thesis.set(source.record.thesis_md ?? '');
      this.watch.set(source.record.watch_md ?? '');
      this.implications.set(source.record.implications_md ?? '');
      this.links.set([...(source.links ?? [])]);
    } else {
      this.currentId.set(null);
      this.headline.set('');
      this.thesis.set('');
      this.watch.set('');
      this.implications.set('');
      this.links.set([]);
    }
    this.changeNote.set('');
  }

  /**
   * @param notify When true (explicit Save draft / Publish), shows a success
   * toast on the happy path. Auto-save callers pass false to keep the UX
   * silent -- only the inline "Saved" status label updates.
   */
  private async persist(state: 'draft' | 'published', notify: boolean): Promise<void> {
    if (this.loading()) return;
    if (state === 'draft' && !this.dirty() && !!this.currentId()) return;
    if (!this.headline().trim()) return;

    this.saveState.set('saving');
    const input: UpsertIntelligenceInput = {
      id: this.currentId(),
      space_id: this.spaceId(),
      entity_type: this.entityType(),
      entity_id: this.entityId(),
      headline: this.headline().trim(),
      thesis_md: this.thesis(),
      watch_md: this.watch(),
      implications_md: this.implications(),
      state,
      change_note: this.changeNote().trim() ? this.changeNote().trim() : null,
      links: this.links(),
    };

    try {
      const id = await this.intelligence.upsert(input);
      this.currentId.set(id);
      this.saveState.set('saved');
      this.dirty.set(false);
      if (notify) {
        this.messageService.add({
          severity: 'success',
          summary: state === 'published' ? 'Published' : 'Draft saved',
          life: 2500,
        });
      }
    } catch (error) {
      this.saveState.set('error');
      this.messageService.add({
        severity: 'error',
        summary: 'Save failed',
        detail: error instanceof Error ? error.message : 'Unknown error',
        life: 5000,
      });
    }
  }
}
