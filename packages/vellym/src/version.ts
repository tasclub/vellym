declare const __VELLYM_VERSION__: string;

export const VELLYM_VERSION = __VELLYM_VERSION__;

/** Official plugins by `vellym.id`, collected from packages/plugin-* at build time. */
declare const __VELLYM_OFFICIAL_PLUGINS__: Record<string, { name: string; version: string }>;
export const OFFICIAL_PLUGINS = __VELLYM_OFFICIAL_PLUGINS__;
