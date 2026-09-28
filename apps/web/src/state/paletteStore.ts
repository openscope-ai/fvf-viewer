/**
 * User-configurable palette store (issue #40): per-channel (A-D) and cursor
 * (C1/C2) color overrides on top of the theme defaults. Overrides persist
 * across browser sessions in local storage and render as authored in both
 * themes; "Reset to Default Palette" clears every override.
 */

import { create } from "zustand";
import {
  PALETTE_KEYS,
  isHexColor,
  type CustomColors,
  type PaletteKey,
} from "../components/canvas/themePalette";

export const CHANNEL_PALETTE_STORAGE_KEY = "fvf.channel-palette";

function isPaletteKey(value: unknown): value is PaletteKey {
  return (PALETTE_KEYS as readonly string[]).includes(value as string);
}

function readStoredCustomColors(): CustomColors {
  try {
    const raw = window.localStorage.getItem(CHANNEL_PALETTE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const cleaned: CustomColors = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (isPaletteKey(key) && isHexColor(value)) {
        cleaned[key] = value;
      }
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writeStoredCustomColors(customColors: CustomColors): void {
  try {
    if (Object.keys(customColors).length === 0) {
      window.localStorage.removeItem(CHANNEL_PALETTE_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        CHANNEL_PALETTE_STORAGE_KEY,
        JSON.stringify(customColors),
      );
    }
  } catch {
    // Persistence is best-effort (private mode, disabled storage): the
    // in-session palette still applies.
  }
}

export interface PaletteStoreState {
  customColors: CustomColors;
  setCustomColor: (key: PaletteKey, color: string) => void;
  clearCustomColor: (key: PaletteKey) => void;
  resetPalette: () => void;
}

export function createPaletteStore() {
  return create<PaletteStoreState>((set) => ({
    customColors: readStoredCustomColors(),

    setCustomColor: (key, color) =>
      set((state) => {
        // Canonical storage form: lowercase hex (color pickers emit lowercase)
        if (!isHexColor(color)) return state;
        const customColors = {
          ...state.customColors,
          [key]: color.toLowerCase(),
        };
        writeStoredCustomColors(customColors);
        return { customColors };
      }),

    clearCustomColor: (key) =>
      set((state) => {
        if (!(key in state.customColors)) return state;
        const customColors = { ...state.customColors };
        delete customColors[key];
        writeStoredCustomColors(customColors);
        return { customColors };
      }),

    resetPalette: () =>
      set(() => {
        writeStoredCustomColors({});
        return { customColors: {} };
      }),
  }));
}

export const usePaletteStore = createPaletteStore();
