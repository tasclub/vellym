export type EditorCommand =
  | "strong"
  | "emphasis"
  | "strikethrough"
  | "inline-code"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "blockquote"
  | "bullet-list"
  | "ordered-list"
  | "code-block"
  | "link"
  | "table"
  | "table-row-add"
  | "table-row-remove"
  | "table-col-add"
  | "table-col-remove"
  | "table-remove"
  | "hr";

export interface EditorStateSnapshot {
  canUndo: boolean;
  canRedo: boolean;
  activeCommands: EditorCommand[];
}

export interface LinkContext {
  /** 選択がリンク上にあるときの既存href。無ければ""。 */
  href: string;
  /** 選択が現在リンクmarkを持つか。 */
  active: boolean;
}

export interface VellymEditorAdapter {
  getValue(): string;
  focus(): void;
  run(command: EditorCommand): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): boolean;
  redo(): boolean;
  state(): EditorStateSnapshot;
  // リンク編集はwindow.promptではなくアプリ内ダイアログで行うため、
  // アダプタがリンクの読取・適用・解除を公開する。
  linkContext(): LinkContext;
  setLink(href: string): boolean;
  unsetLink(): boolean;
  /**
   * 内部Pageリンク`[[...]]`はCommonMarkのlinkではなく素のテキストなので、
   * link markではなくテキストとして挿入する。
   */
  insertText(text: string): boolean;
  destroy(): Promise<void>;
}

export async function createEditorAdapter(
  root: HTMLElement,
  options: {
    value: string;
    onChange(value: string): void;
    onFocus(): void;
    onStateChange(state: EditorStateSnapshot): void;
  }
): Promise<VellymEditorAdapter> {
  const [
    { Editor, defaultValueCtx, editorStateCtx, editorViewCtx, rootCtx },
    preset,
    gfm,
    { listener, listenerCtx },
    historyPlugin,
    proseHistory,
    proseCommands,
    proseTables
  ] = await Promise.all([
    import("@milkdown/core"),
    import("@milkdown/preset-commonmark"),
    import("@milkdown/preset-gfm"),
    import("@milkdown/plugin-listener"),
    import("@milkdown/plugin-history"),
    import("@milkdown/prose/history"),
    import("@milkdown/prose/commands"),
    import("@milkdown/prose/tables")
  ]);

  let currentValue = options.value;
  let editorState: EditorStateSnapshot = {
    canUndo: false,
    canRedo: false,
    activeCommands: []
  };
  let editor:
    | Awaited<ReturnType<ReturnType<typeof Editor.make>["create"]>>
    | undefined;

  const readState = (): EditorStateSnapshot => {
    if (!editor) return editorState;
    const state = editor.action((ctx) => ctx.get(editorStateCtx));
    const { $from, $to, empty } = state.selection;
    const marks = state.storedMarks ?? $from.marks();
    const markActive = (name: string) => {
      const mark = state.schema.marks[name];
      if (!mark) return false;
      return empty
        ? Boolean(mark.isInSet(marks))
        : state.doc.rangeHasMark($from.pos, $to.pos, mark);
    };
    const ancestorActive = (name: string) => {
      for (let depth = $from.depth; depth >= 0; depth -= 1) {
        if ($from.node(depth).type.name === name) return true;
      }
      return false;
    };
    const activeCommands: EditorCommand[] = [];
    if (markActive("strong")) activeCommands.push("strong");
    if (markActive("emphasis")) activeCommands.push("emphasis");
    if (markActive("strike_through")) activeCommands.push("strikethrough");
    if (markActive("inlineCode")) activeCommands.push("inline-code");
    if (markActive("link")) activeCommands.push("link");
    if ($from.parent.type.name === "heading" && $from.parent.attrs.level === 2) {
      activeCommands.push("heading-2");
    }
    if ($from.parent.type.name === "heading" && $from.parent.attrs.level === 3) {
      activeCommands.push("heading-3");
    }
    if ($from.parent.type.name === "heading" && $from.parent.attrs.level === 4) {
      activeCommands.push("heading-4");
    }
    if (ancestorActive("blockquote")) activeCommands.push("blockquote");
    if (ancestorActive("bullet_list")) activeCommands.push("bullet-list");
    if (ancestorActive("ordered_list")) activeCommands.push("ordered-list");
    if ($from.parent.type.name === "code_block") activeCommands.push("code-block");
    if (ancestorActive("table")) activeCommands.push("table");
    return {
      canUndo: proseHistory.undoDepth(state) > 0,
      canRedo: proseHistory.redoDepth(state) > 0,
      activeCommands
    };
  };
  const notifyState = () => {
    editorState = readState();
    options.onStateChange(editorState);
  };

  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, options.value);
      ctx.get(listenerCtx)
        .markdownUpdated((_ctx, markdown) => {
          if (markdown === currentValue) return;
          currentValue = markdown;
          options.onChange(markdown);
        })
        .focus(() => {
          options.onFocus();
          notifyState();
        })
        .updated(() => notifyState())
        .selectionUpdated(() => notifyState());
    })
    .use(preset.commonmark)
    .use(gfm.gfm)
    .use(historyPlugin.history)
    .use(listener)
    .create();
  // Milkdownの空行保持を無効化する。これは末尾以外の空段落（新規セルや空行）を
  // すべてリテラルの`<br />`として直列化してしまうため、外すことで通常のMarkdown
  // 段落間隔を保ち、本来のハードブレーク（hardbreakノード）だけを残す。
  await editor.remove(preset.remarkPreserveEmptyLinePlugin);
  notifyState();
  const readyEditor = editor;

  // ブロック種別ボタンはトグル動作。既に同じ書式なら同じボタンで解除する
  // （見出し・コードブロック→段落、リスト・引用→lift）。一方向の適用にしない。
  const isActive = (command: EditorCommand) =>
    readState().activeCommands.includes(command);
  const liftSelection = (): boolean => {
    const view = readyEditor.action((ctx) => ctx.get(editorViewCtx));
    return proseCommands.lift(view.state, view.dispatch);
  };
  // prosemirror-tablesのコマンドを実行中のviewへ適用し、カーソル位置のセルに
  // 変更が反映されるようエディタのフォーカスを保つ。
  const runTable = (command: typeof proseTables.addRowAfter): boolean => {
    const view = readyEditor.action((ctx) => ctx.get(editorViewCtx));
    const changed = command(view.state, view.dispatch);
    view.focus();
    return changed;
  };
  const commands: Record<EditorCommand, () => boolean> = {
    strong: () => preset.toggleStrongCommand.run(),
    emphasis: () => preset.toggleEmphasisCommand.run(),
    strikethrough: () => gfm.toggleStrikethroughCommand.run(),
    "inline-code": () => preset.toggleInlineCodeCommand.run(),
    "heading-2": () =>
      isActive("heading-2")
        ? preset.turnIntoTextCommand.run()
        : preset.wrapInHeadingCommand.run(2),
    "heading-3": () =>
      isActive("heading-3")
        ? preset.turnIntoTextCommand.run()
        : preset.wrapInHeadingCommand.run(3),
    "heading-4": () =>
      isActive("heading-4")
        ? preset.turnIntoTextCommand.run()
        : preset.wrapInHeadingCommand.run(4),
    blockquote: () =>
      isActive("blockquote")
        ? liftSelection()
        : preset.wrapInBlockquoteCommand.run(),
    "bullet-list": () =>
      isActive("bullet-list")
        ? preset.liftListItemCommand.run()
        : preset.wrapInBulletListCommand.run(),
    "ordered-list": () =>
      isActive("ordered-list")
        ? preset.liftListItemCommand.run()
        : preset.wrapInOrderedListCommand.run(),
    "code-block": () =>
      isActive("code-block")
        ? preset.turnIntoTextCommand.run()
        : preset.createCodeBlockCommand.run(),
    // リンクボタンはeditor workspace側がダイアログを開いてsetLink/unsetLinkを呼ぶ。
    // ここで直接実行しても誤って文書を壊さないようno-opにする。
    link: () => false,
    table: () => gfm.insertTableCommand.run(),
    // gfmのスキーマ対応add系を使う。素のprosemirror-tablesはmilkdownが`<br>`へ
    // 直列化するセルを挿入するため、行・列追加はgfm経由で行う。
    "table-row-add": () => gfm.addRowAfterCommand.run(),
    "table-row-remove": () => runTable(proseTables.deleteRow),
    "table-col-add": () => gfm.addColAfterCommand.run(),
    "table-col-remove": () => runTable(proseTables.deleteColumn),
    "table-remove": () => runTable(proseTables.deleteTable),
    hr: () => preset.insertHrCommand.run()
  };

  const currentLinkHref = (): string => {
    const state = readyEditor.action((ctx) => ctx.get(editorStateCtx));
    const linkType = state.schema.marks.link;
    if (!linkType) return "";
    const { $from, empty } = state.selection;
    const marks = empty ? state.storedMarks ?? $from.marks() : $from.marks();
    const mark = marks.find((item) => item.type === linkType);
    return typeof mark?.attrs.href === "string" ? mark.attrs.href : "";
  };

  return {
    getValue: () => currentValue,
    focus: () => {
      readyEditor.action((ctx) => ctx.get(editorViewCtx).focus());
    },
    run: (command) => commands[command](),
    linkContext: () => ({
      href: currentLinkHref(),
      active: readState().activeCommands.includes("link")
    }),
    setLink: (href) => {
      const active = readState().activeCommands.includes("link");
      const changed = active
        ? preset.updateLinkCommand.run({ href })
        : preset.toggleLinkCommand.run({ href });
      notifyState();
      return changed;
    },
    unsetLink: () => {
      if (!readState().activeCommands.includes("link")) return false;
      const changed = preset.toggleLinkCommand.run();
      notifyState();
      return changed;
    },
    insertText: (text) => {
      const view = readyEditor.action((ctx) => ctx.get(editorViewCtx));
      const { from, to } = view.state.selection;
      view.dispatch(view.state.tr.insertText(text, from, to));
      view.focus();
      notifyState();
      return true;
    },
    canUndo: () => editorState.canUndo,
    canRedo: () => editorState.canRedo,
    undo: () => {
      const changed = historyPlugin.undoCommand.run();
      notifyState();
      return changed;
    },
    redo: () => {
      const changed = historyPlugin.redoCommand.run();
      notifyState();
      return changed;
    },
    state: () => editorState,
    destroy: async () => {
      await readyEditor.destroy();
    }
  };
}
