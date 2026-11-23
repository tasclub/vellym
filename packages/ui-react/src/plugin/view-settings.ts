import {
  normalizedProjectRoot,
  userSettingsKey
} from "../shared/user-settings.js";

/** Scope shared by declarative and custom plugin views for local-only preferences. */
export interface PluginViewSettingsScope {
  /** Absolute project root from bootstrap; independent of the dev-server origin/port. */
  projectRoot: string;
  pluginId: string;
  viewId: string;
  /** Resource hosting the view, e.g. a particular TicketTracker. */
  targetName: string;
}

/**
 * Personal preferences stay in localStorage, scoped by project, plugin, view and
 * resource. v2 intentionally does not read the old project-agnostic key.
 */
export function pluginViewSettingsKey(scope: PluginViewSettingsScope): string {
  return userSettingsKey(
    normalizedProjectRoot(scope.projectRoot),
    scope.pluginId,
    scope.viewId,
    scope.targetName
  );
}

export function readPluginViewSettings<T>(scope: PluginViewSettingsScope): T | undefined {
  try {
    if (typeof window === "undefined") return undefined;
    const raw = window.localStorage.getItem(pluginViewSettingsKey(scope));
    return raw === null ? undefined : JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function writePluginViewSettings(
  scope: PluginViewSettingsScope,
  value: unknown
): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(pluginViewSettingsKey(scope), JSON.stringify(value));
  } catch {
    // Personal settings are optional; a storage failure must not block the view.
  }
}
