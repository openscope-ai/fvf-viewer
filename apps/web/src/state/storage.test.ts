import { afterEach, describe, expect, it } from "vitest";
import {
  browserLocalStorageAdapter,
  captureFileKey,
  createMemoryStorageAdapter,
  getStorageAdapter,
  readJson,
  readPerFileMap,
  readString,
  resetStorageAdapter,
  setStorageAdapter,
  writeJson,
  writePerFileMap,
  writeString,
  type StorageAdapter,
} from "./storage";

describe("shared persistence storage adapter (issue #358)", () => {
  afterEach(() => {
    resetStorageAdapter();
  });

  it("round-trips raw strings and removes key on null", () => {
    const mem = createMemoryStorageAdapter();
    expect(readString("k", mem)).toBeNull();

    writeString("k", "light", mem);
    expect(readString("k", mem)).toBe("light");
    expect(mem.snapshot()).toEqual({ k: "light" });

    writeString("k", null, mem);
    expect(readString("k", mem)).toBeNull();
    expect(mem.snapshot()).toEqual({});
  });

  it("round-trips JSON records, handles corrupt JSON, and cleans up empty/default values", () => {
    const mem = createMemoryStorageAdapter();
    const fallback = { count: 0 };

    // Missing key -> fallback
    expect(readJson("cfg", fallback, undefined, mem)).toEqual({ count: 0 });

    // Valid round-trip
    writeJson("cfg", { count: 42 }, { adapter: mem });
    expect(
      readJson(
        "cfg",
        fallback,
        (raw) =>
          typeof raw === "object" &&
          raw !== null &&
          typeof (raw as Record<string, unknown>).count === "number"
            ? { count: (raw as { count: number }).count }
            : fallback,
        mem,
      ),
    ).toEqual({ count: 42 });

    // Empty cleanup removes key
    writeJson(
      "cfg",
      { count: 0 },
      {
        isEmpty: (v) => v.count === 0,
        adapter: mem,
      },
    );
    expect(mem.getItem("cfg")).toBeNull();

    // Corrupt JSON -> fallback
    mem.setItem("cfg", "{not valid json");
    expect(readJson("cfg", fallback, undefined, mem)).toEqual({ count: 0 });

    // Validator throwing -> fallback
    mem.setItem("cfg", JSON.stringify({ count: 7 }));
    expect(
      readJson(
        "cfg",
        fallback,
        () => {
          throw new Error("invalid shape");
        },
        mem,
      ),
    ).toEqual({ count: 0 });
  });

  it("reads and writes per-file maps with entry validation and empty cleanup", () => {
    const mem = createMemoryStorageAdapter();
    mem.setItem(
      "per-file",
      JSON.stringify({
        "a.fvf::1": true,
        "b.fvf::2": "not-a-bool",
        "c.fvf::3": false,
      }),
    );

    const read = readPerFileMap(
      "per-file",
      (raw) => (typeof raw === "boolean" ? raw : undefined),
      mem,
    );
    expect(read).toEqual({ "a.fvf::1": true, "c.fvf::3": false });

    writePerFileMap("per-file", { "a.fvf::1": true }, mem);
    expect(JSON.parse(mem.getItem("per-file")!)).toEqual({ "a.fvf::1": true });

    // Empty map removes storage key
    writePerFileMap("per-file", {}, mem);
    expect(mem.getItem("per-file")).toBeNull();

    // Array or primitive root -> {}
    mem.setItem("per-file", JSON.stringify([1, 2, 3]));
    expect(readPerFileMap("per-file", (raw) => raw as boolean, mem)).toEqual(
      {},
    );
  });

  it("degrades silently on QuotaExceededError and unavailable storage", () => {
    const throwingAdapter: StorageAdapter = {
      getItem: () => {
        throw new Error("SecurityError: storage disabled");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError: storage disabled");
      },
    };

    expect(readString("k", throwingAdapter)).toBeNull();
    expect(() => writeString("k", "v", throwingAdapter)).not.toThrow();
    expect(() => writeString("k", null, throwingAdapter)).not.toThrow();
    expect(readJson("k", { ok: true }, undefined, throwingAdapter)).toEqual({
      ok: true,
    });
    expect(() =>
      writeJson("k", { ok: false }, { adapter: throwingAdapter }),
    ).not.toThrow();
    expect(readPerFileMap("k", () => true, throwingAdapter)).toEqual({});
    expect(() =>
      writePerFileMap("k", { a: true }, throwingAdapter),
    ).not.toThrow();
  });

  it("supports swapping and resetting the active adapter", () => {
    expect(getStorageAdapter()).toBe(browserLocalStorageAdapter);
    const mem = createMemoryStorageAdapter();
    setStorageAdapter(mem);
    expect(getStorageAdapter()).toBe(mem);

    writeString("active-key", "hello");
    expect(mem.getItem("active-key")).toBe("hello");
    expect(readString("active-key")).toBe("hello");

    resetStorageAdapter();
    expect(getStorageAdapter()).toBe(browserLocalStorageAdapter);
  });

  it("captureFileKey builds canonical file identities and rejects empty inputs", () => {
    expect(captureFileKey("scope.fvf", "20261121120000")).toBe(
      "scope.fvf::20261121120000",
    );
    expect(captureFileKey(null, "20261121120000")).toBe(
      "(unnamed)::20261121120000",
    );
    expect(captureFileKey("scope.fvf", null)).toBe("scope.fvf::(undated)");
    expect(captureFileKey(null, null)).toBeNull();
    expect(captureFileKey(undefined, undefined)).toBeNull();
  });
});
