import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #40: user-configurable palette store — overrides, per-key clearing,
 * full reset, validation, and localStorage persistence. Node tests stub a
 * minimal localStorage and reset the module registry per case.
 */

type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function stubStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => void backing.set(key, value),
    removeItem: (key) => void backing.delete(key),
  };
  (globalThis as unknown as { window: { localStorage: StorageLike } }).window =
    { localStorage: storage };
  return backing;
}

async function importStore() {
  return import("./paletteStore");
}

describe("paletteStore (issue #40)", () => {
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

  it("starts with no overrides and persists accepted custom colors", async () => {
    const { usePaletteStore, CHANNEL_PALETTE_STORAGE_KEY } =
      await importStore();
    expect(usePaletteStore.getState().customColors).toEqual({});

    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setCustomColor("C2", "#ABC");
    // Overrides are stored in canonical lowercase hex
    expect(usePaletteStore.getState().customColors).toEqual({
      A: "#123456",
      C2: "#abc",
    });
    expect(JSON.parse(backing!.get(CHANNEL_PALETTE_STORAGE_KEY)!)).toEqual({
      A: "#123456",
      C2: "#abc",
    });
  });

  it("rejects invalid colors without touching state or storage", async () => {
    const { usePaletteStore, CHANNEL_PALETTE_STORAGE_KEY } =
      await importStore();
    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setCustomColor("B", "red");
    usePaletteStore.getState().setCustomColor("B", "#12345");
    usePaletteStore.getState().setCustomColor("B", undefined as never);
    expect(usePaletteStore.getState().customColors).toEqual({ A: "#123456" });
    expect(JSON.parse(backing!.get(CHANNEL_PALETTE_STORAGE_KEY)!)).toEqual({
      A: "#123456",
    });
  });

  it("clearCustomColor removes a single override", async () => {
    const { usePaletteStore } = await importStore();
    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setCustomColor("B", "#654321");
    usePaletteStore.getState().clearCustomColor("A");
    expect(usePaletteStore.getState().customColors).toEqual({ B: "#654321" });
    usePaletteStore.getState().clearCustomColor("A"); // no-op
    expect(usePaletteStore.getState().customColors).toEqual({ B: "#654321" });
  });

  it("resetPalette removes every override and clears the storage entry", async () => {
    const { usePaletteStore, CHANNEL_PALETTE_STORAGE_KEY } =
      await importStore();
    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setCustomColor("C1", "#00FFAA");
    usePaletteStore.getState().resetPalette();
    expect(usePaletteStore.getState().customColors).toEqual({});
    expect(backing!.get(CHANNEL_PALETTE_STORAGE_KEY)).toBeUndefined();
  });

  it("hydrates persisted overrides at store creation and drops invalid entries", async () => {
    backing!.set(
      "fvf.channel-palette",
      JSON.stringify({ A: "#111111", ZZZ: "#222222", C1: "nope", D: "#333" }),
    );
    const { usePaletteStore } = await importStore();
    expect(usePaletteStore.getState().customColors).toEqual({
      A: "#111111",
      D: "#333",
    });
  });

  it("falls back to no overrides for malformed stored payloads", async () => {
    backing!.set("fvf.channel-palette", "{not json");
    const { usePaletteStore } = await importStore();
    expect(usePaletteStore.getState().customColors).toEqual({});
  });

  it("works without localStorage available", async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    const { usePaletteStore } = await importStore();
    expect(usePaletteStore.getState().customColors).toEqual({});
    usePaletteStore.getState().setCustomColor("A", "#123456");
    expect(usePaletteStore.getState().customColors).toEqual({ A: "#123456" });
  });
});
