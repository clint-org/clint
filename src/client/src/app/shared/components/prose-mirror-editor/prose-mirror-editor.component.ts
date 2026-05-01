import {
  AfterViewInit,
  Component,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  ViewChild,
  effect,
} from '@angular/core';
import type { EditorView } from 'prosemirror-view';

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
  template: `
    <div
      #host
      class="pm-host min-h-[120px] rounded-sm border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed text-slate-800 focus-within:border-brand-600 focus-within:ring-1 focus-within:ring-brand-600/40"
      [attr.aria-label]="ariaLabel() || null"
    ></div>
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
    `,
  ],
})
export class ProseMirrorEditorComponent implements AfterViewInit, OnDestroy {
  @ViewChild('host', { static: true }) hostRef!: ElementRef<HTMLDivElement>;

  private readonly proseMirror = inject(ProseMirrorService);
  private editorView: EditorView | null = null;
  private suppressNextSync = false;

  readonly value = input<string>('');
  readonly ariaLabel = input<string>('');
  readonly valueChange = output<string>();

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
  });

  ngAfterViewInit(): void {
    this.editorView = this.proseMirror.createEditor(
      this.hostRef.nativeElement,
      this.value() ?? '',
      (md) => {
        this.suppressNextSync = true;
        this.valueChange.emit(md);
      }
    );
  }

  ngOnDestroy(): void {
    if (this.editorView) {
      this.proseMirror.destroyEditor(this.editorView);
      this.editorView = null;
    }
  }
}
