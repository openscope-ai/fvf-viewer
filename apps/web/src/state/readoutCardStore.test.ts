import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createReadoutCardStore,
  READOUT_CARD_STATE_VERSION,
  READOUT_CARD_STORAGE_KEY,
} from "./readoutCardStore";

function stubWindowStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  (globalThis as unknown as { window?: unknown }).window = {
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
    },
  };
  return data;
}

describe("readoutCardStore", () => {
  beforeEach(() => {
    stubWindowStorage();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("starts expanded with the default anchor when nothing is stored", () => {
    const store = createReadoutCardStore();
    expect(store.getState().collapsed).toBe(false);
    expect(store.getState().position).toBeNull();
  });

  it("migrates a legacy persisted collapse to expanded (issue #143)", () => {
    stubWindowStorage({
      [READOUT_CARD_STORAGE_KEY]: JSON.stringify({
        position: { top: 10, left: 20 },
        collapsed: true,
      }),
    });
    const store = createReadoutCardStore();
    // Expanded by default, while the custom position survives migration.
    expect(store.getState().collapsed).toBe(false);
    expect(store.getState().position).toEqual({ top: 10, left: 20 });
  });

  it("preserves an explicit collapse recorded after the migration", () => {
    stubWindowStorage({
      [READOUT_CARD_STORAGE_KEY]: JSON.stringify({
        position: null,
        collapsed: true,
        version: READOUT_CARD_STATE_VERSION,
      }),
    });
    const store = createReadoutCardStore();
    expect(store.getState().collapsed).toBe(true);
  });

  it("stamps new writes so they survive a reload as explicit state", () => {
    const data = stubWindowStorage();
    const store = createReadoutCardStore();
    store.getState().setCollapsed(true);
    const stored = JSON.parse(data.get(READOUT_CARD_STORAGE_KEY) ?? "{}") as {
      version?: number;
    };
    expect(stored.version).toBe(READOUT_CARD_STATE_VERSION);
    expect(createReadoutCardStore().getState().collapsed).toBe(true);
  });

  it("falls back to expanded on malformed stored state", () => {
    stubWindowStorage({ [READOUT_CARD_STORAGE_KEY]: "not-json{" });
    expect(createReadoutCardStore().getState().collapsed).toBe(false);
  });
});
