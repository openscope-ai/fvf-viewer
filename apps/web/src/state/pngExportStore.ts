/**
 * PNG export settings (issue #252): the export options popover's source
 * of truth — theme (dark screen / light print), background (opaque /
 * transparent alpha), readout-card embedding (full / collapsed /
 * excluded), cursor and graticule inclusion, and a custom download
 * filename. Persisted per session in a validated localStorage record
 * following the existing `fvf.*` store pattern; the defaults reproduce
 * today's exact export behavior byte-for-byte (dark screen snapshot,
 * opaque background, full readout card, cursors and grid included,
 * derived capture filename).
 */

import { create } from "zustand";

export const PNG_EXPORT_STORAGE_KEY = "fvf.png-export";

export type PngExportTheme = "dark" | "light";
export type PngExportBackground = "opaque" | "transparent";
export type PngExportReadoutCard = "full" | "collapsed" | "excluded";

export interface PngExportSettings {
  theme: PngExportTheme;
  background: PngExportBackground;
  readoutCard: PngExportReadoutCard;
  /** Measurement cursor lines in the export (on-screen view untouched). */
  cursors: boolean;
  /** Graticule grid in the export (on-screen view untouched). */
  grid: boolean;
  /** Custom download filename; empty falls back to the derived capture name. */
  fileName: string;
}

export const PNG_EXPORT_DEFAULTS: PngExportSettings = {
  theme: "dark",
  background: "opaque",
  readoutCard: "full",
  cursors: true,
  grid: true,
  fileName: "",
};

/** Keep user filenames filesystem-friendly and bounded. */
export const PNG_FILE_NAME_MAX_LENGTH = 64;

function isTheme(v: unknown): v is PngExportTheme {
  return v === "dark" || v === "light";
}
function isBackground(v: unknown): v is PngExportBackground {
  return v === "opaque" || v === "transparent";
}
function isCard(v: unknown): v is PngExportReadoutCard {
  return v === "full" || v === "collapsed" || v === "excluded";
}

/** Strips path separators and control characters from a filename draft. */
export function sanitizeFileNameDraft(raw: string): string {
  let out = "";
  for (const char of raw) {
    const code = char.charCodeAt(0);
    if (code < 32) continue;
    if ('\\/:*?"<>|'.includes(char)) continue;
    out += char;
  }
  return out.slice(0, PNG_FILE_NAME_MAX_LENGTH);
}

function readStored(): Partial<PngExportSettings> {
  try {
    const raw = window.localStorage.getItem(PNG_EXPORT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    const settings: Partial<PngExportSettings> = {};
    if (isTheme(record.theme)) settings.theme = record.theme;
    if (isBackground(record.background))
      settings.background = record.background;
    if (isCard(record.readoutCard)) settings.readoutCard = record.readoutCard;
    if (typeof record.cursors === "boolean") settings.cursors = record.cursors;
    if (typeof record.grid === "boolean") settings.grid = record.grid;
    if (typeof record.fileName === "string") {
      settings.fileName = sanitizeFileNameDraft(record.fileName);
    }
    return settings;
  } catch {
    return {};
  }
}

function writeStored(settings: PngExportSettings): void {
  try {
    if (
      settings.theme === PNG_EXPORT_DEFAULTS.theme &&
      settings.background === PNG_EXPORT_DEFAULTS.background &&
      settings.readoutCard === PNG_EXPORT_DEFAULTS.readoutCard &&
      settings.cursors === PNG_EXPORT_DEFAULTS.cursors &&
      settings.grid === PNG_EXPORT_DEFAULTS.grid &&
      settings.fileName === PNG_EXPORT_DEFAULTS.fileName
    ) {
      window.localStorage.removeItem(PNG_EXPORT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        PNG_EXPORT_STORAGE_KEY,
        JSON.stringify(settings),
      );
    }
  } catch {
    // Best-effort persistence (private mode, disabled storage): the
    // in-session settings still apply.
  }
}

/** True when the settings reproduce the historical export behavior. */
export function isDefaultExportSettings(settings: PngExportSettings): boolean {
  return (
    settings.theme === "dark" &&
    settings.background === "opaque" &&
    settings.readoutCard === "full" &&
    settings.cursors &&
    settings.grid
  );
}

export interface PngExportStoreState {
  settings: PngExportSettings;
  setTheme: (theme: PngExportTheme) => void;
  setBackground: (background: PngExportBackground) => void;
  setReadoutCard: (card: PngExportReadoutCard) => void;
  setCursors: (cursors: boolean) => void;
  setGrid: (grid: boolean) => void;
  setFileName: (fileName: string) => void;
}

/** Exported for validated-hydration tests (fresh instance per call). */
export function createPngExportStore() {
  const initial: PngExportSettings = {
    ...PNG_EXPORT_DEFAULTS,
    ...readStored(),
  };
  return create<PngExportStoreState>((set) => {
    const update = (patch: Partial<PngExportSettings>) => {
      set((state) => {
        const settings = { ...state.settings, ...patch };
        writeStored(settings);
        return { settings };
      });
    };
    return {
      settings: initial,
      setTheme: (theme) => update({ theme }),
      setBackground: (background) => update({ background }),
      setReadoutCard: (readoutCard) => update({ readoutCard }),
      setCursors: (cursors) => update({ cursors }),
      setGrid: (grid) => update({ grid }),
      setFileName: (fileName) => update({ fileName }),
    };
  });
}

export const usePngExportStore = createPngExportStore();
