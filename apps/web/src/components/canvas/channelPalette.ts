/**
 * Channel trace color palette per architecture.md §4.1, shared by the
 * oscilloscope canvas and the waveform toolbar badges (issue #12).
 */

/**
 * Channel trace color palette per architecture.md §4.1:
 * - Channel A: Vivid Oscilloscope Yellow (#FFD700)
 * - Channel B: Deep Sky Blue (#00BFFF)
 * - Channel C: High-Contrast Orange-Red (#FF4500)
 * - Channel D: Electric Emerald Green (#00FF7F)
 * - Cursor 1 (C1): Violet Magenta (#E040FB)
 * - Cursor 2 (C2): Silver Gray (#B0B0B0)
 */
export const CHANNEL_PALETTE: Record<string, string> = {
  A: "#FFD700",
  B: "#00BFFF",
  C: "#FF4500",
  D: "#00FF7F",
  "Input A": "#FFD700",
  "Input B": "#00BFFF",
  "Input C": "#FF4500",
  "Input D": "#00FF7F",
};

export function getChannelColor(channelName: string): string {
  if (CHANNEL_PALETTE[channelName]) {
    return CHANNEL_PALETTE[channelName];
  }
  const clean = channelName.replace(/^Input\s+/i, "");
  if (CHANNEL_PALETTE[clean]) {
    return CHANNEL_PALETTE[clean];
  }
  return "#00BFFF";
}
