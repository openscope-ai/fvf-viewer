/**
 * Per-file custom channel names (issue #64): users can rename capture
 * channels (e.g. "A" -> "A: V_grid") from the toolbar; amendments are
 * stored in local storage keyed by capture identity (file name + capture
 * timestamp) so re-opening the same file restores its names.
 */

import { create } from "zustand";

export const CHANNEL_NAMES_STORAGE_KEY = "fvf.channel-names";

export const CHANNEL_NAME_MAX_LENGTH = 24;

/** Storage shape: fileKey -> { channelTag -> custom name }. */
export type StoredChannelNames = Record<string, Record<string, string>>;

function readStoredNames(): StoredChannelNames {
  try {
    const raw = window.localStorage.getItem(CHANNEL_NAMES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    const cleaned: StoredChannelNames = {};
    for (const [fileKey, names] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (
        typeof fileKey !== "string" ||
        typeof names !== "object" ||
        names === null
      )
        continue;
      const fileNames: Record<string, string> = {};
      for (const [tag, value] of Object.entries(
        names as Record<string, unknown>,
      )) {
        if (
          typeof tag === "string" &&
          typeof value === "string" &&
          value.trim()
        ) {
          fileNames[tag] = value;
        }
      }
      cleaned[fileKey] = fileNames;
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writeStoredNames(names: StoredChannelNames): void {
  try {
    if (Object.keys(names).length === 0) {
      window.localStorage.removeItem(CHANNEL_NAMES_STORAGE_KEY);
    } else {
      window.localStorage.setItem(
        CHANNEL_NAMES_STORAGE_KEY,
        JSON.stringify(names),
      );
    }
  } catch {
    // Persistence is best-effort (private mode, disabled storage): the
    // in-session names still apply.
  }
}

export interface ChannelNamesState {
  /** Capture identity of the active primary file (fileName::timestamp14). */
  fileKey: string | null;
  /** Capture identity of the active File 2 comparison file (fileName::timestamp14). */
  refFileKey: string | null;
  /** Active custom names: channel tag (A..D, Ref-A..Ref-D) -> custom amendment. */
  names: Record<string, string>;
  setFileKey: (fileKey: string | null) => void;
  setRefFileKey: (refFileKey: string | null) => void;
  /** Commits an amendment (empty/whitespace clears to the default). */
  setName: (channel: string, raw: string) => void;
  clearName: (channel: string) => void;
}

export function createChannelNamesStore() {
  return create<ChannelNamesState>((set, get) => {
    const persistSlot = (isRef: boolean) => {
      const { fileKey, refFileKey, names } = get();
      const targetKey = isRef ? refFileKey : fileKey;
      if (!targetKey) return;
      const stored = readStoredNames();
      const slotNames: Record<string, string> = {};
      for (const [tag, value] of Object.entries(names)) {
        if (isRef && tag.startsWith("Ref-")) {
          slotNames[tag.slice("Ref-".length)] = value;
        } else if (!isRef && !tag.startsWith("Ref-")) {
          slotNames[tag] = value;
        }
      }
      if (Object.keys(slotNames).length === 0) {
        delete stored[targetKey];
      } else {
        stored[targetKey] = slotNames;
      }
      writeStoredNames(stored);
    };
    return {
      fileKey: null,
      refFileKey: null,
      names: {},
      setFileKey: (fileKey) =>
        set((state) => {
          const nextNames: Record<string, string> = {};
          for (const [tag, value] of Object.entries(state.names)) {
            if (tag.startsWith("Ref-")) {
              nextNames[tag] = value;
            }
          }
          if (!fileKey) {
            return { fileKey: null, names: nextNames };
          }
          const stored = readStoredNames();
          for (const [tag, value] of Object.entries(stored[fileKey] ?? {})) {
            if (!tag.startsWith("Ref-")) {
              nextNames[tag] = value;
            }
          }
          return {
            fileKey,
            names: nextNames,
          };
        }),
      setRefFileKey: (refFileKey) =>
        set((state) => {
          const nextNames: Record<string, string> = {};
          for (const [tag, value] of Object.entries(state.names)) {
            if (!tag.startsWith("Ref-")) {
              nextNames[tag] = value;
            }
          }
          if (!refFileKey) {
            return { refFileKey: null, names: nextNames };
          }
          const stored = readStoredNames();
          for (const [tag, value] of Object.entries(stored[refFileKey] ?? {})) {
            const refTag = tag.startsWith("Ref-")
              ? tag
              : `Ref-${tag.replace(/^Input\s+/i, "")}`;
            nextNames[refTag] = value;
          }
          return {
            refFileKey,
            names: nextNames,
          };
        }),
      setName: (channel, raw) => {
        const amended = raw.trim().slice(0, CHANNEL_NAME_MAX_LENGTH);
        const isRef = channel.startsWith("Ref-");
        set((state) => {
          const names = { ...state.names };
          if (amended) {
            names[channel] = amended;
          } else {
            delete names[channel];
          }
          return { names };
        });
        persistSlot(isRef);
      },
      clearName: (channel) => {
        const isRef = channel.startsWith("Ref-");
        set((state) => {
          if (!(channel in state.names)) return state;
          const names = { ...state.names };
          delete names[channel];
          return { names };
        });
        persistSlot(isRef);
      },
    };
  });
}

export const useChannelNamesStore = createChannelNamesStore();

/**
 * Builds the display name for a channel: the amendment renders as
 * `<letter>: <custom>`; without one, the capture's own label (or bare tag)
 * is kept.
 */
export function channelDisplayName(
  channel: string,
  label: string | null | undefined,
  customName: string | null | undefined,
): string {
  if (customName && customName.trim()) {
    return `${channel}: ${customName.trim()}`;
  }
  return label || channel;
}

/**
 * Resolves the display label for channel readings in the measurement cursors panel (issue #131 / AC1):
 * strips any redundant "Input " prefix so physical channels display as "A", "B", etc.
 * When a custom name is set, retains "<channel>: <custom>" (e.g. "A: V_grid").
 */
export function formatReadoutChannelName(
  channel: string,
  label: string | null | undefined,
  customName: string | null | undefined,
): string {
  const name = channelDisplayName(channel, label, customName);
  return name.replace(/^Input\s+/i, "").trim();
}

/** Capture identity used for per-file persistence. */
export function captureFileKey(
  fileName: string | null | undefined,
  timestamp14: string | null | undefined,
): string | null {
  if (!fileName && !timestamp14) return null;
  return `${fileName ?? "(unnamed)"}::${timestamp14 ?? "(undated)"}`;
}
