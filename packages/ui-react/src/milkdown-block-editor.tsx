import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createEditorAdapter,
  type VellymEditorAdapter,
  type EditorStateSnapshot
} from "./editor-adapter.js";
import { errorMessage } from "./error-message.js";

export function MilkdownBlockEditor(props: {
  value: string;
  label: string;
  onChange(value: string): void;
  onReady(adapter?: VellymEditorAdapter): void;
  onFocus(adapter: VellymEditorAdapter): void;
  onStateChange(
    adapter: VellymEditorAdapter,
    state: EditorStateSnapshot
  ): void;
}) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  callbacks.current = props;

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let adapter: VellymEditorAdapter | undefined;

    void createEditorAdapter(root, {
      value: callbacks.current.value,
      onChange: (value) => callbacks.current.onChange(value),
      onFocus: () => {
        if (adapter) callbacks.current.onFocus(adapter);
      },
      onStateChange: (state) => {
        if (adapter) callbacks.current.onStateChange(adapter, state);
      }
    })
      .then((created) => {
        if (disposed) {
          void created.destroy();
          return;
        }
        adapter = created;
        const editorElement = root.querySelector<HTMLElement>(
          '[contenteditable="true"]'
        );
        editorElement?.setAttribute("aria-label", callbacks.current.label);
        editorElement?.setAttribute("aria-multiline", "true");
        setReady(true);
        callbacks.current.onReady(created);
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setError(errorMessage(reason, t));
        }
      });

    return () => {
      disposed = true;
      callbacks.current.onReady(undefined);
      if (adapter) void adapter.destroy();
    };
  }, []);

  return (
    <section className="block-editor" aria-label={props.label}>
      {error ? (
        <p className="editor-load-error" role="alert">
          エディタを読み込めませんでした: {error}
        </p>
      ) : (
        <>
          {!ready && (
            <p className="editor-loading" role="status">
              エディタを準備しています…
            </p>
          )}
          <div ref={rootRef} />
        </>
      )}
    </section>
  );
}
