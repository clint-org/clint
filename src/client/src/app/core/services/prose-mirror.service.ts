import { Injectable } from '@angular/core';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import {
  defaultMarkdownParser,
  defaultMarkdownSerializer,
  MarkdownParser,
  MarkdownSerializer,
} from 'prosemirror-markdown';
import { splitListItem, liftListItem, sinkListItem } from 'prosemirror-schema-list';

/**
 * Centralised editor configuration so the ProseMirror surface is the only
 * place in the app that touches its primitives. Components consume
 * `createEditor` / `destroyEditor` and otherwise stay framework-pure.
 */
@Injectable({ providedIn: 'root' })
export class ProseMirrorService {
  private readonly editorSchema: Schema;
  private readonly parser: MarkdownParser;
  private readonly serializer: MarkdownSerializer;

  constructor() {
    // basic schema + lists is sufficient for thesis / watch / implications.
    const nodes = addListNodes(basicSchema.spec.nodes, 'paragraph block*', 'block');
    this.editorSchema = new Schema({
      nodes,
      marks: basicSchema.spec.marks,
    });
    this.parser = new MarkdownParser(
      this.editorSchema,
      defaultMarkdownParser.tokenizer,
      defaultMarkdownParser.tokens
    );
    this.serializer = new MarkdownSerializer(
      defaultMarkdownSerializer.nodes,
      defaultMarkdownSerializer.marks
    );
  }

  createEditor(
    target: HTMLElement,
    initialMarkdown: string,
    onChange: (md: string) => void
  ): EditorView {
    const doc = this.parser.parse(initialMarkdown ?? '') ?? this.editorSchema.topNodeType.createAndFill();

    const listItem = this.editorSchema.nodes['list_item'];
    const bulletList = this.editorSchema.nodes['bullet_list'];
    const orderedList = this.editorSchema.nodes['ordered_list'];
    const strong = this.editorSchema.marks['strong'];
    const em = this.editorSchema.marks['em'];

    const customKeys = keymap({
      'Mod-b': toggleMark(strong),
      'Mod-B': toggleMark(strong),
      'Mod-i': toggleMark(em),
      'Mod-I': toggleMark(em),
      'Mod-z': undo,
      'Mod-Z': undo,
      'Mod-y': redo,
      'Mod-Y': redo,
      'Mod-Shift-z': redo,
      Enter: splitListItem(listItem),
      Tab: sinkListItem(listItem),
      'Shift-Tab': liftListItem(listItem),
    });

    void bulletList;
    void orderedList;

    const state = EditorState.create({
      doc: doc!,
      schema: this.editorSchema,
      plugins: [history(), customKeys, keymap(baseKeymap)],
    });

    const view = new EditorView(target, {
      state,
      attributes: {
        class: 'pm-editor',
        role: 'textbox',
        'aria-multiline': 'true',
      },
      dispatchTransaction: (tr) => {
        const next = view.state.apply(tr);
        view.updateState(next);
        if (tr.docChanged) {
          const md = this.serializer.serialize(next.doc);
          onChange(md);
        }
      },
    });

    return view;
  }

  destroyEditor(view: EditorView): void {
    view.destroy();
  }

  /** Re-set the editor doc from a markdown string without re-creating it. */
  setContent(view: EditorView, markdown: string): void {
    const doc = this.parser.parse(markdown ?? '');
    const state = EditorState.create({
      doc: doc ?? this.editorSchema.topNodeType.createAndFill()!,
      schema: this.editorSchema,
      plugins: view.state.plugins,
    });
    view.updateState(state);
  }
}
