/**
 * Personal settings live in the browser's localStorage under one key shape
 * (ARCHITECTURE.md, "Personal settings"). This is the only place that builds
 * those keys; plugin views and the host both call it instead of writing
 * key strings by hand.
 */

const KEY_PREFIX = "vellym.user-settings.v2";

/** Scope for values that do not name or depend on project content. */
export const DEVICE_SCOPE = "_device";

/** Owner for host-owned settings. Plugin IDs cannot collide with it. */
export const HOST_OWNER = "_host";

/**
 * Absolute project root from bootstrap, normalized so the same directory
 * yields the same scope regardless of separators or a trailing slash.
 */
export function normalizedProjectRoot(projectRoot: string): string {
  const normalized = projectRoot.replaceAll("\\", "/").replace(/\/+$/, "");
  return normalized || "/";
}

/**
 * Build `vellym.user-settings.v2:<scope>:<owner>:<setting>[:<resourceName>]`.
 * Pass the absolute `projectRoot` through `normalizedProjectRoot` as `scope`
 * when the value depends on project content, or `DEVICE_SCOPE` when it does
 * not. Each component is encoded, so a `:` inside one cannot be mistaken for
 * a separator.
 */
export function userSettingsKey(
  scope: string,
  owner: string,
  setting: string,
  resourceName?: string
): string {
  const parts = resourceName === undefined
    ? [scope, owner, setting]
    : [scope, owner, setting, resourceName];
  return `${KEY_PREFIX}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}
