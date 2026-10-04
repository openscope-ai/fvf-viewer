/**
 * Cursor display settings store (issue #226): the global measurement
 * display-unit selection (one shared setting surfaced in both cursor
 * popovers — the HUD readout card is a single shared surface) and the
 * per-cursor C1/C2 line style. Defaults keep the pre-#226 SI-ladder
 * behavior (`siFormat.ts`) and solid 2px cursor lines; selections persist
 * per session in local storage next to the palette record.
 */

import { create } from "zustand";
import type { CursorId } from "./cursorStore";

/** Time display units; `auto` = the SI ladder (`siFormat.formatTime`). */
export type TimeUnit = "auto" | "s" | "ms" | "µs" | "ns";

/**
 * Frequency display units; `auto` is labeled "1/Δt" in the UI because it
 * computes the reciprocal of the cursor separation and formats it through
 * the SI ladder — exactly the pre-#226 behavior.
 */
export type FrequencyUnit = "auto" | "Hz" | "kHz" | "MHz";

/**
 * Voltage display units; `auto` keeps each channel's canonical SI
 * formatting (`channelUnits.formatChannelValue`). `dBV` is
 * 20·log10(|V|) of the base-SI sample value. Non-volt channels (A, raw)
 * never take the voltage override.
 */
export type VoltageUnit = "auto" | "V" | "mV" | "dBV";

/** Cursor line rendering styles (issue #226), independent per cursor. */
export type LineStyle = "solid" | "dashed" | "dotted";

/**
 * Channel source binding (issue #225): "all" (the default — the HUD card
 * shows every visible channel) or a physical channel tag. Reference
 * channels (#96) extend this union when dual-file comparison ships.
 */
export type CursorBinding = "all" | "A" | "B" | "C" | "D";

export const CURSOR_DISPLAY_STORAGE_KEY = "fvf.cursor-display";

const TIME_UNITS: readonly TimeUnit[] = ["auto", "s", "ms", "µs", "ns"];
const FREQUENCY_UNITS: readonly FrequencyUnit[] = ["auto", "Hz", "kHz", "MHz"];
const VOLTAGE_UNITS: readonly VoltageUnit[] = ["auto", "V", "mV", "dBV"];
const LINE_STYLES: readonly LineStyle[] = ["solid", "dashed", "dotted"];
const BINDINGS: readonly CursorBinding[] = ["all", "A", "B", "C", "D"];

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (allowed as readonly string[]).includes(value)
  );
}

interface PersistedCursorDisplay {
  timeUnit: TimeUnit;
  frequencyUnit: FrequencyUnit;
  voltageUnit: VoltageUnit;
  lineStyles: { C1: LineStyle; C2: LineStyle };
  bindings: { C1: CursorBinding; C2: CursorBinding };
  deltaLocked: boolean;
}

const DEFAULTS: PersistedCursorDisplay = {
  timeUnit: "auto",
  frequencyUnit: "auto",
  voltageUnit: "auto",
  lineStyles: { C1: "solid", C2: "solid" },
  bindings: { C1: "all", C2: "all" },
  deltaLocked: false,
};

/** Fresh copy of the defaults with no shared mutable references. */
function defaultsCopy(): PersistedCursorDisplay {
  return {
    ...DEFAULTS,
    lineStyles: { ...DEFAULTS.lineStyles },
    bindings: { ...DEFAULTS.bindings },
  };
}

function readStored(): PersistedCursorDisplay {
  try {
    const raw = window.localStorage.getItem(CURSOR_DISPLAY_STORAGE_KEY);
    if (!raw) return defaultsCopy();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return defaultsCopy();
    }
    const record = parsed as Record<string, unknown>;
    const clean: PersistedCursorDisplay = defaultsCopy();
    if (oneOf(TIME_UNITS, record.timeUnit)) clean.timeUnit = record.timeUnit;
    if (oneOf(FREQUENCY_UNITS, record.frequencyUnit)) {
      clean.frequencyUnit = record.frequencyUnit;
    }
    if (oneOf(VOLTAGE_UNITS, record.voltageUnit)) {
      clean.voltageUnit = record.voltageUnit;
    }
    if (typeof record.lineStyles === "object" && record.lineStyles !== null) {
      const styles = record.lineStyles as Record<string, unknown>;
      if (oneOf(LINE_STYLES, styles.C1)) clean.lineStyles.C1 = styles.C1;
      if (oneOf(LINE_STYLES, styles.C2)) clean.lineStyles.C2 = styles.C2;
    }
    if (typeof record.bindings === "object" && record.bindings !== null) {
      const bindings = record.bindings as Record<string, unknown>;
      if (oneOf(BINDINGS, bindings.C1)) clean.bindings.C1 = bindings.C1;
      if (oneOf(BINDINGS, bindings.C2)) clean.bindings.C2 = bindings.C2;
    }
    if (typeof record.deltaLocked === "boolean") {
      clean.deltaLocked = record.deltaLocked;
    }
    return clean;
  } catch {
    return defaultsCopy();
  }
}

function persist(state: CursorDisplayStoreState): void {
  try {
    const isDefault =
      state.timeUnit === DEFAULTS.timeUnit &&
      state.frequencyUnit === DEFAULTS.frequencyUnit &&
      state.voltageUnit === DEFAULTS.voltageUnit &&
      state.lineStyles.C1 === "solid" &&
      state.lineStyles.C2 === "solid" &&
      state.bindings.C1 === "all" &&
      state.bindings.C2 === "all" &&
      state.deltaLocked === false;
    if (isDefault) {
      window.localStorage.removeItem(CURSOR_DISPLAY_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        CURSOR_DISPLAY_STORAGE_KEY,
        JSON.stringify({
          timeUnit: state.timeUnit,
          frequencyUnit: state.frequencyUnit,
          voltageUnit: state.voltageUnit,
          lineStyles: state.lineStyles,
          bindings: state.bindings,
          deltaLocked: state.deltaLocked,
        }),
      );
    }
  } catch {
    // Best-effort persistence (private mode, disabled storage): the
    // in-session selection still applies.
  }
}

export interface CursorDisplayStoreState {
  timeUnit: TimeUnit;
  frequencyUnit: FrequencyUnit;
  voltageUnit: VoltageUnit;
  lineStyles: { C1: LineStyle; C2: LineStyle };
  /** Issue #225: per-cursor channel source binding ("all" default). */
  bindings: { C1: CursorBinding; C2: CursorBinding };
  /** Issue #225: pair-level locked-Δt tracking (one shared setting). */
  deltaLocked: boolean;
  setTimeUnit: (unit: TimeUnit) => void;
  setFrequencyUnit: (unit: FrequencyUnit) => void;
  setVoltageUnit: (unit: VoltageUnit) => void;
  setLineStyle: (id: CursorId, style: LineStyle) => void;
  setBinding: (id: CursorId, binding: CursorBinding) => void;
  setDeltaLocked: (locked: boolean) => void;
  reset: () => void;
}

export function createCursorDisplayStore() {
  return create<CursorDisplayStoreState>((set) => {
    const initial = readStored();
    const apply = (partial: Partial<PersistedCursorDisplay>) =>
      set((state) => {
        const next: CursorDisplayStoreState = {
          ...state,
          ...partial,
          lineStyles: { ...state.lineStyles, ...partial.lineStyles },
          bindings: { ...state.bindings, ...partial.bindings },
        };
        persist(next);
        return next;
      });

    return {
      timeUnit: initial.timeUnit,
      frequencyUnit: initial.frequencyUnit,
      voltageUnit: initial.voltageUnit,
      lineStyles: initial.lineStyles,
      bindings: initial.bindings,
      deltaLocked: initial.deltaLocked,

      setTimeUnit: (unit) => apply({ timeUnit: unit }),
      setFrequencyUnit: (unit) => apply({ frequencyUnit: unit }),
      setVoltageUnit: (unit) => apply({ voltageUnit: unit }),
      setLineStyle: (id, style) =>
        set((state) => {
          const next: CursorDisplayStoreState = {
            ...state,
            lineStyles: { ...state.lineStyles, [id]: style },
          };
          persist(next);
          return next;
        }),

      setBinding: (id, binding) =>
        set((state) => {
          const next: CursorDisplayStoreState = {
            ...state,
            bindings: { ...state.bindings, [id]: binding },
          };
          persist(next);
          return next;
        }),

      setDeltaLocked: (locked) => apply({ deltaLocked: locked }),
      reset: () => apply(defaultsCopy()),
    };
  });
}

export const useCursorDisplayStore = createCursorDisplayStore();
