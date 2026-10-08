/**
 * Snapshot exporter registry (issue #18): the Oscilloscope registers a live
 * compositing exporter bound to its uPlot instance on mount and clears it on
 * unmount; the toolbar PNG control consumes it. Keeping this in a store avoids
 * threading render callbacks through the component tree.
 *
 * Issue #252: the exporter takes the PNG export settings (theme,
 * background, readout card, cursors, grid) — the download and clipboard
 * paths read them from one source of truth (pngExportStore).
 */

import { create } from "zustand";
import type { PngExportSettings } from "../../state/pngExportStore";

export interface SnapshotStoreState {
  /**
   * Live exporter. With default settings and the dark theme it produces
   * today's screen snapshot byte-for-byte; the light theme (or any
   * non-default option) routes through the offscreen render.
   */
  exporter: ((settings: PngExportSettings) => Promise<Blob>) | null;
  registerExporter: (
    exporter: ((settings: PngExportSettings) => Promise<Blob>) | null,
  ) => void;
}

export const useSnapshotStore = create<SnapshotStoreState>((set) => ({
  exporter: null,
  registerExporter: (exporter) => set({ exporter }),
}));
