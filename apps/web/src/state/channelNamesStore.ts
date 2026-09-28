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
  /** Capture identity of the active file (fileName::timestamp14). */
  fileKey: string | null;
  /** Active file's custom names: channel tag -> custom amendment. */
  names: Record<string, string>;
  setFileKey: (fileKey: string | null) => void;
  /** Commits an amendment (empty/whitespace clears to the default). */
  setName: (channel: string, raw: string) => void;
  clearName: (channel: string) => void;
}

export function createChannelNamesStore() {
  return create<ChannelNamesState>((set, get) => {
    const persistActive = () => {
      const { fileKey, names } = get();
      if (!fileKey) return;
      const stored = readStoredNames();
      if (Object.keys(names).length === 0) {
        delete stored[fileKey];
      } else {
        stored[fileKey] = names;
      }
      writeStoredNames(stored);
    };
    return {
      fileKey: null,
      names: {},
      setFileKey: (fileKey) =>
        set(() => {
          if (!fileKey) {
            return { fileKey: null, names: {} };
          }
          const stored = readStoredNames();
          return {
            fileKey,
            names: { ...(stored[fileKey] ?? {}) },
          };
        }),
      setName: (channel, raw) => {
        const amended = raw.trim().slice(0, CHANNEL_NAME_MAX_LENGTH);
        set((state) => {
          const names = { ...state.names };
          if (amended) {
            names[channel] = amended;
          } else {
            delete names[channel];
          }
          return { names };
        });
        persistActive();
      },
      clearName: (channel) => {
        set((state) => {
          if (!(channel in state.names)) return state;
          const names = { ...state.names };
          delete names[channel];
          return { names };
        });
        persistActive();
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
