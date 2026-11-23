import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createEditorAdapter,
  type VellymEditorAdapter,
  type EditorStateSnapshot
} from "./editor-adapter.js";
import { errorMessage } from "../shared/error-message.js";
import { isStaticApp, uploadImage } from "../shared/api.js";

export function MilkdownBlockEditor(props: {
  value: string;
  label: string;
  onChange(value: string): void;
  onReady(adapter?: VellymEditorAdapter, upload?: (files: File[]) => void): void;
  onUploadStatus(uploading: number, error: string): void;
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
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const adapterRef = useRef<VellymEditorAdapter | undefined>(undefined);
  const uploadRef = useRef<(files: File[], position?: number) => void>(() => {});
  const controllers = useRef(new Set<AbortController>());
  uploadRef.current = (files, position) => {
    const adapter = adapterRef.current;
    if (!adapter || isStaticApp()) return;
    setUploadError("");
    for (const file of files) {
      const target = adapter.imageTarget(position);
      const controller = new AbortController();
      controllers.current.add(controller);
      setUploading((count) => count + 1);
      void uploadImage(file, controller.signal).then(({ data }) => {
        if (!controller.signal.aborted) target.insert(data.url, file.name);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) setUploadError(errorMessage(reason, t));
      }).finally(() => {
        target.cancel();
        controllers.current.delete(controller);
        if (!controller.signal.aborted) setUploading((count) => count - 1);
      });
    }
  };
  callbacks.current = props;

  useEffect(() => {
    callbacks.current.onUploadStatus(uploading, uploadError);
  }, [uploading, uploadError]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    let adapter: VellymEditorAdapter | undefined;

    void createEditorAdapter(root, {
      value: callbacks.current.value,
      onFiles: isStaticApp() ? undefined : (files, position) => uploadRef.current(files, position),
      imageAltLabel: t("editor.imageAlt"),
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
        adapterRef.current = created;
        const editorElement = root.querySelector<HTMLElement>(
          '[contenteditable="true"]'
        );
        editorElement?.setAttribute("aria-label", callbacks.current.label);
        editorElement?.setAttribute("aria-multiline", "true");
        setReady(true);
        callbacks.current.onReady(created, (files) => uploadRef.current(files));
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setError(errorMessage(reason, t));
        }
      });

    return () => {
      disposed = true;
      adapterRef.current = undefined;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
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
