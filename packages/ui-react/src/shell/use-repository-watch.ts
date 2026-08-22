import { useEffect, useRef, useState } from "react";

import { parseRepositoryEvent, type WatchConnection } from "../editor/save-state.js";

export interface RepositoryWatchOptions {
  /** 監視できる状態か。devサーバに繋がっていない静的版では`false`になる */
  live: boolean;
  /** リポジトリの変更を受け取ったとき。**毎回の描画で最新のものが呼ばれる** */
  onChange(): void;
  /** 設定ファイルが変わったとき。`onChange`より先に呼ぶ */
  onConfigChange(): void;
  /** 切れていた接続が戻ったときに出す文言 */
  reconnectedMessage: string;
}

export interface RepositoryWatch {
  connection: WatchConnection;
  /** 接続が戻ったことの一時的な知らせ。5秒で消える */
  message: string;
  /** 外部の変更を検知したが、未保存のため読み直していない状態 */
  externalChange: boolean;
  setExternalChange(value: boolean): void;
}

/**
 * 正本ファイルの外部変更を監視する。
 *
 * `onChange`をrefで持つのは、`EventSource`を張り直さずに最新の処理を呼ぶため
 * である。この購読は接続の生き死にだけで張り替えたい。編集中の状態が変わる
 * たびに張り直すと、そのつど再接続が起きる。
 */
export function useRepositoryWatch(options: RepositoryWatchOptions): RepositoryWatch {
  const [connection, setConnection] = useState<WatchConnection>({ state: "connecting" });
  const [message, setMessage] = useState("");
  const [externalChange, setExternalChange] = useState(false);

  const handlers = useRef(options);
  handlers.current = options;

  useEffect(() => {
    if (!options.live) return;
    const events = new EventSource("/api/v1/events");
    events.onopen = () => {
      const now = Date.now();
      setConnection((current) => {
        if (current.state === "disconnected" || current.state === "error") {
          setMessage(handlers.current.reconnectedMessage);
        }
        return { state: "connected", lastConfirmedAt: now };
      });
    };
    events.onmessage = (event) => {
      const repositoryEvent = parseRepositoryEvent(event.data);
      if (!repositoryEvent) return;
      const now = Date.now();
      setConnection({
        state: repositoryEvent.watcher === "error" ? "error" : "connected",
        lastConfirmedAt: now
      });
      if (
        repositoryEvent.kind === "repository-change" ||
        repositoryEvent.kind === "setup-complete" ||
        repositoryEvent.kind === "config-change"
      ) {
        if (repositoryEvent.kind === "config-change") handlers.current.onConfigChange();
        handlers.current.onChange();
      }
    };
    events.onerror = () => {
      setConnection((current) => ({
        state: "disconnected",
        lastConfirmedAt: current.lastConfirmedAt
      }));
      setMessage("");
    };
    return () => events.close();
  }, [options.live]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  return { connection, message, externalChange, setExternalChange };
}
