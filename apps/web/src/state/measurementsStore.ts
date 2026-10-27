/**
 * Measurements panel state store (issues #278, #280):
 * - Controls visibility of the automatic measurements table.
 * - Controls Gating Mode: "visible" (Visible Window) vs "full" (Full Record).
 * - Controls Statistics View: toggles running statistics table.
 * - Stores online accumulated statistics (Count, Min, Max, Mean, StdDev).
 * - Avoids spurious accumulation via per-metric signature deduplication (F-DEDUP-SCOPE-1).
 * - Persists the open/collapsed state in localStorage under `fvf.measurements-open`.
 */

import { create } from "zustand";
import {
  type MeasurementAccumulator,
  updateAccumulator,
} from "../components/measurements/measurementStats";

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

export type MeasurementGatingMode = "visible" | "full";

export interface MeasurementBatchItem {
  key: string;
  value: number | null;
  signature: string;
  unit?: string;
}

export interface MeasurementsState {
  isOpen: boolean;
  gatingMode: MeasurementGatingMode;
  showStats: boolean;
  accumulators: Record<string, MeasurementAccumulator>;
  lastSignatures: Record<string, string>;

  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  setGatingMode: (mode: MeasurementGatingMode) => void;
  setShowStats: (show: boolean) => void;
  toggleShowStats: () => void;
  accumulateBatch: (items: MeasurementBatchItem[]) => void;
  clearStats: () => void;
  reset: () => void;
}

export const useMeasurementsStore = create<MeasurementsState>((set) => ({
  isOpen: loadMeasurementsOpen(),
  gatingMode: "visible",
  showStats: false,
  accumulators: {},
  lastSignatures: {},

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
  setGatingMode: (gatingMode: MeasurementGatingMode) => {
    set({ gatingMode });
  },
  setShowStats: (showStats: boolean) => {
    set({ showStats });
  },
  toggleShowStats: () => {
    set((state) => ({ showStats: !state.showStats }));
  },
  accumulateBatch: (items: MeasurementBatchItem[]) => {
    set((state) => {
      let changed = false;
      const nextAcc = { ...state.accumulators };
      const nextSignatures = { ...state.lastSignatures };

      for (const item of items) {
        if (item.value === null || !Number.isFinite(item.value)) continue;

        // F-DEDUP-SCOPE-1: Deduplicate per-metric based on its own input signature
        if (state.lastSignatures[item.key] === item.signature) {
          continue;
        }

        nextAcc[item.key] = updateAccumulator(
          nextAcc[item.key],
          item.value,
          item.unit ?? "",
        );
        nextSignatures[item.key] = item.signature;
        changed = true;
      }

      return changed
        ? { accumulators: nextAcc, lastSignatures: nextSignatures }
        : state;
    });
  },
  clearStats: () => {
    set((state) => ({
      accumulators: {},
      lastSignatures: { ...state.lastSignatures },
    }));
  },
  reset: () => {
    saveMeasurementsOpen(false);
    set({
      isOpen: false,
      gatingMode: "visible",
      showStats: false,
      accumulators: {},
      lastSignatures: {},
    });
  },
}));
