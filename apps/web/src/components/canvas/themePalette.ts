/**
 * Viewport theme palettes (issue #38): the default Dark OLED theme per
 * architecture.md §4.1 and a contrast-adapted Light/Lab theme for
 * bright environments. Light-theme trace strokes use darkened, high-contrast
 * variants (darkened yellow/amber, dodger blue, crimson, forest green) so
 * traces stay legible against the white canvas without washing out.
 */

export type ViewportTheme = "dark" | "light";

export interface ThemePalette {
  background: string;
  grid: string;
  ticks: string;
  axisText: string;
  cursor1: string;
  cursor2: string;
  /** Text color drawn on top of cursor handles. */
  cursorHandleText: string;
  /** Graticule-matched accent tone for the t=0 trigger reference (issue #61). */
  triggerAccent: string;
  /** Per-channel trace strokes; keys are channel tags (A, B, C, D). */
  traces: Record<string, string>;
  /** Fallback stroke for unknown channel names. */
  traceFallback: string;
}

/** Default Dark OLED theme (architecture.md §4.1 standard palette). */
export const DARK_THEME: ThemePalette = {
  background: "#000000",
  grid: "#222222",
  ticks: "#333333",
  axisText: "#888888",
  cursor1: "#E040FB",
  cursor2: "#B0B0B0",
  cursorHandleText: "#000000",
  triggerAccent: "#555555",
  traces: {
    A: "#FFD700",
    B: "#00BFFF",
    C: "#FF4500",
    D: "#00FF7F",
  },
  traceFallback: "#00BFFF",
};

/**
 * Light/Lab theme: white canvas with high-contrast graticule and
 * contrast-adapted trace strokes (issue #38 acceptance: darkened
 * yellow/amber, dodger blue, crimson, forest green; Channel B revised by
 * issue #145).
 */
export const LIGHT_THEME: ThemePalette = {
  background: "#FFFFFF",
  grid: "#C8C8C8",
  ticks: "#ADADAD",
  axisText: "#555555",
  cursor1: "#6A1B9A",
  cursor2: "#4B5563",
  cursorHandleText: "#FFFFFF",
  triggerAccent: "#888888",
  traces: {
    A: "#B8860B",
    // Issue #145: dodger blue replaces navy (#00008B), which was easily
    // confused with the C1 cursor purple (#6A1B9A) and invisible on the
    // dark toolbar chrome. #1E90FF keeps Channel B blue, holds 3.24:1 on
    // the white canvas, 6.04:1 on dark chrome, and sits far from C1.
    B: "#1E90FF",
    C: "#B22222",
    D: "#228B22",
  },
  traceFallback: "#1E90FF",
};

export const THEME_PALETTES: Record<ViewportTheme, ThemePalette> = {
  dark: DARK_THEME,
  light: LIGHT_THEME,
};

export function resolveThemePalette(theme: ViewportTheme): ThemePalette {
  return THEME_PALETTES[theme] ?? DARK_THEME;
}

/**
 * Resolves the trace stroke for a channel under a theme. Accepts both bare
 * tags ("A") and labeled names ("Input A"), mirroring channelPalette's
 * lookup rules.
 */
export function resolveTraceColor(
  theme: ViewportTheme,
  channelName: string,
): string {
  const palette = resolveThemePalette(theme);
  const clean = channelName.replace(/^Input\s+/i, "");
  return palette.traces[clean] ?? palette.traceFallback;
}

// ---------------------------------------------------------------------------
// User-configurable palette (issue #40): individual channel traces and
// measurement cursors can override the theme defaults.
// ---------------------------------------------------------------------------

/** Entries of the palette a user may customize (issue #40). */
export type PaletteKey = "A" | "B" | "C" | "D" | "C1" | "C2";

export const PALETTE_KEYS: readonly PaletteKey[] = [
  "A",
  "B",
  "C",
  "D",
  "C1",
  "C2",
];

export type CustomColors = Partial<Record<PaletteKey, string>>;

/** Normalizes a channel tag from a bare tag or "Input X" channel name. */
export function channelTag(channelName: string): string {
  return channelName.replace(/^Input\s+/i, "");
}

/** Returns the theme-default color for a palette key (issue #40 baseline). */
export function defaultColorForKey(
  theme: ViewportTheme,
  key: PaletteKey,
): string {
  const palette = resolveThemePalette(theme);
  if (key === "C1") return palette.cursor1;
  if (key === "C2") return palette.cursor2;
  return palette.traces[key] ?? palette.traceFallback;
}

/** Accepts #RGB or #RRGGBB hex colors (case-insensitive). */
export function isHexColor(value: unknown): value is string {
  return (
    typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
  );
}

/**
 * Effective color for a palette key: a user override when set (rendered as
 * authored in both themes), otherwise the theme default.
 */
export function effectiveColorForKey(
  theme: ViewportTheme,
  customColors: CustomColors,
  key: PaletteKey,
): string {
  const custom = customColors[key];
  if (isHexColor(custom)) return custom;
  return defaultColorForKey(theme, key);
}

/**
 * Effective trace stroke for a channel under a theme with user overrides.
 * Accepts bare tags ("A") and labeled names ("Input A").
 */
export function effectiveTraceColor(
  theme: ViewportTheme,
  customColors: CustomColors,
  channelName: string,
): string {
  const tag = channelTag(channelName);
  if ((PALETTE_KEYS as readonly string[]).includes(tag)) {
    return effectiveColorForKey(theme, customColors, tag as PaletteKey);
  }
  return resolveTraceColor(theme, channelName);
}

/** Effective cursor color for C1/C2 under a theme with user overrides. */
export function effectiveCursorColor(
  theme: ViewportTheme,
  customColors: CustomColors,
  cursorId: "C1" | "C2",
): string {
  return effectiveColorForKey(theme, customColors, cursorId);
}
