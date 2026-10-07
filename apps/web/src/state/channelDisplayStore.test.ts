import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelDisplayConfigs } from "../components/canvas/channelDisplay";

/**
 * Issue #224: channel display settings store — per-key Y-scale/offset/
 * invert persistence with default pruning, and the Solo quick-knob's
 * save/restore contract against the viewport store (the shared offset
 * store #98 will write). Node tests stub a minimal localStorage and
 * reset the module registry per case (cursorDisplayStore test pattern).
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

const KEY = "fvf.channel-display";

async function importStores() {
  const display = await import("./channelDisplayStore");
  const viewport = await import("./viewportStore");
  return { display, viewport };
}

function storedConfigs(backing: Map<string, string>): ChannelDisplayConfigs {
  const raw = backing.get(KEY);
  expect(raw).toBeDefined();
  const parsed = JSON.parse(raw!) as {
    keyConfigs: ChannelDisplayConfigs;
  };
  return parsed.keyConfigs;
}

describe("channelDisplayStore (issue #224)", () => {
  let backing: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    backing = stubStorage();
  });

  it("defaults persist nothing and read as identity", async () => {
    const { display } = await importStores();
    const s = display.useChannelDisplayStore.getState();
    expect(s.keyConfigs).toEqual({});
    expect(s.solo).toBeNull();
    expect(backing.has(KEY)).toBe(false);
  });

  it("sets, clamps, and persists per-key display scalars", async () => {
    const { display } = await importStores();
    const s = display.useChannelDisplayStore.getState();
    s.setYScale("A", 250);
    s.setOffset("B", 3.5);
    s.setInverted("C", true);

    const state = display.useChannelDisplayStore.getState();
    expect(state.keyConfigs.A?.yScalePercent).toBe(250);
    expect(state.keyConfigs.B?.offset).toBe(3.5);
    expect(state.keyConfigs.C?.inverted).toBe(true);
    expect(storedConfigs(backing)).toEqual({
      A: { yScalePercent: 250 },
      B: { offset: 3.5 },
      C: { inverted: true },
    });

    // Clamping happens on write.
    display.useChannelDisplayStore.getState().setYScale("A", 9999);
    expect(
      display.useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent,
    ).toBe(500);
  });

  it("prunes fields back at defaults and drops empty records", async () => {
    const { display } = await importStores();
    const s = display.useChannelDisplayStore.getState();
    s.setYScale("A", 250);
    s.setOffset("A", 2);
    s.setInverted("A", true);
    expect(storedConfigs(backing).A).toEqual({
      yScalePercent: 250,
      offset: 2,
      inverted: true,
    });

    s.setYScale("A", 100);
    expect(storedConfigs(backing).A).toEqual({ offset: 2, inverted: true });
    s.setOffset("A", 0);
    expect(storedConfigs(backing).A).toEqual({ inverted: true });
    s.setInverted("A", false);
    expect(
      display.useChannelDisplayStore.getState().keyConfigs.A,
    ).toBeUndefined();
    expect(backing.has(KEY)).toBe(false); // fully pruned record removes the key
  });

  it("resetKey clears one record; reset clears everything", async () => {
    const { display } = await importStores();
    const s = display.useChannelDisplayStore.getState();
    s.setYScale("A", 250);
    s.setInverted("B", true);
    s.resetKey("A");
    expect(
      display.useChannelDisplayStore.getState().keyConfigs.A,
    ).toBeUndefined();
    expect(
      display.useChannelDisplayStore.getState().keyConfigs.B?.inverted,
    ).toBe(true);
    display.useChannelDisplayStore.getState().reset();
    expect(display.useChannelDisplayStore.getState().keyConfigs).toEqual({});
    expect(backing.has(KEY)).toBe(false);
  });

  it("hydrates validated payloads and drops invalid entries", async () => {
    backing.set(
      KEY,
      JSON.stringify({
        keyConfigs: {
          A: { yScalePercent: 300, offset: -1.5, inverted: true },
          B: { yScalePercent: "lots" },
          C: { offset: Number.NaN },
          C1: { inverted: true },
          bogus: { inverted: true },
        },
        solo: { key: "A", savedActive: ["A", "B"] },
      }),
    );
    const { display } = await importStores();
    const state = display.useChannelDisplayStore.getState();
    expect(state.keyConfigs).toEqual({
      A: { yScalePercent: 300, offset: -1.5, inverted: true },
    });
    expect(state.solo).toEqual({ key: "A", savedActive: ["A", "B"] });
  });

  it("hydrates legacy hydrated outliers clamped into range", async () => {
    backing.set(
      KEY,
      JSON.stringify({ keyConfigs: { A: { yScalePercent: 5 } } }),
    );
    const { display } = await importStores();
    // Out-of-range values clamp (5 -> 10) and survive because they differ
    // from the default.
    expect(
      display.useChannelDisplayStore.getState().keyConfigs.A?.yScalePercent,
    ).toBe(10);
  });

  it("solo saves the visibility set, isolates, and restores on second click", async () => {
    const { display, viewport } = await importStores();
    expect(viewport.useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);

    const s = display.useChannelDisplayStore.getState();
    s.toggleSolo("B");
    expect(viewport.useViewportStore.getState().activeChannels).toEqual(["B"]);
    expect(display.useChannelDisplayStore.getState().solo).toEqual({
      key: "B",
      savedActive: ["A", "B", "C", "D"],
    });
    // Persisted per key (issue #224 AC1).
    const persisted = JSON.parse(backing.get(KEY)!) as {
      solo: { key: string; savedActive: string[] };
    };
    expect(persisted.solo).toEqual({
      key: "B",
      savedActive: ["A", "B", "C", "D"],
    });

    display.useChannelDisplayStore.getState().toggleSolo("B");
    expect(viewport.useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(display.useChannelDisplayStore.getState().solo).toBeNull();
  });

  it("switching solo to another channel re-saves the isolated visibility", async () => {
    const { display, viewport } = await importStores();
    display.useChannelDisplayStore.getState().toggleSolo("B");
    display.useChannelDisplayStore.getState().toggleSolo("C");
    // Soloing C while B is soloed saves the currently visible set ([B]).
    expect(display.useChannelDisplayStore.getState().solo).toEqual({
      key: "C",
      savedActive: ["B"],
    });
    expect(viewport.useViewportStore.getState().activeChannels).toEqual(["C"]);
    // One unsolo restores [B] — the set saved when C was soloed.
    display.useChannelDisplayStore.getState().toggleSolo("C");
    expect(viewport.useViewportStore.getState().activeChannels).toEqual(["B"]);
  });

  it("clearSolo (capture ingestion) restores the saved set once", async () => {
    const { display, viewport } = await importStores();
    display.useChannelDisplayStore.getState().toggleSolo("D");
    expect(viewport.useViewportStore.getState().activeChannels).toEqual(["D"]);
    display.useChannelDisplayStore.getState().clearSolo();
    expect(viewport.useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(display.useChannelDisplayStore.getState().solo).toBeNull();
    // A second clear with no solo is a no-op.
    display.useChannelDisplayStore.getState().clearSolo();
    expect(viewport.useViewportStore.getState().activeChannels).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });
});
