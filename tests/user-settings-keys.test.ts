import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_SCOPE,
  HOST_OWNER,
  normalizedProjectRoot,
  userSettingsKey
} from "../packages/ui-react/src/shared/user-settings.js";
import {
  storedTreeOpen,
  storedTreeWidth
} from "../packages/ui-react/src/shell/workspace-shell.js";

const WIDTH_KEY = "vellym.user-settings.v2:_device:_host:navigation.width";
const OPEN_KEY = "vellym.user-settings.v2:_device:_host:navigation.open";

function stubStorage(values: Map<string, string>) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); }
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("user settings keys", () => {
  it("builds the device-scoped host keys under the v2 rule", () => {
    expect(userSettingsKey(DEVICE_SCOPE, HOST_OWNER, "navigation.width")).toBe(WIDTH_KEY);
    expect(userSettingsKey(DEVICE_SCOPE, HOST_OWNER, "navigation.open")).toBe(OPEN_KEY);
    expect(userSettingsKey(
      normalizedProjectRoot("/workspace/project"),
      HOST_OWNER,
      "navigation.expanded"
    )).toBe("vellym.user-settings.v2:%2Fworkspace%2Fproject:_host:navigation.expanded");
  });

  it("encodes every component so a colon cannot fake a separator", () => {
    expect(userSettingsKey("/a:b", "_host", "x:y", "res:1")).toBe(
      "vellym.user-settings.v2:%2Fa%3Ab:_host:x%3Ay:res%3A1"
    );
  });

  it("omits the resource name only when it is not given", () => {
    expect(userSettingsKey("_device", "_host", "navigation.width").split(":")).toHaveLength(4);
    expect(userSettingsKey("_device", "_host", "navigation.width", "resource").split(":")).toHaveLength(5);
  });
});

describe("host navigation settings migration", () => {
  it("moves the old tree width into the device-scoped key and deletes it", () => {
    const values = new Map<string, string>([["vellym.navigation.width", "320"]]);
    stubStorage(values);

    expect(storedTreeWidth()).toBe(320);
    expect(values.get(WIDTH_KEY)).toBe("320");
    expect(values.has("vellym.navigation.width")).toBe(false);
  });

  it("prefers the new width when both keys exist and still clears the old one", () => {
    const values = new Map<string, string>([
      ["vellym.navigation.width", "320"],
      [WIDTH_KEY, "240"]
    ]);
    stubStorage(values);

    expect(storedTreeWidth()).toBe(240);
    expect(values.has("vellym.navigation.width")).toBe(false);
  });

  it("moves the old tree open flag into the device-scoped key and deletes it", () => {
    const values = new Map<string, string>([["vellym.navigation.open", "false"]]);
    stubStorage(values);

    expect(storedTreeOpen()).toBe(false);
    expect(values.get(OPEN_KEY)).toBe("false");
    expect(values.has("vellym.navigation.open")).toBe(false);
  });

  it("keeps defaults when localStorage is unavailable", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => { throw new Error("storage disabled"); },
        setItem: () => { throw new Error("storage disabled"); },
        removeItem: () => { throw new Error("storage disabled"); }
      }
    });

    expect(storedTreeWidth()).toBe(268);
    expect(storedTreeOpen()).toBe(true);
  });
});
