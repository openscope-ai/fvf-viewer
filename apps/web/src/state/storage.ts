/**
 * Shared persistence storage adapter (issue #358): provides one uniform,
 * best-effort persistence seam (`StorageAdapter`) with a browser `localStorage`
 * production adapter and an in-memory test adapter, plus typed JSON and
 * per-file keyed map helpers and the neutral `captureFileKey` helper.
 */

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MemoryStorageAdapter extends StorageAdapter {
  clear(): void;
  snapshot(): Record<string, string>;
}

function resolveBrowserLocalStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Accessing window.localStorage can throw SecurityError in restricted contexts.
  }
  try {
    if (typeof localStorage !== "undefined") {
      return localStorage;
    }
  } catch {
    // Storage unavailable.
  }
  return null;
}

/**
 * Production adapter backed by `window.localStorage` (resolved dynamically per
 * call so restricted/headless contexts degrade silently without throwing).
 */
export const browserLocalStorageAdapter: StorageAdapter = {
  getItem(key) {
    try {
      return resolveBrowserLocalStorage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    try {
      resolveBrowserLocalStorage()?.setItem(key, value);
    } catch {
      // Best-effort persistence (QuotaExceededError, private mode, disabled storage).
    }
  },
  removeItem(key) {
    try {
      resolveBrowserLocalStorage()?.removeItem(key);
    } catch {
      // Best-effort persistence.
    }
  },
};

/**
 * In-memory `StorageAdapter` for unit and integration tests.
 */
export function createMemoryStorageAdapter(
  initial?: Record<string, string>,
): MemoryStorageAdapter {
  const backing = new Map<string, string>(
    initial ? Object.entries(initial) : [],
  );
  return {
    getItem(key) {
      return backing.get(key) ?? null;
    },
    setItem(key, value) {
      backing.set(key, value);
    },
    removeItem(key) {
      backing.delete(key);
    },
    clear() {
      backing.clear();
    },
    snapshot() {
      return Object.fromEntries(backing.entries());
    },
  };
}

let activeAdapter: StorageAdapter = browserLocalStorageAdapter;

export function getStorageAdapter(): StorageAdapter {
  return activeAdapter;
}

export function setStorageAdapter(adapter: StorageAdapter): void {
  activeAdapter = adapter;
}

export function resetStorageAdapter(): void {
  activeAdapter = browserLocalStorageAdapter;
}

/** Reads a raw string value, returning `null` if missing or storage throws. */
export function readString(
  key: string,
  adapter: StorageAdapter = activeAdapter,
): string | null {
  try {
    return adapter.getItem(key);
  } catch {
    return null;
  }
}

/** Writes a raw string value, or removes the key when `value === null`. */
export function writeString(
  key: string,
  value: string | null,
  adapter: StorageAdapter = activeAdapter,
): void {
  try {
    if (value === null) {
      adapter.removeItem(key);
    } else {
      adapter.setItem(key, value);
    }
  } catch {
    // Best-effort persistence: in-session state still applies.
  }
}

/**
 * Reads and parses a JSON value from storage. Returns `fallback` when the key
 * is absent, contains corrupt JSON, or fails validation.
 */
export function readJson<T>(
  key: string,
  fallback: T,
  validate?: (parsed: unknown) => T,
  adapter: StorageAdapter = activeAdapter,
): T {
  const raw = readString(key, adapter);
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validate ? validate(parsed) : (parsed as T);
  } catch {
    return fallback;
  }
}

export interface WriteJsonOptions<T> {
  /** When true, removes the storage key instead of persisting an empty/default record. */
  isEmpty?: (value: T) => boolean;
  adapter?: StorageAdapter;
}

/**
 * Serializes `value` to JSON and persists it, or removes `key` when
 * `options.isEmpty(value)` returns true.
 */
export function writeJson<T>(
  key: string,
  value: T,
  options?: WriteJsonOptions<T>,
): void {
  const adapter = options?.adapter ?? activeAdapter;
  if (options?.isEmpty?.(value)) {
    writeString(key, null, adapter);
    return;
  }
  try {
    writeString(key, JSON.stringify(value), adapter);
  } catch {
    // Best-effort persistence.
  }
}

/**
 * Reads a per-file keyed map (`fileKey -> T`), dropping non-object roots and
 * entries for which `validateEntry` returns `undefined`.
 */
export function readPerFileMap<T>(
  key: string,
  validateEntry: (raw: unknown) => T | undefined,
  adapter: StorageAdapter = activeAdapter,
): Record<string, T> {
  return readJson<Record<string, T>>(
    key,
    {},
    (parsed) => {
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      ) {
        return {};
      }
      const cleaned: Record<string, T> = {};
      for (const [fileKey, rawValue] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        if (typeof fileKey !== "string") continue;
        const entry = validateEntry(rawValue);
        if (entry !== undefined) {
          cleaned[fileKey] = entry;
        }
      }
      return cleaned;
    },
    adapter,
  );
}

/**
 * Persists a per-file keyed map, removing the storage key when empty.
 */
export function writePerFileMap<T>(
  key: string,
  map: Record<string, T>,
  adapter: StorageAdapter = activeAdapter,
): void {
  writeJson(key, map, {
    isEmpty: (m) => Object.keys(m).length === 0,
    adapter,
  });
}

/** Capture identity used for per-file persistence (`fileName::timestamp14`). */
export function captureFileKey(
  fileName: string | null | undefined,
  timestamp14: string | null | undefined,
): string | null {
  if (!fileName && !timestamp14) return null;
  return `${fileName ?? "(unnamed)"}::${timestamp14 ?? "(undated)"}`;
}
