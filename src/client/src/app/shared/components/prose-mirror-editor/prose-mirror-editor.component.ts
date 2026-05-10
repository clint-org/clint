import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import type { EditorView } from 'prosemirror-view';
import { Tooltip } from 'primeng/tooltip';

import { ProseMirrorService } from '../../../core/services/prose-mirror.service';

/**
 * Thin Angular wrapper around a ProseMirror EditorView. The host component
 * owns the markdown signal; this wrapper renders it on init and emits
 * change events on every keystroke. External writes flow back via the
 * `value` input -- when it changes from a non-typing source we re-seed the
 * doc, which is rare (publish, hard reset).
 */
@Component({
  selector: 'app-prose-mirror-editor',
  standalone: true,
  imports: [Tooltip],
  template: `
    <div
      class="rounded-sm border border-slate-200 bg-white focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-600/40"
    >
      <div
        role="toolbar"
        [attr.aria-label]="(ariaLabel() || 'Editor') + ' formatting'"
        class="flex items-center gap-0.5 border-b border-slate-100 px-1.5 py-1 text-slate-600"
      >
        <button
          type="button"
          class="pm-tb-btn"
          [class.pm-tb-active]="active().strong"
          (mousedown)="$event.preventDefault()"
          (click)="cmd('strong')"
          aria-label="Bold (Cmd/Ctrl-B)"
          pTooltip="Bold"
          tooltipPosition="bottom"
        >
          <span class="font-semibold">B</span>
        </button>
        <button
          type="button"
          class="pm-tb-btn"
          [class.pm-tb-active]="active().em"
          (mousedown)="$event.preventDefault()"
          (click)="cmd('em')"
          aria-label="Italic (Cmd/Ctrl-I)"
          pTooltip="Italic"
          tooltipPosition="bottom"
        >
          <span class="italic">I</span>
        </button>
        <span class="mx-1 h-4 w-px bg-slate-200" aria-hidden="true"></span>
        <button
          type="button"
          class="pm-tb-btn"
          [class.pm-tb-active]="active().bullet"
          (mousedown)="$event.preventDefault()"
          (click)="cmd('bullet')"
          aria-label="Bullet list"
          pTooltip="Bullet list"
          tooltipPosition="bottom"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="2.5" cy="4" r="1.2" fill="currentColor" />
            <circle cx="2.5" cy="8" r="1.2" fill="currentColor" />
            <circle cx="2.5" cy="12" r="1.2" fill="currentColor" />
            <rect x="6" y="3.4" width="8" height="1.2" fill="currentColor" />
            <rect x="6" y="7.4" width="8" height="1.2" fill="currentColor" />
            <rect x="6" y="11.4" width="8" height="1.2" fill="currentColor" />
          </svg>
        </button>
        <button
          type="button"
          class="pm-tb-btn"
          [class.pm-tb-active]="active().ordered"
          (mousedown)="$event.preventDefault()"
          (click)="cmd('ordered')"
          aria-label="Numbered list"
          pTooltip="Numbered list"
          tooltipPosition="bottom"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <text
              x="0.5"
              y="5.5"
              font-size="4.5"
              font-family="ui-monospace, monospace"
              fill="currentColor"
            >
              1.
            </text>
            <text
              x="0.5"
              y="10"
              font-size="4.5"
              font-family="ui-monospace, monospace"
              fill="currentColor"
            >
              2.
            </text>
            <text
              x="0.5"
              y="14.5"
              font-size="4.5"
              font-family="ui-monospace, monospace"
              fill="currentColor"
            >
              3.
            </text>
            <rect x="6" y="3.4" width="8" height="1.2" fill="currentColor" />
            <rect x="6" y="7.4" width="8" height="1.2" fill="currentColor" />
            <rect x="6" y="11.4" width="8" height="1.2" fill="currentColor" />
          </svg>
        </button>
      </div>
      <div
        #host
        class="pm-host min-h-[120px] px-3 py-2 text-sm leading-relaxed text-slate-800"
        [attr.aria-label]="ariaLabel() || null"
      ></div>
    </div>
  `,
  styles: [
    `
      :host ::ng-deep .pm-editor {
        outline: none;
        min-height: 100px;
      }
      :host ::ng-deep .pm-editor p {
        margin: 0 0 0.6em;
      }
      :host ::ng-deep .pm-editor ul,
      :host ::ng-deep .pm-editor ol {
        margin: 0 0 0.6em 1.25em;
      }
      :host ::ng-deep .pm-editor li {
        margin: 0.15em 0;
      }
      :host ::ng-deep .pm-editor strong {
        font-weight: 600;
      }
      :host ::ng-deep .pm-editor a {
        color: var(--brand-700, #0f766e);
        text-decoration: underline;
      }
      .pm-tb-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 24px;
        min-width: 24px;
        padding: 0 6px;
        border-radius: 2px;
        font-size: 12px;
        line-height: 1;
        color: rgb(71 85 105);
        cursor: pointer;
      }
      .pm-tb-btn:hover {
        background: rgb(241 245 249);
        color: rgb(15 23 42);
      }
      .pm-tb-active {
        background: rgb(226 232 240);
        color: rgb(15 23 42);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProseMirrorEditorComponent implements AfterViewInit, OnDestroy {
  readonly hostRef = viewChild.required<ElementRef<HTMLDivElement>>('host');

  private readonly proseMirror = inject(ProseMirrorService);
  private editorView: EditorView | null = null;
  private suppressNextSync = false;

  readonly value = input<string>('');
  readonly ariaLabel = input<string>('');
  readonly valueChange = output<string>();

  readonly active = signal({ strong: false, em: false, bullet: false, ordered: false });

  // When the value input is rewritten externally (e.g. opening a draft),
  // resync the editor doc. Skip the sync that follows our own emissions.
  private readonly syncEffect = effect(() => {
    const next = this.value();
    if (!this.editorView) return;
    if (this.suppressNextSync) {
      this.suppressNextSync = false;
      return;
    }
    this.proseMirror.setContent(this.editorView, next);
    this.refreshActive();
  });

  ngAfterViewInit(): void {
    const host = this.hostRef().nativeElement;
    this.editorView = this.proseMirror.createEditor(host, this.value() ?? '', (md) => {
      this.suppressNextSync = true;
      this.valueChange.emit(md);
      this.refreshActive();
    });
    host.addEventListener('keyup', this.refreshActive);
    host.addEventListener('mouseup', this.refreshActive);
    this.refreshActive();
  }

  ngOnDestroy(): void {
    if (this.editorView) {
      const host = this.hostRef().nativeElement;
      host.removeEventListener('keyup', this.refreshActive);
      host.removeEventListener('mouseup', this.refreshActive);
      this.proseMirror.destroyEditor(this.editorView);
      this.editorView = null;
    }
  }

  cmd(kind: 'strong' | 'em' | 'bullet' | 'ordered'): void {
    if (!this.editorView) return;
    if (kind === 'strong') this.proseMirror.toggleStrong(this.editorView);
    else if (kind === 'em') this.proseMirror.toggleEm(this.editorView);
    else if (kind === 'bullet') this.proseMirror.toggleBulletList(this.editorView);
    else if (kind === 'ordered') this.proseMirror.toggleOrderedList(this.editorView);
    this.refreshActive();
  }

  private readonly refreshActive = (): void => {
    if (!this.editorView) return;
    this.active.set({
      strong: this.proseMirror.isMarkActive(this.editorView, 'strong'),
      em: this.proseMirror.isMarkActive(this.editorView, 'em'),
      bullet: this.proseMirror.isListActive(this.editorView, 'bullet_list'),
      ordered: this.proseMirror.isListActive(this.editorView, 'ordered_list'),
    });
  };
}
