/**
 * Popover quick knobs (issue #204): the popover body's always-visible
 * safety nets — opacity preset chips under a subtle uppercase micro-label
 * (no section title), the dual-canvas preview stroked with the exact
 * color + opacity over both theme backgrounds, and the advisory
 * low-contrast guard. Precision tools live in the collapsible color
 * detail, not here.
 *
 * Issue #227: cursor popovers preview a *vertical cursor line* (the
 * object whose color/opacity is being judged) over a muted neutral mock
 * waveform; channel popovers keep the waveform-stroke preview, because a
 * channel's colored object is the trace itself.
 */

import {
  resolveThemePalette,
  type PaletteKey,
  type ViewportTheme,
} from "../../canvas/themePalette";
import { usePaletteStore } from "../../../state/paletteStore";
import { isLowContrastOnDark, previewStroke } from "./colorMath";

/** Deterministic decorative mini-waveform (preview only). */
const WAVE_PATH = (() => {
  const points: string[] = ["M0,30"];
  for (let x = 6; x <= 138; x += 6) {
    const y =
      22 + 12 * Math.sin(x / 11) * Math.cos(x / 4.7) + (x % 24 === 0 ? -8 : 0);
    points.push(`L${x},${y.toFixed(1)}`);
  }
  return points.join(" ");
})();

/**
 * Muted mock-waveform grays per preview panel (issue #227): deliberately
 * low-contrast neutrals (~2:1 against their panel background) so the
 * cursor-popover background wave can never be mistaken for a channel
 * trace preview — the element under evaluation is the cursor line.
 */
const MOCK_WAVE_GRAY: Record<ViewportTheme, string> = {
  dark: "#3f3f3f",
  light: "#a9a9a9",
};

/**
 * Tiny handle glyph at the top of the preview cursor line, echoing the
 * on-canvas cursor handle shape (a rounded-bottom tab; the canvas renders
 * it solid while the line carries the per-key opacity).
 */
const CURSOR_HANDLE_PATH = "M62 0h14v6a2 2 0 0 1-2 2h-10a2 2 0 0 1-2-2Z";

export const OPACITY_PRESETS: readonly number[] = [25, 50, 75, 100];

export interface QuickKnobsProps {
  /** Preview object: channels stroke the trace, cursors draw a line (issue #227). */
  kind: "channel" | "cursor";
  paletteKey: PaletteKey;
  color: string;
  opacity: number;
}

export function QuickKnobs({
  kind,
  paletteKey,
  color,
  opacity,
}: QuickKnobsProps) {
  const setKeyOpacity = usePaletteStore((s) => s.setKeyOpacity);
  const stroke = previewStroke(color, opacity);
  const darkBackground = resolveThemePalette("dark").background;
  const lightBackground = resolveThemePalette("light").background;
  const lowContrast = isLowContrastOnDark(color);

  return (
    <div className="badge-quick-knobs">
      <div className="badge-opacity-presets">
        <span className="badge-microlabel">Opacity</span>
        {OPACITY_PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className="badge-opacity-chip"
            data-testid={`opacity-chip-${preset}`}
            aria-pressed={opacity === preset}
            aria-label={`Set opacity to ${preset} percent`}
            onClick={() => setKeyOpacity(paletteKey, preset)}
          >
            {preset}%
          </button>
        ))}
      </div>
      <div className="badge-preview" data-testid="dual-canvas-preview">
        <div
          className="badge-preview-canvas badge-preview-canvas--dark"
          style={{ background: darkBackground }}
        >
          <svg viewBox="0 0 138 44" preserveAspectRatio="none">
            {kind === "cursor" ? (
              <>
                <path
                  className="badge-preview-mockwave"
                  d={WAVE_PATH}
                  fill="none"
                  strokeWidth={1.5}
                  stroke={MOCK_WAVE_GRAY.dark}
                />
                <line
                  className="badge-preview-cursor-line"
                  data-testid="cursor-preview-line"
                  x1={69}
                  y1={0}
                  x2={69}
                  y2={44}
                  strokeWidth={2}
                  stroke={stroke}
                />
                <path
                  className="badge-preview-cursor-handle"
                  data-testid="cursor-preview-handle"
                  d={CURSOR_HANDLE_PATH}
                  fill={color}
                />
              </>
            ) : (
              <path
                className="badge-preview-wave"
                d={WAVE_PATH}
                fill="none"
                strokeWidth={1.5}
                stroke={stroke}
              />
            )}
          </svg>
          <span className="badge-preview-caption">dark canvas</span>
        </div>
        <div
          className="badge-preview-canvas badge-preview-canvas--light"
          style={{ background: lightBackground }}
        >
          <svg viewBox="0 0 138 44" preserveAspectRatio="none">
            {kind === "cursor" ? (
              <>
                <path
                  className="badge-preview-mockwave"
                  d={WAVE_PATH}
                  fill="none"
                  strokeWidth={1.5}
                  stroke={MOCK_WAVE_GRAY.light}
                />
                <line
                  className="badge-preview-cursor-line"
                  data-testid="cursor-preview-line"
                  x1={69}
                  y1={0}
                  x2={69}
                  y2={44}
                  strokeWidth={2}
                  stroke={stroke}
                />
                <path
                  className="badge-preview-cursor-handle"
                  data-testid="cursor-preview-handle"
                  d={CURSOR_HANDLE_PATH}
                  fill={color}
                />
              </>
            ) : (
              <path
                className="badge-preview-wave"
                d={WAVE_PATH}
                fill="none"
                strokeWidth={1.5}
                stroke={stroke}
              />
            )}
          </svg>
          <span className="badge-preview-caption">light canvas</span>
        </div>
      </div>
      <div
        className={`badge-contrast-warn${lowContrast ? " badge-contrast-warn--show" : ""}`}
        role="status"
        data-testid="low-contrast-warning"
      >
        ⚠ Low contrast against the dark canvas — the trace may be hard to see.
      </div>
    </div>
  );
}
