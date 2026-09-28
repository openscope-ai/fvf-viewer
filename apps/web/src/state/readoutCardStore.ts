/**
 * Cursor readout card store (issue #58): persists the floating readout
 * card's custom position and collapsed state across browser sessions in
 * local storage. `position: null` selects the default top-right anchor
 * (`top: 76px; right: 16px`); unreadable or malformed stored values fall
 * back to the defaults.
 */

import { create } from "zustand";
import type { CardPoint } from "../components/cursors/readoutCardPosition";

export const READOUT_CARD_STORAGE_KEY = "fvf.cursor-readout-card";

export interface ReadoutCardState {
  position: CardPoint | null;
  collapsed: boolean;
  setPosition: (position: CardPoint | null) => void;
  setCollapsed: (collapsed: boolean) => void;
  reset: () => void;
}

/**
 * Storage version (issue #143): version 1 marks states written after the
 * "expanded by default" change. Legacy states without a version that
 * persisted `collapsed: true` migrate to expanded once; collapses recorded
 * after the migration are preserved as the user's explicit preference.
 */
export const READOUT_CARD_STATE_VERSION = 1;

interface StoredReadoutCardState {
  position: CardPoint | null;
  collapsed: boolean;
  version?: number;
}

const DEFAULT_STORED_STATE: StoredReadoutCardState = {
  position: null,
  collapsed: false,
  version: READOUT_CARD_STATE_VERSION,
};

function isValidPoint(value: unknown): value is CardPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.top === "number" &&
    Number.isFinite(point.top) &&
    typeof point.left === "number" &&
    Number.isFinite(point.left)
  );
}

export function readStoredReadoutCardState(): StoredReadoutCardState {
  try {
    const stored = window.localStorage.getItem(READOUT_CARD_STORAGE_KEY);
    if (!stored) return DEFAULT_STORED_STATE;
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    const position =
      parsed.position === null || parsed.position === undefined
        ? null
        : isValidPoint(parsed.position)
          ? {
              top: parsed.position.top,
              left: parsed.position.left,
            }
          : null;
    // Issue #143: pre-migration states have no version marker. A legacy
    // persisted collapse is treated as the old implicit default and reset
    // to expanded; only versioned states preserve an explicit collapse.
    const collapsed =
      parsed.version === READOUT_CARD_STATE_VERSION
        ? parsed.collapsed === true
        : false;
    return {
      position,
      collapsed,
    };
  } catch {
    return DEFAULT_STORED_STATE;
  }
}

export function writeStoredReadoutCardState(
  state: StoredReadoutCardState,
): void {
  try {
    window.localStorage.setItem(
      READOUT_CARD_STORAGE_KEY,
      JSON.stringify(state),
    );
  } catch {
    // Persistence is best-effort (private mode, disabled storage): the
    // in-session position still applies.
  }
}

export function createReadoutCardStore() {
  const initial = readStoredReadoutCardState();
  return create<ReadoutCardState>((set, get) => ({
    position: initial.position,
    collapsed: initial.collapsed,
    setPosition: (position) =>
      set(() => {
        writeStoredReadoutCardState({
          position,
          collapsed: get().collapsed,
          version: READOUT_CARD_STATE_VERSION,
        });
        return { position };
      }),
    setCollapsed: (collapsed) =>
      set(() => {
        writeStoredReadoutCardState({
          position: get().position,
          collapsed,
          version: READOUT_CARD_STATE_VERSION,
        });
        return { collapsed };
      }),
    reset: () =>
      set(() => {
        writeStoredReadoutCardState(DEFAULT_STORED_STATE);
        return { ...DEFAULT_STORED_STATE };
      }),
  }));
}

export const useReadoutCardStore = createReadoutCardStore();
