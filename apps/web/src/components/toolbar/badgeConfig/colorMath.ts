/**
 * Badge-config color math (issue #204): helpers backing the hero color
 * square's luminance-aware pencil overlay and the dual-canvas preview's
 * low-contrast guard. Pure functions; hex parsing and relative luminance
 * live in themePalette.ts.
 */

import {
  hexRgb,
  relativeLuminance,
  rgbaFromHex,
} from "../../canvas/themePalette";

/** Subtle checkerboard under the hero square showing opacity. */
export const CHECKERBOARD_CSS =
  "conic-gradient(#2b2b2b 0 25%, #1f1f1f 0 50%, #2b2b2b 0 75%, #1f1f1f 0)";

/** Checkerboard cell size paired with the conic gradient above. */
export const CHECKERBOARD_SIZE = "8px 8px";

/** Average checkerboard tone the trace color blends over (0x25). */
const CHECKER_AVERAGE = 0x25;

/** Pencil picks near-black above this blended luminance, else near-white. */
const PENCIL_LUMINANCE_THRESHOLD = 0.45;

/** Effective color blended at the chosen opacity over the checker average. */
export function blendOverChecker(
  hex: string,
  opacityPercent: number,
): [number, number, number] {
  const alpha = Math.max(0, Math.min(100, opacityPercent)) / 100;
  const [r, g, b] = hexRgb(hex);
  return [
    r * alpha + CHECKER_AVERAGE * (1 - alpha),
    g * alpha + CHECKER_AVERAGE * (1 - alpha),
    b * alpha + CHECKER_AVERAGE * (1 - alpha),
  ];
}

function luminanceOfRgbTriple([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

/**
 * Contrasting pencil color for the hero square: near-black vs near-white
 * chosen by the WCAG relative luminance of the effective (opacity-blended
 * over checkerboard) color, so it stays legible on any swatch at any
 * opacity.
 */
export function pencilOverlayColor(
  hex: string,
  opacityPercent: number,
): string {
  return luminanceOfRgbTriple(blendOverChecker(hex, opacityPercent)) >
    PENCIL_LUMINANCE_THRESHOLD
    ? "rgba(0, 0, 0, 0.72)"
    : "rgba(255, 255, 255, 0.88)";
}

/** Trace stroke CSS for the preview canvases at the chosen opacity. */
export function previewStroke(hex: string, opacityPercent: number): string {
  return rgbaFromHex(hex, opacityPercent);
}

/**
 * Low-contrast guard threshold (advisory only, never blocks): the pure
 * trace color's luminance below which the dark-canvas warning shows.
 */
export const LOW_CONTRAST_LUMINANCE_THRESHOLD = 0.16;

/** Whether the low-contrast warning should show for this trace color. */
export function isLowContrastOnDark(hex: string): boolean {
  return relativeLuminance(hex) < LOW_CONTRAST_LUMINANCE_THRESHOLD;
}
