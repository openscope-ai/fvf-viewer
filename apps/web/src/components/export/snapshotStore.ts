/**
 * Snapshot exporter registry (issue #18): the Oscilloscope registers a live
 * compositing exporter bound to its uPlot instance on mount and clears it on
 * unmount; the toolbar PNG button consumes it. Keeping this in a store avoids
 * threading render callbacks through the component tree.
 */

import { create } from "zustand";

export interface SnapshotStoreState {
  /** Live exporter; `inverted` selects the print-friendly render (#39). */
  exporter: ((inverted: boolean) => Promise<Blob>) | null;
  registerExporter: (
    exporter: ((inverted: boolean) => Promise<Blob>) | null,
  ) => void;
}

export const useSnapshotStore = create<SnapshotStoreState>((set) => ({
  exporter: null,
  registerExporter: (exporter) => set({ exporter }),
}));
