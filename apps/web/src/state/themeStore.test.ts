import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #38: viewport theme store — defaults, toggling, and localStorage
 * persistence. The store reads localStorage at creation and writes on every
 * change; node tests stub a minimal localStorage and reset the module
 * registry to observe both behaviors.
 */

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function stubStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => void backing.set(key, value),
  };
  (globalThis as unknown as { window: { localStorage: StorageLike } }).window =
    { localStorage: storage };
  return backing;
}

async function importStore() {
  const mod = await import("./themeStore");
  return mod;
}

describe("themeStore (issue #38)", () => {
  let backing: Map<string, string> | null = null;

  beforeEach(() => {
    vi.resetModules();
    backing = stubStorage();
  });

  afterEach(() => {
    vi.resetModules();
    delete (globalThis as unknown as { window?: unknown }).window;
    backing = null;
  });

  it("defaults to the Dark OLED theme and persists toggles to localStorage", async () => {
    const { useThemeStore, VIEWPORT_THEME_STORAGE_KEY } = await importStore();
    expect(useThemeStore.getState().theme).toBe("dark");

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
    expect(backing!.get(VIEWPORT_THEME_STORAGE_KEY)).toBe("light");

    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("dark");
    expect(backing!.get(VIEWPORT_THEME_STORAGE_KEY)).toBe("dark");

    useThemeStore.getState().setTheme("light");
    expect(useThemeStore.getState().theme).toBe("light");
    expect(backing!.get(VIEWPORT_THEME_STORAGE_KEY)).toBe("light");
  });

  it("hydrates the persisted theme at store creation", async () => {
    backing!.set("fvf.viewport-theme", "light");
    const { useThemeStore } = await importStore();
    expect(useThemeStore.getState().theme).toBe("light");
  });

  it("falls back to dark for unknown stored values", async () => {
    backing!.set("fvf.viewport-theme", "sepia");
    const { useThemeStore } = await importStore();
    expect(useThemeStore.getState().theme).toBe("dark");
  });

  it("defaults to dark when localStorage is unavailable", async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    const { useThemeStore } = await importStore();
    expect(useThemeStore.getState().theme).toBe("dark");
    // Toggle still works without persistence
    useThemeStore.getState().toggleTheme();
    expect(useThemeStore.getState().theme).toBe("light");
  });
});
