/**
 * CSV export settings (issue #99): the export options popover's source
 * of truth — delimiter (comma vs semicolon) and dataset selection when
 * comparing two files (composite synchronized, primary file only, or
 * reference file only). Persisted in a validated localStorage record
 * following the existing `fvf.*` store pattern.
 */

import { create } from "zustand";

export const CSV_EXPORT_STORAGE_KEY = "fvf.csv-export";

export type CsvDelimiter = "comma" | "semicolon";
export type CsvDataset = "composite" | "primary" | "reference";

export interface CsvExportSettings {
  delimiter: CsvDelimiter;
  dataset: CsvDataset;
}

export const CSV_EXPORT_DEFAULTS: CsvExportSettings = {
  delimiter: "comma",
  dataset: "composite",
};

function isDelimiter(v: unknown): v is CsvDelimiter {
  return v === "comma" || v === "semicolon";
}

function isDataset(v: unknown): v is CsvDataset {
  return v === "composite" || v === "primary" || v === "reference";
}

export function loadCsvExportSettings(): CsvExportSettings {
  if (typeof localStorage === "undefined") return { ...CSV_EXPORT_DEFAULTS };
  try {
    const raw = localStorage.getItem(CSV_EXPORT_STORAGE_KEY);
    if (!raw) return { ...CSV_EXPORT_DEFAULTS };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object")
      return { ...CSV_EXPORT_DEFAULTS };
    return {
      delimiter: isDelimiter(parsed.delimiter)
        ? parsed.delimiter
        : CSV_EXPORT_DEFAULTS.delimiter,
      dataset: isDataset(parsed.dataset)
        ? parsed.dataset
        : CSV_EXPORT_DEFAULTS.dataset,
    };
  } catch {
    return { ...CSV_EXPORT_DEFAULTS };
  }
}

export function saveCsvExportSettings(settings: CsvExportSettings): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CSV_EXPORT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // QuotaExceededError or storage disabled: non-fatal session fallback
  }
}

export interface CsvExportStoreState {
  settings: CsvExportSettings;
  setDelimiter: (delimiter: CsvDelimiter) => void;
  setDataset: (dataset: CsvDataset) => void;
  reset: () => void;
}

export const useCsvExportStore = create<CsvExportStoreState>((set) => ({
  settings: loadCsvExportSettings(),
  setDelimiter: (delimiter) =>
    set((state) => {
      const next = { ...state.settings, delimiter };
      saveCsvExportSettings(next);
      return { settings: next };
    }),
  setDataset: (dataset) =>
    set((state) => {
      const next = { ...state.settings, dataset };
      saveCsvExportSettings(next);
      return { settings: next };
    }),
  reset: () =>
    set(() => {
      const next = { ...CSV_EXPORT_DEFAULTS };
      saveCsvExportSettings(next);
      return { settings: next };
    }),
}));
