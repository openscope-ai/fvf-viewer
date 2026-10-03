import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issues #40/#204: user-configurable palette store — per-key {color,
 * opacity} records, color-only clearing, per-key reset (↺), full reset,
 * validation, localStorage persistence in the record shape, and hydration
 * of the legacy flat issue #40 payloads. Node tests stub a minimal
 * localStorage and reset the module registry per case.
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

describe("paletteStore (issues #40/#204)", () => {
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

  it("starts with no overrides and persists accepted custom colors as records", async () => {
    const { usePaletteStore, CHANNEL_PALETTE_STORAGE_KEY } =
      await importStore();
    expect(usePaletteStore.getState().customColors).toEqual({});
    expect(usePaletteStore.getState().keyConfigs).toEqual({});

    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setCustomColor("C2", "#ABC");
    // Overrides are stored in canonical lowercase hex inside per-key records
    expect(usePaletteStore.getState().customColors).toEqual({
      A: "#123456",
      C2: "#abc",
    });
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      A: { color: "#123456" },
      C2: { color: "#abc" },
    });
    expect(JSON.parse(backing!.get(CHANNEL_PALETTE_STORAGE_KEY)!)).toEqual({
      A: { color: "#123456" },
      C2: { color: "#abc" },
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
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      A: { color: "#123456" },
    });
    expect(JSON.parse(backing!.get(CHANNEL_PALETTE_STORAGE_KEY)!)).toEqual({
      A: { color: "#123456" },
    });
  });

  it("clearCustomColor removes only the color part; opacity survives", async () => {
    const { usePaletteStore } = await importStore();
    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setKeyOpacity("A", 40);
    usePaletteStore.getState().setCustomColor("B", "#654321");
    usePaletteStore.getState().clearCustomColor("A");
    expect(usePaletteStore.getState().customColors).toEqual({ B: "#654321" });
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      A: { opacity: 40 },
      B: { color: "#654321" },
    });
    usePaletteStore.getState().clearCustomColor("A"); // no-op
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      A: { opacity: 40 },
      B: { color: "#654321" },
    });
  });

  it("setKeyOpacity clamps to 5–100, rounds, and treats 100 as default", async () => {
    const { usePaletteStore, CHANNEL_PALETTE_STORAGE_KEY } =
      await importStore();
    usePaletteStore.getState().setKeyOpacity("A", 250);
    // 250 clamps to 100, and 100 IS the default: the record prunes away.
    expect(usePaletteStore.getState().keyConfigs).toEqual({});
    expect(backing!.get(CHANNEL_PALETTE_STORAGE_KEY)).toBeUndefined();

    usePaletteStore.getState().setKeyOpacity("A", 2);
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({
      opacity: 5,
    });
    usePaletteStore.getState().setKeyOpacity("A", 47.6);
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({
      opacity: 48,
    });
    // Non-finite input is rejected.
    usePaletteStore.getState().setKeyOpacity("A", Number.NaN);
    expect(usePaletteStore.getState().keyConfigs.A).toEqual({
      opacity: 48,
    });
  });

  it("resetKey (per-key ↺) restores default color AND opacity for one key", async () => {
    const { usePaletteStore } = await importStore();
    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setKeyOpacity("A", 30);
    usePaletteStore.getState().setKeyOpacity("D", 60);
    usePaletteStore.getState().resetKey("A");
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      D: { opacity: 60 },
    });
    expect(usePaletteStore.getState().customColors).toEqual({});
    usePaletteStore.getState().resetKey("A"); // no-op
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      D: { opacity: 60 },
    });
  });

  it("resetPalette removes every override and clears the storage entry", async () => {
    const { usePaletteStore, CHANNEL_PALETTE_STORAGE_KEY } =
      await importStore();
    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setKeyOpacity("C1", 45);
    usePaletteStore.getState().resetPalette();
    expect(usePaletteStore.getState().customColors).toEqual({});
    expect(usePaletteStore.getState().keyConfigs).toEqual({});
    expect(backing!.get(CHANNEL_PALETTE_STORAGE_KEY)).toBeUndefined();
  });

  it("hydrates persisted records at store creation and drops invalid entries", async () => {
    backing!.set(
      "fvf.channel-palette",
      JSON.stringify({
        A: { color: "#111111", opacity: 30 },
        B: { opacity: 90 },
        ZZZ: { color: "#222222" },
        C1: { color: "nope", opacity: 400 },
        D: { opacity: 42 },
        C2: {},
      }),
    );
    const { usePaletteStore } = await importStore();
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      A: { color: "#111111", opacity: 30 },
      B: { opacity: 90 },
      D: { opacity: 42 },
    });
    expect(usePaletteStore.getState().customColors).toEqual({
      A: "#111111",
    });
  });

  it("hydrates legacy flat issue #40 payloads as color records", async () => {
    backing!.set(
      "fvf.channel-palette",
      JSON.stringify({ A: "#111111", C1: "#ABC", B: "nope", X: "#333" }),
    );
    const { usePaletteStore } = await importStore();
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      A: { color: "#111111" },
      C1: { color: "#abc" },
    });
    expect(usePaletteStore.getState().customColors).toEqual({
      A: "#111111",
      C1: "#abc",
    });
  });

  it("falls back to no overrides for malformed stored payloads", async () => {
    backing!.set("fvf.channel-palette", "{not json");
    const { usePaletteStore } = await importStore();
    expect(usePaletteStore.getState().customColors).toEqual({});
    expect(usePaletteStore.getState().keyConfigs).toEqual({});
  });

  it("works without localStorage available", async () => {
    delete (globalThis as unknown as { window?: unknown }).window;
    const { usePaletteStore } = await importStore();
    expect(usePaletteStore.getState().customColors).toEqual({});
    usePaletteStore.getState().setCustomColor("A", "#123456");
    usePaletteStore.getState().setKeyOpacity("A", 55);
    expect(usePaletteStore.getState().customColors).toEqual({ A: "#123456" });
    expect(usePaletteStore.getState().keyConfigs).toEqual({
      A: { color: "#123456", opacity: 55 },
    });
  });
});
