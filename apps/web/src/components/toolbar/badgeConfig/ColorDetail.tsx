/**
 * Popover color detail (issue #204, expanded via the hero square): the
 * 30-swatch curated matrix in a 15-column grid plus the one-line footer —
 * native picker, content-width hex entry, the precise opacity scrub field
 * (steppers ±5 / drag-to-scrub / click + type, no slider), and the ↺
 * reset restoring the theme-default color AND 100% opacity in one action.
 */

import { useEffect, useRef, useState } from "react";
import {
  defaultColorForKey,
  effectiveOpacityForKey,
  expandHex,
  isHexColor,
  type PaletteKey,
  type ViewportTheme,
} from "../../canvas/themePalette";
import { usePaletteStore } from "../../../state/paletteStore";
import { useThemeStore } from "../../../state/themeStore";
import { CURATED_SWATCHES } from "./curatedSwatches";

/** Drag distance (px) before a press becomes a scrub. */
const SCRUB_ACTIVATION_PX = 3;
/** Opacity percent change per 4px of horizontal drag. */
const PX_PER_PERCENT = 4;

function OpacityScrubField({
  paletteKey,
  opacity,
}: {
  paletteKey: PaletteKey;
  opacity: number;
}) {
  const setKeyOpacity = usePaletteStore((s) => s.setKeyOpacity);
  const zoneRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Local display draft while typing; null mirrors the store value.
  const [text, setText] = useState<string | null>(null);

  const commit = (value: number) => setKeyOpacity(paletteKey, value);

  // Pointer-capture drag scrub: 3px click/drag disambiguation; a plain
  // click focuses + selects the input for typing instead.
  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    let pointerId: number | null = null;
    let startX = 0;
    let startValue = 100;
    let dragging = false;
    const onPointerDown = (event: PointerEvent) => {
      if (document.activeElement === inputRef.current) return; // typing mode
      pointerId = event.pointerId;
      dragging = false;
      startX = event.clientX;
      startValue = effectiveOpacityForKey(
        usePaletteStore.getState().keyConfigs,
        paletteKey,
      );
      zone.setPointerCapture(pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null) return;
      const dx = event.clientX - startX;
      if (!dragging && Math.abs(dx) > SCRUB_ACTIVATION_PX) dragging = true;
      if (dragging) {
        commit(startValue + Math.round(dx / PX_PER_PERCENT));
      }
    };
    const onPointerEnd = () => {
      if (pointerId === null) return;
      try {
        zone.releasePointerCapture(pointerId);
      } catch {
        // Pointer already released.
      }
      pointerId = null;
      if (!dragging) {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    zone.addEventListener("pointerdown", onPointerDown);
    zone.addEventListener("pointermove", onPointerMove);
    zone.addEventListener("pointerup", onPointerEnd);
    zone.addEventListener("pointercancel", onPointerEnd);
    return () => {
      zone.removeEventListener("pointerdown", onPointerDown);
      zone.removeEventListener("pointermove", onPointerMove);
      zone.removeEventListener("pointerup", onPointerEnd);
      zone.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [paletteKey]);

  return (
    <div
      className="badge-opacity-control"
      role="group"
      aria-label="Trace opacity percent"
      data-testid="opacity-scrub-field"
    >
      <button
        type="button"
        className="badge-opacity-step"
        data-testid="opacity-step-down"
        aria-label="Decrease opacity by 5"
        onClick={() => commit(opacity - 5)}
      >
        −
      </button>
      <span className="badge-opacity-scrub" ref={zoneRef}>
        <input
          ref={inputRef}
          type="number"
          min={5}
          max={100}
          step={1}
          value={text ?? String(opacity)}
          aria-label="Opacity percent, drag to scrub or type exact value"
          data-testid="opacity-scrub-input"
          onChange={(event) => {
            setText(event.target.value);
            const value = Number(event.target.value);
            if (event.target.value !== "" && Number.isFinite(value)) {
              commit(value);
            }
          }}
          onBlur={() => setText(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "ArrowUp") {
              // Keyboard stepping (the hidden spinner buttons leave no
              // affordance; arrows commit the same 1-step increments).
              event.preventDefault();
              commit(opacity + 1);
              setText(null);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              commit(opacity - 1);
              setText(null);
            }
          }}
        />
        <span className="badge-opacity-unit">%</span>
      </span>
      <button
        type="button"
        className="badge-opacity-step"
        data-testid="opacity-step-up"
        aria-label="Increase opacity by 5"
        onClick={() => commit(opacity + 5)}
      >
        +
      </button>
    </div>
  );
}

export interface ColorDetailProps {
  paletteKey: PaletteKey;
  color: string;
  opacity: number;
}

export function ColorDetail({ paletteKey, color, opacity }: ColorDetailProps) {
  const theme = useThemeStore((s) => s.theme) as ViewportTheme;
  const setCustomColor = usePaletteStore((s) => s.setCustomColor);
  const resetKey = usePaletteStore((s) => s.resetKey);

  // Hex draft state: valid values commit live (and the draft drops so the
  // input mirrors the canonical lowercase store value); invalid drafts
  // roll back to the effective color on blur/Enter.
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const hexInvalid = hexDraft !== null && !isHexColor(hexDraft);

  const handleHexChange = (value: string) => {
    if (isHexColor(value)) {
      setCustomColor(paletteKey, value);
      setHexDraft(null);
    } else {
      setHexDraft(value);
    }
  };
  const rollbackHex = () => setHexDraft(null);

  const atDefaults =
    color.toLowerCase() ===
      defaultColorForKey(theme, paletteKey).toLowerCase() && opacity === 100;

  return (
    <div className="badge-color-detail" data-testid="badge-color-detail">
      <div
        className="badge-swatch-grid"
        role="group"
        aria-label="Curated swatch matrix"
        data-testid="curated-swatch-grid"
      >
        {CURATED_SWATCHES.map((swatch) => {
          const active = swatch.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={swatch}
              type="button"
              className="badge-grid-swatch"
              data-testid={`config-swatch-${swatch}`}
              style={{ backgroundColor: swatch }}
              aria-pressed={active}
              aria-label={`Apply ${swatch}`}
              title={`Apply ${swatch}`}
              onClick={() => {
                setCustomColor(paletteKey, swatch);
                setHexDraft(null);
              }}
            />
          );
        })}
      </div>
      <div className="badge-color-detail-footer">
        <input
          type="color"
          className="badge-native-picker"
          data-testid="config-native-picker"
          value={isHexColor(color) ? expandHex(color) : "#000000"}
          aria-label="Native color picker (arbitrary shades)"
          title="Native color picker (arbitrary shades)"
          onChange={(event) => {
            setCustomColor(paletteKey, event.target.value);
            setHexDraft(null);
          }}
        />
        <input
          type="text"
          className={`badge-hex${hexInvalid ? " badge-hex--invalid" : ""}`}
          data-testid="config-hex"
          spellCheck={false}
          maxLength={7}
          placeholder="#RRGGBB"
          aria-label="Hex color"
          aria-invalid={hexInvalid}
          value={hexDraft ?? color}
          onChange={(event) => handleHexChange(event.target.value)}
          onBlur={rollbackHex}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
        <OpacityScrubField paletteKey={paletteKey} opacity={opacity} />
        <button
          type="button"
          className="badge-reset"
          data-testid="config-reset"
          aria-label="Reset color and opacity to defaults"
          title="Reset color and opacity to defaults"
          disabled={atDefaults}
          onClick={() => {
            resetKey(paletteKey);
            setHexDraft(null);
          }}
        >
          ↺
        </button>
      </div>
    </div>
  );
}
