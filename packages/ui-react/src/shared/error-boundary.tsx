import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * 1つの区画で起きた例外を、その区画だけで止める。
 *
 * **Grafanaのpanelと同じ考え方である。** プラグインの画面が壊れることは
 * 許容する。許容しないのは、それによって文書ツリーも全文検索も本文の編集も
 * 触れなくなることである（[[plugin-installation-requirement]]）。
 *
 * プロセス分離もiframeも使わない。要件は「プラグインが原因でSPA全体が
 * 表示不能にならない」であり、描画のエラー境界で足りる。
 */
export class ErrorBoundary extends Component<
  {
    /** 例外を受け止めたときに描くもの。原因を受け取って表示を組み立てる */
    fallback(error: Error): ReactNode;
    /**
     * 境界の識別。**変わると状態を捨てて描き直す。**
     * 別の画面へ移ったときに、前の画面の失敗を持ち越さないためにある。
     */
    resetKey?: string;
    children: ReactNode;
  },
  { error?: Error; resetKey?: string }
> {
  state: { error?: Error; resetKey?: string } = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate() {
    if (this.state.error && this.state.resetKey !== this.props.resetKey) {
      this.setState({ error: undefined, resetKey: this.props.resetKey });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 原因を握り潰さない。利用者へは`fallback`で示し、詳細は開発者向けに残す。
    console.error("[vellym] プラグインの画面で例外が発生しました", error, info);
    this.setState({ resetKey: this.props.resetKey });
  }

  render() {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}
