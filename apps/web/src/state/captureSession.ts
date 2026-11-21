/**
 * CaptureSession coordinator (issue #357): single owner of all multi-store
 * capture lifecycle transitions and unified Primary/Reference visibility &
 * solo coordination.
 *
 * Centralizing these transitions here eliminates:
 * - circular imports between Zustand stores (`referenceStore` <-> `channelDisplayStore`),
 * - lifecycle `useEffect` chains in `App.tsx` and defensive `setFileKey`/`clearSolo`
 *   workarounds in `Oscilloscope.tsx` / `ViewportController`,
 * - inline multi-store orchestration in `WaveformToolbar.tsx` and `MetadataBanner.tsx`,
 * - duplicated multi-store resets across tests (`resetSession()`).
 */

import {
  getChannelCatalog,
  isReferenceChannelId,
} from "../capture/channelCatalog";
import {
  isRefChannelKey,
  type ChannelKey,
} from "../components/canvas/channelDisplay";
import { useBadgePopoverStore } from "../components/toolbar/badgeConfig/anchoredPopover";
import type { ParsedCapture } from "../types/capture";
import { useCaptureStore } from "./captureStore";
import { useChannelDisplayStore } from "./channelDisplayStore";
import { useChannelNamesStore } from "./channelNamesStore";
import { captureFileKey } from "./storage";
import { useCursorStore } from "./cursorStore";
import { useLaneLayoutStore } from "./laneLayoutStore";
import { useReferenceStore } from "./referenceStore";
import { useViewportStore, type ChannelTag } from "./viewportStore";
import { useZoomHistoryStore } from "./zoomHistoryStore";

export interface ResetViewOptions {
  channelsOverride?: ChannelTag[];
}

function closeReferencePopoverIfOpen(): void {
  const openKey = useBadgePopoverStore.getState().openKey;
  const openChannelId = openKey?.startsWith("channel:")
    ? openKey.slice("channel:".length)
    : null;
  if (openChannelId && isReferenceChannelId(openChannelId)) {
    useBadgePopoverStore.getState().setOpen(null);
  }
}

function dropReferenceLaneWeights(): void {
  const refKeys = Object.keys(useLaneLayoutStore.getState().weights).filter(
    (key) => isReferenceChannelId(key),
  );
  if (refKeys.length > 0) {
    useLaneLayoutStore.getState().dropKeys(refKeys as ChannelKey[]);
  }
}

/**
 * Clears active Solo state and restores the saved visibility set to the
 * appropriate store (primary channels in `viewportStore`, reference channels
 * in `referenceStore`).
 */
export function clearSolo(): void {
  const solo = useChannelDisplayStore.getState().solo;
  if (!solo) return;
  if (isRefChannelKey(solo.key)) {
    useReferenceStore.getState().setRefActiveChannels(solo.savedActive);
  } else {
    useViewportStore.getState().setActiveChannels(solo.savedActive);
  }
  useChannelDisplayStore.getState().setSolo(null);
}

/**
 * Unified Solo toggle for both Primary (`A`–`D`) and Reference (`Ref-A`–`Ref-D`)
 * channels: first click saves the slot's current visibility set and isolates
 * `key`; second click on the same key restores the saved set.
 */
export function toggleSolo(key: ChannelKey): void {
  const solo = useChannelDisplayStore.getState().solo;
  const ref = isRefChannelKey(key);
  if (solo?.key === key) {
    if (ref) {
      useReferenceStore.getState().setRefActiveChannels(solo.savedActive);
    } else {
      useViewportStore.getState().setActiveChannels(solo.savedActive);
    }
    useChannelDisplayStore.getState().setSolo(null);
    return;
  }
  const savedActive = ref
    ? [...useReferenceStore.getState().refActiveChannels]
    : [...useViewportStore.getState().activeChannels];
  if (ref) {
    useReferenceStore.getState().setRefActiveChannels([key]);
  } else {
    useViewportStore.getState().setActiveChannels([key]);
  }
  useChannelDisplayStore.getState().setSolo({ key, savedActive });
}

/**
 * Drops File 2 comparison capture and tears down all compare-specific state
 * (popover, reference store, ref file key, ref display transforms/solo, and
 * reference lane weights) while preserving primary view state.
 */
export function clearReference(): void {
  closeReferencePopoverIfOpen();
  useReferenceStore.getState().clear();
  useChannelNamesStore.getState().setRefFileKey(null);
  useChannelDisplayStore.getState().clearRefTransforms();
  dropReferenceLaneWeights();
}

function clearPrimarySessionState(): void {
  clearReference();
  clearSolo();
  useChannelNamesStore.getState().setFileKey(null);
  useLaneLayoutStore.getState().setFileKey(null);
  useChannelDisplayStore.getState().setFileKey(null);
  useZoomHistoryStore.getState().reset();
}

/**
 * Allocates a new primary ingestion ticket and immediately clears prior
 * capture-scoped state (comparison, solo, per-file keys, zoom history) as
 * `captureStore` nulls the active capture — ensuring a failed read or parse
 * never leaves stale File 2 or solo state behind.
 */
export function beginPrimaryIngestion(fileName?: string): number {
  const ticket = useCaptureStore.getState().allocateTicket(fileName);
  clearPrimarySessionState();
  return ticket;
}

function syncPrimaryCaptureStores(
  capture: ParsedCapture,
  fileName: string | null,
): void {
  clearReference();
  clearSolo();

  const fileKey = captureFileKey(fileName, capture.metadata.timestamp14);
  useChannelNamesStore.getState().setFileKey(fileKey);
  useLaneLayoutStore.getState().setFileKey(fileKey);
  useChannelDisplayStore.getState().setFileKey(fileKey);

  useZoomHistoryStore.getState().reset();
  useCursorStore.getState().initForCapture(capture.timestamps.length);

  const curSelected = useViewportStore.getState().selectedChannel;
  const isValid =
    curSelected != null && capture.channels.some((c) => c.name === curSelected);
  if (!isValid && capture.channels.length > 0) {
    useViewportStore.getState().setSelectedChannel(capture.channels[0]!.name);
  }
}

/**
 * Parses a primary capture buffer through `captureStore` and, on success,
 * atomically coordinates all dependent stores (dropping any active comparison,
 * clearing solo, updating per-file keys, resetting zoom history, initializing
 * cursors, and ensuring a valid selected channel). When invoked without a
 * pre-allocated ticket, prior capture-scoped state is cleared up front so a
 * failed parse never leaves stale comparison/solo/file-key state behind.
 */
export async function ingestPrimary(
  buffer: ArrayBuffer,
  fileName?: string,
  ticket?: number,
): Promise<void> {
  if (ticket === undefined) {
    clearPrimarySessionState();
  } else if (ticket !== useCaptureStore.getState().currentTicket()) {
    return;
  }
  await useCaptureStore.getState().parseBuffer(buffer, fileName, ticket);
  const state = useCaptureStore.getState();
  if (ticket !== undefined && ticket !== state.currentTicket()) {
    return;
  }
  if (state.parseState !== "success" || !state.capture) {
    return;
  }
  syncPrimaryCaptureStores(state.capture, state.fileName);
}

/**
 * Parses and resamples a File 2 reference capture onto the active primary
 * capture's time grid and, on success, updates compare-scoped stores
 * (reference channel-names key and reference display transforms).
 */
export async function ingestReference(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<void> {
  await useReferenceStore.getState().parseReferenceBuffer(buffer, fileName);
  const state = useReferenceStore.getState();
  if (state.parseState !== "success" || !state.capture) {
    return;
  }
  useChannelNamesStore
    .getState()
    .setRefFileKey(
      captureFileKey(state.fileName, state.capture.metadata.timestamp14),
    );
  useChannelDisplayStore.getState().clearRefTransforms();
}

/**
 * Reset View: resets all display transforms, clears solo, restores visibility
 * for all primary (and active reference) channels, zeros comparison time slip,
 * equalizes lane proportions in Stack mode, resets mirrored viewport bounds,
 * and requests a fresh canvas fit.
 */
export function resetView(options?: ResetViewOptions): void {
  useChannelDisplayStore.getState().resetTransforms();
  clearSolo();

  const currentCatalog = getChannelCatalog();
  const allChannels =
    options?.channelsOverride ?? currentCatalog.primary.map((ch) => ch.id);
  if (allChannels.length > 0) {
    useViewportStore.getState().setActiveChannels(allChannels);
  }

  const refStore = useReferenceStore.getState();
  if (refStore.capture) {
    refStore.setTimeSlip(0);
    refStore.setRefActiveChannels(currentCatalog.reference.map((ch) => ch.id));
  }

  if (useChannelDisplayStore.getState().stackMode) {
    useLaneLayoutStore.getState().equalize();
  }

  const viewport = useViewportStore.getState();
  viewport.resetBounds();
  viewport.requestFit();
}

/**
 * Discards the loaded capture and returns to the landing page, resetting
 * viewport, cursors, zoom history, solo, comparison, per-file keys, and
 * primary capture state.
 */
export function returnToLanding(): void {
  useViewportStore.getState().reset();
  useCursorStore.getState().reset();
  useZoomHistoryStore.getState().reset();
  clearSolo();
  clearReference();
  useChannelNamesStore.getState().setFileKey(null);
  useLaneLayoutStore.getState().setFileKey(null);
  useChannelDisplayStore.getState().setFileKey(null);
  useCaptureStore.getState().reset();
}

/**
 * Full capture-session reset for test isolation and complete teardown:
 * restores every capture-session store to its initial state.
 */
export function resetSession(): void {
  useCaptureStore.getState().reset();
  useReferenceStore.getState().clear();
  useViewportStore.getState().reset();
  useCursorStore.getState().reset();
  useZoomHistoryStore.getState().reset();
  useChannelDisplayStore.getState().reset();
  useChannelNamesStore.getState().setFileKey(null);
  useChannelNamesStore.getState().setRefFileKey(null);
  useLaneLayoutStore.getState().setFileKey(null);
  useBadgePopoverStore.getState().setOpen(null);
}

export const CaptureSession = {
  beginPrimaryIngestion,
  ingestPrimary,
  ingestReference,
  clearReference,
  resetView,
  returnToLanding,
  resetSession,
  toggleSolo,
  clearSolo,
} as const;
