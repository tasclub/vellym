/**
 * Vellymプラグインの公開契約。
 *
 * このパッケージは**Coreへ依存しない**。Core側がこの契約をimportして実装する。
 * 逆向きにすると内部実装が公開契約に変わってしまう。
 *
 * 実行時コードはほとんど持たない。型、定数、manifestのJSON Schema、
 * localeの解決だけである。ここに実装が入ると、host側の実体とプラグインが
 * 同梱した実体の二重化が起きる。
 */
export * from "./diagnostics.js";
export * from "./host.js";
export * from "./manifest.js";
export * from "./records.js";
export * from "./text.js";
export * from "./views.js";
