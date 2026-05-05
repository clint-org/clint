import { Injectable } from '@angular/core';
import { schema as basicSchema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';
import { Schema, MarkType, NodeType } from 'prosemirror-model';
import { EditorState, Command } from 'prosemirror-state';
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
import {
  splitListItem,
  liftListItem,
  sinkListItem,
  wrapInList,
} from 'prosemirror-schema-list';
import { inputRules, wrappingInputRule } from 'prosemirror-inputrules';

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

  get schema(): Schema {
    return this.editorSchema;
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

    const markdownInputRules = inputRules({
      rules: [
        // "- " or "* " or "+ " at line start -> bullet list
        wrappingInputRule(/^\s*([-+*])\s$/, bulletList),
        // "1. " at line start -> ordered list
        wrappingInputRule(
          /^(\d+)\.\s$/,
          orderedList,
          (match) => ({ order: Number(match[1]) }),
          (match, node) => node.childCount + node.attrs['order'] === Number(match[1])
        ),
      ],
    });

    const state = EditorState.create({
      doc: doc!,
      schema: this.editorSchema,
      plugins: [history(), customKeys, markdownInputRules, keymap(baseKeymap)],
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

  // -- Toolbar command builders ------------------------------------------------
  // Components dispatch these against an EditorView. Each returns whether the
  // command applied so toolbars can disable buttons that wouldn't take effect.

  toggleStrong(view: EditorView): boolean {
    return this.runMarkToggle(view, this.editorSchema.marks['strong']);
  }

  toggleEm(view: EditorView): boolean {
    return this.runMarkToggle(view, this.editorSchema.marks['em']);
  }

  toggleBulletList(view: EditorView): boolean {
    return this.runListToggle(view, this.editorSchema.nodes['bullet_list']);
  }

  toggleOrderedList(view: EditorView): boolean {
    return this.runListToggle(view, this.editorSchema.nodes['ordered_list']);
  }

  isMarkActive(view: EditorView, markName: 'strong' | 'em'): boolean {
    const mark = this.editorSchema.marks[markName];
    if (!mark) return false;
    const { from, $from, to, empty } = view.state.selection;
    if (empty) return !!mark.isInSet(view.state.storedMarks || $from.marks());
    return view.state.doc.rangeHasMark(from, to, mark);
  }

  isListActive(view: EditorView, listName: 'bullet_list' | 'ordered_list'): boolean {
    const node = this.editorSchema.nodes[listName];
    if (!node) return false;
    const { $from } = view.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type === node) return true;
    }
    return false;
  }

  private runMarkToggle(view: EditorView, mark: MarkType | undefined): boolean {
    if (!mark) return false;
    return this.exec(view, toggleMark(mark));
  }

  private runListToggle(view: EditorView, listType: NodeType | undefined): boolean {
    if (!listType) return false;
    const listItem = this.editorSchema.nodes['list_item'];
    if (this.isListActive(view, listType.name as 'bullet_list' | 'ordered_list')) {
      return this.exec(view, liftListItem(listItem));
    }
    return this.exec(view, wrapInList(listType));
  }

  private exec(view: EditorView, command: Command): boolean {
    const applied = command(view.state, view.dispatch, view);
    if (applied) view.focus();
    return applied;
  }
}
