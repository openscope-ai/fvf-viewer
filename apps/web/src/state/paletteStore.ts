/**
 * User-configurable palette store (issues #40/#204): per-channel (A-D) and
 * cursor (C1/C2) appearance overrides on top of the theme defaults. Issue
 * #204 extends the persisted shape from flat color strings to per-key
 * config records ({ color, opacity }) so future per-key scalars extend the
 * same record; legacy flat payloads still hydrate. Overrides persist
 * across browser sessions in local storage and render as authored in both
 * themes.
 */

import { create } from "zustand";
import {
  PALETTE_KEYS,
  isHexColor,
  type CustomColors,
  type PaletteKey,
  type PaletteKeyConfigs,
  type PaletteKeyConfig,
} from "../components/canvas/themePalette";

export const CHANNEL_PALETTE_STORAGE_KEY = "fvf.channel-palette";

/** Default opacity percent (fully opaque) used when no override exists. */
export const DEFAULT_TRACE_OPACITY = 100;

export const MIN_TRACE_OPACITY = 5;
export const MAX_TRACE_OPACITY = 100;

function isPaletteKey(value: unknown): value is PaletteKey {
  return (PALETTE_KEYS as readonly string[]).includes(value as string);
}

function isOpacity(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= MIN_TRACE_OPACITY &&
    value <= MAX_TRACE_OPACITY
  );
}

/** Clamps/rounds a raw opacity to the storable 5–100 integer range. */
function normalizeOpacity(value: number): number {
  return Math.max(
    MIN_TRACE_OPACITY,
    Math.min(MAX_TRACE_OPACITY, Math.round(value)),
  );
}

/**
 * Hydrates the persisted per-key records. Accepts both the current
 * `{ key: { color, opacity } }` shape and the legacy issue #40 flat
 * `{ key: "#rrggbb" }` payloads; invalid entries drop silently.
 */
function readStoredKeyConfigs(): PaletteKeyConfigs {
  try {
    const raw = window.localStorage.getItem(CHANNEL_PALETTE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const cleaned: PaletteKeyConfigs = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (!isPaletteKey(key)) continue;
      if (typeof value === "string") {
        // Legacy flat color override (issue #40 storage).
        if (isHexColor(value)) cleaned[key] = { color: value.toLowerCase() };
        continue;
      }
      if (typeof value !== "object" || value === null) continue;
      const record: PaletteKeyConfig = {};
      const { color, opacity } = value as Record<string, unknown>;
      if (isHexColor(color)) record.color = color.toLowerCase();
      if (isOpacity(opacity)) record.opacity = normalizeOpacity(opacity);
      if (record.color !== undefined || record.opacity !== undefined) {
        cleaned[key] = record;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writeStoredKeyConfigs(keyConfigs: PaletteKeyConfigs): void {
  try {
    if (Object.keys(keyConfigs).length === 0) {
      window.localStorage.removeItem(CHANNEL_PALETTE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        CHANNEL_PALETTE_STORAGE_KEY,
        JSON.stringify(keyConfigs),
      );
    }
  } catch {
    // Persistence is best-effort (private mode, disabled storage): the
    // in-session palette still applies.
  }
}

/** Color-only projection of the per-key records (existing consumers). */
function colorView(keyConfigs: PaletteKeyConfigs): CustomColors {
  const colors: CustomColors = {};
  for (const [key, record] of Object.entries(keyConfigs)) {
    if (record?.color !== undefined) colors[key as PaletteKey] = record.color;
  }
  return colors;
}

/** Drops a record entirely once every part is back at its default. */
function pruneRecord(record: PaletteKeyConfig): PaletteKeyConfig | undefined {
  if (record.color !== undefined || record.opacity !== undefined) {
    return record;
  }
  return undefined;
}

export interface PaletteStoreState {
  /** Persisted per-key appearance records — the source of truth. */
  keyConfigs: PaletteKeyConfigs;
  /** Derived color-only view (key -> hex) for existing consumers. */
  customColors: CustomColors;
  setCustomColor: (key: PaletteKey, color: string) => void;
  /** Clears only the color part; a non-default opacity survives. */
  clearCustomColor: (key: PaletteKey) => void;
  /** Sets the per-key trace opacity percent (clamped 5–100; 100 = default). */
  setKeyOpacity: (key: PaletteKey, opacity: number) => void;
  /** Per-key ↺ (issue #204): restores theme-default color AND 100% opacity. */
  resetKey: (key: PaletteKey) => void;
  resetPalette: () => void;
}

export function createPaletteStore() {
  return create<PaletteStoreState>((set) => {
    const apply = (next: PaletteKeyConfigs) => {
      writeStoredKeyConfigs(next);
      return { keyConfigs: next, customColors: colorView(next) };
    };

    const initial = readStoredKeyConfigs();

    return {
      keyConfigs: initial,
      customColors: colorView(initial),

      setCustomColor: (key, color) =>
        set((state) => {
          // Canonical storage form: lowercase hex (color pickers emit lowercase)
          if (!isHexColor(color)) return state;
          const record = state.keyConfigs[key] ?? {};
          return apply({
            ...state.keyConfigs,
            [key]: { ...record, color: color.toLowerCase() },
          });
        }),

      clearCustomColor: (key) =>
        set((state) => {
          const record = state.keyConfigs[key];
          if (record?.color === undefined) return state;
          const next = { ...state.keyConfigs };
          const pruned = pruneRecord({ ...record, color: undefined });
          if (pruned) next[key] = pruned;
          else delete next[key];
          return apply(next);
        }),

      setKeyOpacity: (key, opacity) =>
        set((state) => {
          if (!Number.isFinite(opacity)) return state;
          const normalized = normalizeOpacity(opacity);
          const record = state.keyConfigs[key] ?? {};
          const next = { ...state.keyConfigs };
          const pruned =
            normalized === DEFAULT_TRACE_OPACITY
              ? pruneRecord({ ...record, opacity: undefined })
              : { ...record, opacity: normalized };
          if (pruned) next[key] = pruned;
          else delete next[key];
          return apply(next);
        }),

      resetKey: (key) =>
        set((state) => {
          if (!(key in state.keyConfigs)) return state;
          const next = { ...state.keyConfigs };
          delete next[key];
          return apply(next);
        }),

      resetPalette: () => set(() => apply({})),
    };
  });
}

export const usePaletteStore = createPaletteStore();
