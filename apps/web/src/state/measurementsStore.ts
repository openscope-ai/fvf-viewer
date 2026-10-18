/**
 * Measurements panel state store (issue #278):
 * Controls the visibility of the automatic amplitude measurements table.
 * Persists the open/collapsed state in localStorage under `fvf.measurements-open`.
 */

import { create } from "zustand";

export const MEASUREMENTS_STORAGE_KEY = "fvf.measurements-open";

export function loadMeasurementsOpen(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    const raw = localStorage.getItem(MEASUREMENTS_STORAGE_KEY);
    return raw === "true";
  } catch {
    return false;
  }
}

export function saveMeasurementsOpen(open: boolean): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(MEASUREMENTS_STORAGE_KEY, String(open));
  } catch {
    // QuotaExceededError or storage disabled: non-fatal fallback
  }
}

export interface MeasurementsState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  reset: () => void;
}

export const useMeasurementsStore = create<MeasurementsState>((set) => ({
  isOpen: loadMeasurementsOpen(),
  setOpen: (isOpen: boolean) => {
    saveMeasurementsOpen(isOpen);
    set({ isOpen });
  },
  toggleOpen: () => {
    set((state) => {
      const next = !state.isOpen;
      saveMeasurementsOpen(next);
      return { isOpen: next };
    });
  },
  reset: () => {
    saveMeasurementsOpen(false);
    set({ isOpen: false });
  },
}));
