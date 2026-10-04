import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #226: cursor display settings store — global measurement display
 * units, per-cursor line styles, defaults that keep the pre-#226
 * behavior, validation on hydration, and per-session localStorage
 * persistence. Node tests stub a minimal localStorage and reset the
 * module registry per case (paletteStore test pattern).
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

const KEY = "fvf.cursor-display";

async function importStore() {
  return import("./cursorDisplayStore");
}

describe("cursorDisplayStore (issue #226)", () => {
  let backing: Map<string, string>;

  beforeEach(() => {
    vi.resetModules();
    backing = stubStorage();
  });

  it("defaults keep the pre-#226 behavior and persist nothing", async () => {
    const { useCursorDisplayStore } = await importStore();
    const s = useCursorDisplayStore.getState();
    expect(s.timeUnit).toBe("auto");
    expect(s.frequencyUnit).toBe("auto");
    expect(s.voltageUnit).toBe("auto");
    expect(s.lineStyles).toEqual({ C1: "solid", C2: "solid" });
    expect(backing.has(KEY)).toBe(false);
  });

  it("setters update state, persist, and hydrate on next creation", async () => {
    const { useCursorDisplayStore } = await importStore();
    useCursorDisplayStore.getState().setTimeUnit("ms");
    useCursorDisplayStore.getState().setFrequencyUnit("kHz");
    useCursorDisplayStore.getState().setVoltageUnit("dBV");
    useCursorDisplayStore.getState().setLineStyle("C2", "dotted");
    expect(JSON.parse(backing.get(KEY)!)).toEqual({
      timeUnit: "ms",
      frequencyUnit: "kHz",
      voltageUnit: "dBV",
      lineStyles: { C1: "solid", C2: "dotted" },
      bindings: { C1: "all", C2: "all" },
      deltaLocked: false,
    });

    vi.resetModules();
    backing = stubStorage();
    backing.set(
      KEY,
      JSON.stringify({
        timeUnit: "ms",
        frequencyUnit: "kHz",
        voltageUnit: "dBV",
        lineStyles: { C1: "solid", C2: "dotted" },
      }),
    );
    const fresh = await importStore();
    const s = fresh.useCursorDisplayStore.getState();
    expect(s.timeUnit).toBe("ms");
    expect(s.frequencyUnit).toBe("kHz");
    expect(s.voltageUnit).toBe("dBV");
    expect(s.lineStyles).toEqual({ C1: "solid", C2: "dotted" });
    expect(s.bindings).toEqual({ C1: "all", C2: "all" });
    expect(s.deltaLocked).toBe(false);
  });

  it("line styles are independent per cursor", async () => {
    const { useCursorDisplayStore } = await importStore();
    useCursorDisplayStore.getState().setLineStyle("C1", "dashed");
    expect(useCursorDisplayStore.getState().lineStyles).toEqual({
      C1: "dashed",
      C2: "solid",
    });
    useCursorDisplayStore.getState().setLineStyle("C2", "dotted");
    expect(useCursorDisplayStore.getState().lineStyles).toEqual({
      C1: "dashed",
      C2: "dotted",
    });
  });

  it("reset restores defaults and drops the storage entry", async () => {
    const { useCursorDisplayStore } = await importStore();
    useCursorDisplayStore.getState().setTimeUnit("ns");
    useCursorDisplayStore.getState().setLineStyle("C1", "dashed");
    useCursorDisplayStore.getState().reset();
    const s = useCursorDisplayStore.getState();
    expect(s.timeUnit).toBe("auto");
    expect(s.lineStyles).toEqual({ C1: "solid", C2: "solid" });
    expect(backing.has(KEY)).toBe(false);
  });

  it("bindings and the delta lock persist and hydrate (issue #225)", async () => {
    const { useCursorDisplayStore } = await importStore();
    useCursorDisplayStore.getState().setBinding("C1", "B");
    useCursorDisplayStore.getState().setDeltaLocked(true);
    expect(useCursorDisplayStore.getState().bindings).toEqual({
      C1: "B",
      C2: "all",
    });
    expect(useCursorDisplayStore.getState().deltaLocked).toBe(true);
    expect(JSON.parse(backing.get(KEY)!)).toMatchObject({
      bindings: { C1: "B", C2: "all" },
      deltaLocked: true,
    });

    // Bindings are independent per cursor; the lock is one shared flag.
    useCursorDisplayStore.getState().setBinding("C2", "D");
    expect(useCursorDisplayStore.getState().bindings).toEqual({
      C1: "B",
      C2: "D",
    });

    useCursorDisplayStore.getState().reset();
    expect(useCursorDisplayStore.getState().bindings).toEqual({
      C1: "all",
      C2: "all",
    });
    expect(useCursorDisplayStore.getState().deltaLocked).toBe(false);
    expect(backing.has(KEY)).toBe(false);
  });

  it("reset clears bindings even after hydrating persisted ones (F1 aliasing regression)", async () => {
    backing.set(
      KEY,
      JSON.stringify({
        bindings: { C1: "B", C2: "D" },
        deltaLocked: true,
      }),
    );
    const { useCursorDisplayStore } = await importStore();
    const s = useCursorDisplayStore.getState();
    expect(s.bindings).toEqual({ C1: "B", C2: "D" });
    useCursorDisplayStore.getState().reset();
    const after = useCursorDisplayStore.getState();
    expect(after.bindings).toEqual({ C1: "all", C2: "all" });
    expect(after.deltaLocked).toBe(false);
    expect(backing.has(KEY)).toBe(false);
  });

  it("invalid persisted payloads hydrate to defaults without throwing", async () => {
    backing.set(
      KEY,
      JSON.stringify({
        timeUnit: "furlongs",
        frequencyUnit: 7,
        voltageUnit: null,
        lineStyles: { C1: "wavy", C2: "dotted" },
      }),
    );
    const { useCursorDisplayStore } = await importStore();
    const s = useCursorDisplayStore.getState();
    expect(s.timeUnit).toBe("auto");
    expect(s.frequencyUnit).toBe("auto");
    expect(s.voltageUnit).toBe("auto");
    expect(s.lineStyles).toEqual({ C1: "solid", C2: "dotted" });
    expect(s.bindings).toEqual({ C1: "all", C2: "all" });
    expect(s.deltaLocked).toBe(false);
  });
});
