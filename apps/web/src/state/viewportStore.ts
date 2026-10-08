/**
 * Zustand viewport store (issue #10): tracks horizontal (xMin, xMax) and
 * vertical (yMin, yMax) bounds, and active channels.
 * Decoupled viewport sync: uPlot handles zooming/panning natively for 60 FPS
 * and syncs bounds out to this store via `setSelect` / `setScale` hooks.
 * Issue #12 adds the fit/reset command channel: a monotonic `fitRequest`
 * counter bumped by `requestFit()`; the oscilloscope canvas observes it and
 * applies the full-capture fit bounds.
 */

import { create } from "zustand";

export type ChannelTag = "A" | "B" | "C" | "D" | string;

export interface ViewportBounds {
  xMin: number | null;
  xMax: number | null;
  yMin: number | null;
  yMax: number | null;
}

export interface ViewportStoreState extends ViewportBounds {
  activeChannels: ChannelTag[];
  selectedChannel: ChannelTag | null;
  /** Monotonic fit/reset request counter (0 = no fit requested yet). */
  fitRequest: number;
  setBounds: (bounds: Partial<ViewportBounds>) => void;
  resetBounds: () => void;
  /** Requests a one-click Reset View viewport re-frame (full-capture fit). */
  requestFit: () => void;
  toggleChannel: (channel: ChannelTag) => void;
  cycleChannelBadge: (channel: ChannelTag) => void;
  setSelectedChannel: (channel: ChannelTag | null) => void;
  setChannelVisibility: (channel: ChannelTag, visible: boolean) => void;
  setActiveChannels: (channels: ChannelTag[]) => void;
  reset: () => void;
}

const DEFAULT_ACTIVE_CHANNELS: ChannelTag[] = ["A", "B", "C", "D"];

export const useViewportStore = create<ViewportStoreState>((set) => ({
  xMin: null,
  xMax: null,
  yMin: null,
  yMax: null,
  activeChannels: [...DEFAULT_ACTIVE_CHANNELS],
  selectedChannel: DEFAULT_ACTIVE_CHANNELS[0] ?? null,
  fitRequest: 0,
  setBounds: (bounds) =>
    set((state) => ({
      xMin: bounds.xMin !== undefined ? bounds.xMin : state.xMin,
      xMax: bounds.xMax !== undefined ? bounds.xMax : state.xMax,
      yMin: bounds.yMin !== undefined ? bounds.yMin : state.yMin,
      yMax: bounds.yMax !== undefined ? bounds.yMax : state.yMax,
    })),
  resetBounds: () =>
    set({
      xMin: null,
      xMax: null,
      yMin: null,
      yMax: null,
    }),
  requestFit: () => set((state) => ({ fitRequest: state.fitRequest + 1 })),
  toggleChannel: (channel) =>
    set((state) => {
      const exists = state.activeChannels.includes(channel);
      const nextActive = exists
        ? state.activeChannels.filter((ch) => ch !== channel)
        : [...state.activeChannels, channel];
      const nextSelected =
        state.selectedChannel === channel
          ? (nextActive[0] ?? null)
          : (state.selectedChannel ?? nextActive[0] ?? null);
      return {
        activeChannels: nextActive,
        selectedChannel: nextSelected,
      };
    }),
  cycleChannelBadge: (channel) =>
    set((state) => {
      const isVisible = state.activeChannels.includes(channel);
      const isSelected = state.selectedChannel === channel;

      if (!isVisible) {
        // hidden -> visible (unselected, unless no other channel is visible)
        const nextActive = [...state.activeChannels, channel];
        const nextSelected =
          state.selectedChannel !== null &&
          nextActive.includes(state.selectedChannel)
            ? state.selectedChannel
            : channel;
        return { activeChannels: nextActive, selectedChannel: nextSelected };
      }

      if (!isSelected) {
        // visible -> selected
        return { selectedChannel: channel };
      }

      // selected -> hidden
      const nextActive = state.activeChannels.filter((ch) => ch !== channel);
      const nextSelected = nextActive.length > 0 ? nextActive[0]! : null;
      return { activeChannels: nextActive, selectedChannel: nextSelected };
    }),
  setSelectedChannel: (channel) =>
    set((state) => {
      if (channel === null) {
        return { selectedChannel: null };
      }
      if (state.activeChannels.includes(channel)) {
        return { selectedChannel: channel };
      }
      return state;
    }),
  setChannelVisibility: (channel, visible) =>
    set((state) => {
      const exists = state.activeChannels.includes(channel);
      if (visible && !exists) {
        const nextActive = [...state.activeChannels, channel];
        const nextSelected = state.selectedChannel ?? channel;
        return { activeChannels: nextActive, selectedChannel: nextSelected };
      }
      if (!visible && exists) {
        const nextActive = state.activeChannels.filter((ch) => ch !== channel);
        const nextSelected =
          state.selectedChannel === channel
            ? (nextActive[0] ?? null)
            : state.selectedChannel;
        return { activeChannels: nextActive, selectedChannel: nextSelected };
      }
      return state;
    }),
  setActiveChannels: (channels) =>
    set((state) => {
      const nextActive = [...channels];
      const nextSelected =
        state.selectedChannel !== null &&
        nextActive.includes(state.selectedChannel)
          ? state.selectedChannel
          : (nextActive[0] ?? null);
      return {
        activeChannels: nextActive,
        selectedChannel: nextSelected,
      };
    }),
  reset: () =>
    set({
      xMin: null,
      xMax: null,
      yMin: null,
      yMax: null,
      fitRequest: 0,
      activeChannels: [...DEFAULT_ACTIVE_CHANNELS],
      selectedChannel: DEFAULT_ACTIVE_CHANNELS[0] ?? null,
    }),
}));
