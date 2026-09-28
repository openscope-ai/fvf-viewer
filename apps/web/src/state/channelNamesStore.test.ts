import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #64: per-file custom channel names — amendment trimming/limit,
 * empty-clears semantics, per-file keying, and localStorage persistence.
 * Node tests stub a minimal localStorage and reset the module registry.
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
  vi.resetModules();
  return import("./channelNamesStore");
}

describe("channelNamesStore (issue #64)", () => {
  let backing: Map<string, string> | null = null;

  beforeEach(() => {
    vi.resetModules();
    backing = stubStorage();
  });

  afterEach(() => {
    vi.resetModules();
    backing = null;
  });

  it("trims amendments, enforces the 24-char limit, and clears on empty", async () => {
    const { createChannelNamesStore } = await importStore();
    const store = createChannelNamesStore();
    store.getState().setFileKey("scope.fvf::12300020260912");

    store.getState().setName("A", "  V_grid  ");
    expect(store.getState().names.A).toBe("V_grid");

    const long = "x".repeat(40);
    store.getState().setName("A", long);
    expect(store.getState().names.A!.length).toBe(24);

    store.getState().setName("A", "   ");
    expect(store.getState().names.A).toBeUndefined();
  });

  it("keys names per file so files never leak into each other", async () => {
    const { createChannelNamesStore } = await importStore();
    const store = createChannelNamesStore();
    store.getState().setFileKey("a.fvf::111");
    store.getState().setName("A", "V_grid");
    store.getState().setFileKey("b.fvf::222");
    expect(store.getState().names).toEqual({});
    store.getState().setName("B", "Gate PWM");
    store.getState().setFileKey("a.fvf::111");
    expect(store.getState().names).toEqual({ A: "V_grid" });
    store.getState().setFileKey("b.fvf::222");
    expect(store.getState().names).toEqual({ B: "Gate PWM" });
  });

  it("persists amendments per file in local storage", async () => {
    const { createChannelNamesStore, CHANNEL_NAMES_STORAGE_KEY } =
      await importStore();
    const store = createChannelNamesStore();
    store.getState().setFileKey("scope.fvf::12300020260912");
    store.getState().setName("A", "Shunt Current");

    const raw = backing!.get(CHANNEL_NAMES_STORAGE_KEY)!;
    expect(JSON.parse(raw)).toEqual({
      "scope.fvf::12300020260912": { A: "Shunt Current" },
    });

    // A fresh store (new session) restores the file's names.
    const fresh = createChannelNamesStore();
    fresh.getState().setFileKey("scope.fvf::12300020260912");
    expect(fresh.getState().names).toEqual({ A: "Shunt Current" });
  });

  it("captureFileKey builds the identity and refuses empty captures", async () => {
    const { captureFileKey } = await importStore();
    expect(captureFileKey("scope.fvf", "12300020260912")).toBe(
      "scope.fvf::12300020260912",
    );
    expect(captureFileKey(null, null)).toBeNull();
    expect(captureFileKey(null, "123")).toBe("(unnamed)::123");
  });
});
