/**
 * Palette settings panel (issues #40/#59): per-channel (A-D) and cursor
 * (C1/C2) rows streamlined to a label, an active color chip, and a reset
 * action. Clicking a chip expands a single-open inline accordion with a
 * curated high-contrast swatch matrix, a validated hex input, and a native
 * color picker. Colors apply live through the palette store (waveform and
 * cursors update in place while the accordion stays open); overrides
 * persist across browser sessions and reset per-row or globally
 * ("Reset to Default Palette" restores the architecture.md §4.1 palette).
 */

import { useState } from "react";
import {
  PALETTE_KEYS,
  effectiveColorForKey,
  isHexColor,
  type PaletteKey,
} from "../canvas/themePalette";
import { usePaletteStore } from "../../state/paletteStore";
import { useThemeStore } from "../../state/themeStore";

/**
 * Curated swatch matrix (issue #59): 30 high-contrast engineering
 * instrument colors readable on both dark OLED and light lab backgrounds —
 * classic scope trace hues plus violet/magenta cursor tones, neutrals, and
 * primary extremes.
 */
export const CURATED_SWATCHES: readonly string[] = [
  "#FFD700",
  "#FFA500",
  "#FF4500",
  "#FF4444",
  "#DC143C",
  "#FF1493",
  "#FF44FF",
  "#E040FB",
  "#9400D3",
  "#6A1B9A",
  "#6633FF",
  "#4444FF",
  "#00BFFF",
  "#1E90FF",
  "#00008B",
  "#44AAFF",
  "#00FFFF",
  "#00CED1",
  "#2E8B57",
  "#00FF7F",
  "#44FF44",
  "#228B22",
  "#9ACD32",
  "#ADFF2F",
  "#B8860B",
  "#FFFF00",
  "#F5F5F5",
  "#C8C8C8",
  "#888888",
  "#FFFFFF",
];

export function paletteKeyLabel(key: PaletteKey): string {
  return key.startsWith("C") ? `Cursor ${key}` : `Channel ${key}`;
}

export default function PaletteSettings({ className }: { className?: string }) {
  const theme = useThemeStore((state) => state.theme);
  const customColors = usePaletteStore((state) => state.customColors);
  const setCustomColor = usePaletteStore((state) => state.setCustomColor);
  const clearCustomColor = usePaletteStore((state) => state.clearCustomColor);
  const resetPalette = usePaletteStore((state) => state.resetPalette);

  const [open, setOpen] = useState(false);
  // Single-open accordion (issue #59): at most one expanded row; null
  // collapses everything.
  const [openKey, setOpenKey] = useState<PaletteKey | null>(null);
  // In-progress hex text drafts; valid values commit live, invalid drafts
  // roll back to the effective color on blur/Enter/collapse.
  const [hexDrafts, setHexDrafts] = useState<
    Partial<Record<PaletteKey, string>>
  >({});

  const draft = hexDrafts[openKey ?? "A"];
  const draftInvalid =
    openKey !== null && draft !== undefined && !isHexColor(draft);

  const handleHexChange = (key: PaletteKey, value: string) => {
    if (isHexColor(value)) {
      // Commit live and drop the draft so the input reflects the canonical
      // (lowercase) store value instead of the as-typed case.
      setCustomColor(key, value);
      rollbackHexDraft(key);
    } else {
      setHexDrafts((prev) => ({ ...prev, [key]: value }));
    }
  };

  const rollbackHexDraft = (key: PaletteKey) => {
    setHexDrafts((prev) => ({ ...prev, [key]: undefined }));
  };

  // Single-open switch: the outgoing row's invalid draft must not survive
  // its accordion collapsing.
  const toggleAccordion = (key: PaletteKey) => {
    if (openKey === key) {
      rollbackHexDraft(key);
      setOpenKey(null);
    } else {
      if (openKey !== null) rollbackHexDraft(openKey);
      setOpenKey(key);
    }
  };

  const handleHexKeyDown = (
    key: PaletteKey,
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      // Commit is already live for valid values; Enter finalizes and
      // releases focus. Invalid drafts roll back to the effective color.
      rollbackHexDraft(key);
      event.currentTarget.blur();
    }
  };

  const handleResetAll = () => {
    resetPalette();
    setHexDrafts({});
  };

  return (
    <div className={`palette-settings ${className ?? ""}`.trim()}>
      <button
        type="button"
        className="waveform-theme-button palette-settings-toggle"
        aria-label="Toggle color palette settings panel"
        aria-expanded={open}
        title="Channel and cursor color palette settings"
        data-testid="palette-settings-button"
        onClick={() => setOpen((value) => !value)}
      >
        Colors
      </button>
      {open && (
        <div
          className="palette-settings-panel"
          role="dialog"
          aria-label="Channel and cursor color palette settings"
          data-testid="palette-settings-panel"
          onKeyDown={(event) => {
            // Panel-scoped Escape: closes the open accordion regardless of
            // whether focus sits on a chip or inside the accordion.
            if (event.key === "Escape" && openKey !== null) {
              rollbackHexDraft(openKey);
              setOpenKey(null);
            }
          }}
        >
          {PALETTE_KEYS.map((key) => {
            const effective = effectiveColorForKey(theme, customColors, key);
            const isCustom = key in customColors;
            const expanded = openKey === key;
            return (
              <div key={key} className="palette-entry">
                <div className="palette-row" data-testid={`palette-row-${key}`}>
                  <span className="palette-row-label">
                    {paletteKeyLabel(key)}
                  </span>
                  <button
                    type="button"
                    className={`palette-chip${isCustom ? " palette-chip--custom" : ""}`}
                    style={{ backgroundColor: effective }}
                    aria-expanded={expanded}
                    aria-controls={`palette-accordion-${key}`}
                    aria-label={`${paletteKeyLabel(key)} color: ${effective}. Toggle advanced picker.`}
                    title={`${paletteKeyLabel(key)} color picker`}
                    data-testid={`palette-chip-${key}`}
                    onClick={() => toggleAccordion(key)}
                  />
                  <button
                    type="button"
                    className="palette-row-reset"
                    aria-label={`Reset ${paletteKeyLabel(key)} to theme default`}
                    title={`Reset ${paletteKeyLabel(key)} to theme default`}
                    data-testid={`palette-reset-${key}`}
                    disabled={!isCustom}
                    onClick={() => {
                      clearCustomColor(key);
                      rollbackHexDraft(key);
                      if (openKey === key) setOpenKey(null);
                    }}
                  >
                    ↺
                  </button>
                </div>
                {expanded && (
                  <div
                    id={`palette-accordion-${key}`}
                    className="palette-accordion"
                    role="region"
                    aria-label={`${paletteKeyLabel(key)} advanced color picker`}
                    data-testid={`palette-accordion-${key}`}
                  >
                    <div
                      className="palette-swatch-grid"
                      role="group"
                      aria-label={`${paletteKeyLabel(key)} curated swatch matrix`}
                      data-testid={`palette-swatch-grid-${key}`}
                    >
                      {CURATED_SWATCHES.map((color) => {
                        const active =
                          color.toLowerCase() === effective.toLowerCase();
                        return (
                          <button
                            key={color}
                            type="button"
                            aria-pressed={active}
                            className={`palette-grid-swatch${active ? " palette-grid-swatch--active" : ""}`}
                            style={{ backgroundColor: color }}
                            aria-label={`Apply ${color} to ${paletteKeyLabel(key)}`}
                            title={`Apply ${color}`}
                            data-testid={`palette-swatch-${key}-${color}`}
                            onClick={() => {
                              // Live preview: the store update re-styles the
                              // waveform/cursors in place; the accordion
                              // deliberately stays open for comparison.
                              setCustomColor(key, color);
                              rollbackHexDraft(key);
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="palette-accordion-controls">
                      <input
                        type="text"
                        className={`palette-hex${draftInvalid ? " palette-hex--invalid" : ""}`}
                        spellCheck={false}
                        maxLength={7}
                        placeholder="#RRGGBB"
                        aria-label={`${paletteKeyLabel(key)} hex color`}
                        aria-invalid={draftInvalid}
                        title={`${paletteKeyLabel(key)} hex color`}
                        data-testid={`palette-hex-${key}`}
                        value={draft ?? effective}
                        onChange={(event) =>
                          handleHexChange(key, event.target.value)
                        }
                        onBlur={() => rollbackHexDraft(key)}
                        onKeyDown={(event) => handleHexKeyDown(key, event)}
                      />
                      <input
                        type="color"
                        className="palette-picker"
                        aria-label={`${paletteKeyLabel(key)} native color picker`}
                        title="Native color picker (arbitrary shades)"
                        data-testid={`palette-color-${key}`}
                        value={isHexColor(effective) ? effective : "#000000"}
                        onChange={(event) => {
                          setCustomColor(key, event.target.value);
                          rollbackHexDraft(key);
                        }}
                      />
                      <button
                        type="button"
                        className="waveform-theme-button palette-accordion-done"
                        aria-label={`Close ${paletteKeyLabel(key)} picker`}
                        data-testid={`palette-done-${key}`}
                        onClick={() => {
                          rollbackHexDraft(key);
                          setOpenKey(null);
                        }}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="waveform-theme-button palette-reset-all"
            aria-label="Reset to Default Palette"
            title="Reset to Default Palette (architecture 4.1 standard colors)"
            data-testid="palette-reset-all"
            onClick={handleResetAll}
          >
            Reset to Default Palette
          </button>
        </div>
      )}
    </div>
  );
}
