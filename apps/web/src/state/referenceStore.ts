/**
 * Reference capture store (issue #96): the File 2 comparison slot. Owns
 * the raw parsed reference capture (physical truth for stats/readouts),
 * the Wasm-resampled display lanes index-aligned with the PRIMARY
 * capture's time grid, per-reference-channel visibility, and its own
 * parse state machine — loading File 2 never touches File 1's capture,
 * tickets, or parse state in `captureStore`.
 *
 * Reference channels address by display name `Ref-A`…`Ref-D` (File 2's
 * channel tags prefixed); the raw capture keeps its original names.
 */

import { create } from "zustand";
import { parseCaptureBuffer, resampleToGrid } from "../workers/workerClient";
import { buildDisplayData, yScaleKey } from "../capture/channelUnits";
import { useCaptureStore, type CaptureError } from "./captureStore";
import type { ParseState, ParsedCapture } from "../types/capture";

/** Display name of a File 2 channel: `Ref-` + its original tag. */
export function refChannelName(channelName: string): string {
  return `Ref-${channelName.replace(/^Input\s+/i, "")}`;
}

/**
 * Resolves a display channel name to its WaveformChannel across both
 * slots: primary names ("A"…"D") check File 1 first; `Ref-X` names strip
 * the prefix and resolve against File 2 (issue #96 — the popover stats
 * and display-unit lookups use this).
 */
export function findChannelByName(name: string): {
  channel: import("../types/capture").WaveformChannel;
  index: number;
  /** The capture owning the channel (File 1 or the File 2 reference). */
  capture: ParsedCapture;
} | null {
  const primary = useCaptureStore.getState().capture;
  if (primary) {
    const index = primary.channels.findIndex((c) => c.name === name);
    if (index >= 0) {
      return { channel: primary.channels[index]!, index, capture: primary };
    }
  }
  if (name.startsWith("Ref-")) {
    const raw = name.slice("Ref-".length);
    const reference = useReferenceStore.getState().capture;
    if (reference) {
      const index = reference.channels.findIndex(
        (c) => c.name === raw || c.name.replace(/^Input\s+/i, "") === raw,
      );
      if (index >= 0) {
        return {
          channel: reference.channels[index]!,
          index,
          capture: reference,
        };
      }
    }
  }
  return null;
}

/**
 * The live uPlot scale key for a display channel name: `yN` for primary
 * channels and `y(base+N)` for reference channels, which render as
 * trailing series after the full primary set (issue #96).
 */
export function channelScaleKeyFor(name: string): string | null {
  const primary = useCaptureStore.getState().capture;
  const base = primary ? primary.channels.length : 0;
  if (name.startsWith("Ref-")) {
    const resolved = findChannelByName(name);
    if (!resolved || resolved.capture === primary) return null;
    return yScaleKey(base + resolved.index);
  }
  const index = primary?.channels.findIndex((c) => c.name === name) ?? -1;
  return index >= 0 ? yScaleKey(index) : null;
}

export interface ReferenceStoreState {
  /** Raw parsed File 2 capture (physical buffers, own time axis). */
  capture: ParsedCapture | null;
  fileName: string | null;
  /**
   * Resampled display lanes, index-aligned with `capture.channels` and
   * with the primary capture's timestamps grid (NaN outside the overlap).
   */
  lanes: Float32Array[] | null;
  /** Visible reference channel display names (default: all). */
  refActiveChannels: string[];
  parseState: ParseState;
  error: CaptureError | null;
  /**
   * Parses and resamples File 2 onto File 1's time grid. Requires a
   * loaded primary capture; failures land in `error` (rendered by the
   * same ErrorModal surface, issue #11 taxonomy).
   */
  parseReferenceBuffer: (
    buffer: ArrayBuffer,
    fileName: string,
  ) => Promise<void>;
  toggleRefChannel: (name: string) => void;
  setRefActiveChannels: (names: string[]) => void;
  clearError: () => void;
  /** Drops File 2 entirely (File 1 replacement / back-to-landing). */
  clear: () => void;
}

/** Module-level monotonic ticket sequence, mirroring captureStore's. */
let referenceSequence = 0;

function finiteExtentLane(
  lane: Float32Array,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < lane.length; i += 1) {
    const v = lane[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : null;
}

/**
 * Zero-centered symmetric fit bounds for one resampled reference lane
 * (same shape as `computeCaptureFit`'s per-channel entries so the
 * reference traces frame exactly like primary ones at mount).
 */
export function refLaneFitBounds(lane: Float32Array): {
  min: number;
  max: number;
} {
  const extent = finiteExtentLane(lane);
  if (!extent) return { min: -1, max: 1 };
  const maxAbs = Math.max(Math.abs(extent.min), Math.abs(extent.max));
  const bound = maxAbs > 0 ? maxAbs * 1.05 : 1;
  return { min: -bound, max: bound };
}

export function createReferenceStore() {
  return create<ReferenceStoreState>((set) => ({
    capture: null,
    fileName: null,
    lanes: null,
    refActiveChannels: [],
    parseState: "idle",
    error: null,

    parseReferenceBuffer: async (buffer, fileName) => {
      referenceSequence += 1;
      const ticket = referenceSequence;
      set({ parseState: "parsing", error: null });
      try {
        const reference = await parseCaptureBuffer(buffer);
        if (ticket !== referenceSequence) return; // superseded load
        const primary = useCaptureStore.getState().capture;
        if (!primary) {
          set({
            parseState: "error",
            error: {
              code: "worker_error",
              message: "No active capture to compare against.",
              details: "",
            },
          });
          return;
        }
        // Rail-clip (issue #106 semantics) then Wasm-resample each
        // physical channel onto File 1's trigger-relative time grid —
        // never on the main thread (issue #96 AC4).
        const lanes = await Promise.all(
          reference.channels.map(async (channel, index) => {
            const info = reference.metadata.channels[index];
            const physical = info && !info.derived ? info : undefined;
            const clipped = buildDisplayData(
              channel.data,
              channel.rawCounts,
              physical?.windowMin,
              physical?.windowMax,
            );
            return resampleToGrid(
              reference.timestamps,
              clipped,
              primary.timestamps,
            );
          }),
        );
        if (ticket !== referenceSequence) return; // superseded load
        set({
          capture: reference,
          fileName,
          lanes,
          refActiveChannels: reference.channels.map((channel) =>
            refChannelName(channel.name),
          ),
          parseState: "success",
          error: null,
        });
      } catch (error) {
        if (ticket !== referenceSequence) return;
        set({
          parseState: "error",
          error: {
            code: "worker_error",
            message: error instanceof Error ? error.message : String(error),
            details: "",
          },
        });
      }
    },

    toggleRefChannel: (name) =>
      set((state) => ({
        refActiveChannels: state.refActiveChannels.includes(name)
          ? state.refActiveChannels.filter((n) => n !== name)
          : [...state.refActiveChannels, name],
      })),

    setRefActiveChannels: (names) =>
      set(() => ({ refActiveChannels: [...names] })),

    clearError: () => set({ error: null, parseState: "idle" }),

    clear: () => {
      referenceSequence += 1; // invalidate any in-flight load
      set({
        capture: null,
        fileName: null,
        lanes: null,
        refActiveChannels: [],
        parseState: "idle",
        error: null,
      });
    },
  }));
}

export const useReferenceStore = createReferenceStore();
