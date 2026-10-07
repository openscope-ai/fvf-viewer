/**
 * Channel display settings section (issue #224): the channel popover's
 * Display controls — Y-scale % display gain (scrub field + 100% reset
 * chip + the derived read-only ≈ unit/Div readout), the vertical offset
 * (axis-unit readout + scrub field + reset-to-0; the shared store face
 * of #98's Ctrl+drag and ground-marker reset), and the invert ± polarity
 * toggle. The Solo quick-knob lives beside the opacity presets in the
 * quick-knobs area (QuickKnobs), not here. Rendered in the channel
 * popover body only.
 */

import { useEffect, useRef, useState } from "react";
import type uPlot from "uplot";
import {
  DEFAULT_OFFSET,
  isChannelKey,
  DEFAULT_Y_SCALE_PERCENT,
  MAX_Y_SCALE_PERCENT,
  MIN_Y_SCALE_PERCENT,
  OFFSET_PX_PER_UNIT,
  Y_SCALE_PX_PER_PERCENT,
  displayKeyForChannel,
  effectiveOffset,
  effectiveYScale,
  formatPerDiv,
  effectivePerDiv,
} from "../../canvas/channelDisplay";
import type { PaletteKey } from "../../canvas/themePalette";
import { useChannelDisplayStore } from "../../../state/channelDisplayStore";
import {
  channelScaleKeyFor,
  findChannelByName,
} from "../../../state/referenceStore";
import {
  getPhysicalChannelUnit,
  splitUnit,
} from "../../../capture/channelUnits";

/** Drag distance (px) before a press becomes a scrub. */
const SCRUB_ACTIVATION_PX = 3;

interface ScrubFieldProps {
  testidPrefix: string;
  ariaLabel: string;
  unitSuffix: string;
  value: number;
  min?: number;
  max?: number;
  step: number;
  /** Display units per N px of horizontal drag. */
  pxPerUnit: number;
  scrubStep: number;
  onCommit: (value: number) => void;
}

/**
 * The #204 scrub-field control pattern (steppers, drag-to-scrub,
 * click-to-type), parameterized for the #224 display scalars.
 */
function ScrubField({
  testidPrefix,
  ariaLabel,
  unitSuffix,
  value,
  min,
  max,
  step,
  pxPerUnit,
  scrubStep,
  onCommit,
}: ScrubFieldProps) {
  const zoneRef = useRef<HTMLSpanElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState<string | null>(null);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const zone = zoneRef.current;
    if (!zone) return;
    let pointerId: number | null = null;
    let startX = 0;
    let startValue = 0;
    let dragging = false;
    const onPointerDown = (event: PointerEvent) => {
      if (document.activeElement === inputRef.current) return; // typing mode
      pointerId = event.pointerId;
      dragging = false;
      startX = event.clientX;
      startValue = valueRef.current;
      zone.setPointerCapture(pointerId);
      event.preventDefault();
    };
    const onPointerMove = (event: PointerEvent) => {
      if (pointerId === null) return;
      const dx = event.clientX - startX;
      if (!dragging && Math.abs(dx) > SCRUB_ACTIVATION_PX) dragging = true;
      if (dragging) {
        commitRef.current(startValue + Math.round(dx / pxPerUnit) * scrubStep);
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
  }, [pxPerUnit, scrubStep]);

  return (
    <div
      className="badge-opacity-control"
      role="group"
      aria-label={ariaLabel}
      data-testid={`${testidPrefix}-scrub-field`}
    >
      <button
        type="button"
        className="badge-opacity-step"
        data-testid={`${testidPrefix}-step-down`}
        aria-label={`Decrease by ${step}`}
        onClick={() => onCommit(value - step)}
      >
        −
      </button>
      <span className="badge-opacity-scrub" ref={zoneRef}>
        <input
          ref={inputRef}
          type="number"
          min={min}
          max={max}
          step={1}
          value={text ?? String(value)}
          aria-label={`${ariaLabel}, drag to scrub or type exact value`}
          data-testid={`${testidPrefix}-scrub-input`}
          onChange={(event) => {
            setText(event.target.value);
            const parsed = Number(event.target.value);
            if (event.target.value !== "" && Number.isFinite(parsed)) {
              onCommit(parsed);
            }
          }}
          onBlur={() => setText(null)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              onCommit(value + 1);
              setText(null);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              onCommit(value - 1);
              setText(null);
            }
          }}
        />
        <span className="badge-opacity-unit">{unitSuffix}</span>
      </span>
      <button
        type="button"
        className="badge-opacity-step"
        data-testid={`${testidPrefix}-step-up`}
        aria-label={`Increase by ${step}`}
        onClick={() => onCommit(value + step)}
      >
        +
      </button>
    </div>
  );
}

/** Resolves the live uPlot handle the Oscilloscope parks on its container. */
function liveUplot(): uPlot | null {
  const container = document.querySelector(
    "[data-testid='oscilloscope-container']",
  );
  const handle = (container as (HTMLElement & { __uplot?: uPlot }) | null)
    ?.__uplot;
  return handle ?? null;
}

/** Plot height in CSS px (u.bbox is device px). */
function plotHeightCss(u: uPlot): number {
  const instancePxRatio = u.width > 0 ? u.ctx.canvas.width / u.width : 1;
  return u.bbox.height / instancePxRatio;
}

export interface ChannelDisplaySectionProps {
  paletteKey: PaletteKey;
  channelName: string;
}

export function ChannelDisplaySection({
  paletteKey,
  channelName,
}: ChannelDisplaySectionProps) {
  const keyConfigs = useChannelDisplayStore((s) => s.keyConfigs);
  const setYScale = useChannelDisplayStore((s) => s.setYScale);
  const setOffset = useChannelDisplayStore((s) => s.setOffset);
  const setInverted = useChannelDisplayStore((s) => s.setInverted);

  const key =
    displayKeyForChannel(channelName) ??
    (isChannelKey(paletteKey) ? paletteKey : "A");
  const yScale = effectiveYScale(keyConfigs, key);
  const offset = effectiveOffset(keyConfigs, key);
  const inverted = keyConfigs[key]?.inverted === true;

  // The offset is expressed in the channel's own axis unit (volts for the
  // volt channels; "V readout" in the issue text is the volt-channel
  // case), resolved across both slots (issue #96: Ref-X reads File 2).
  const resolved = findChannelByName(channelName);
  const scaleKey = channelScaleKeyFor(channelName);
  const unit = resolved
    ? splitUnit(getPhysicalChannelUnit(resolved.capture, resolved.index)).base
    : "V";

  // Derived read-only ≈ unit/Div readout: recomputed on render (scale%
  // changes re-render) and re-read from the live plot on a short interval
  // while mounted so viewport zooms keep it tracking (uPlot scale changes
  // of non-selected channels carry no store event to subscribe to).
  const perDivRef = useRef<HTMLSpanElement | null>(null);
  const perDivTick = useRef<(() => void) | null>(null);
  const renderPerDiv = (): void => {
    const el = perDivRef.current;
    if (!el) return;
    const u = liveUplot();
    if (!u || !scaleKey) {
      el.textContent = "—";
      return;
    }
    const scale = scaleKey ? u.scales[scaleKey] : undefined;
    const perDiv = effectivePerDiv(
      scale?.min ?? Number.NaN,
      scale?.max ?? Number.NaN,
      plotHeightCss(u),
      yScale,
    );
    el.textContent = Number.isFinite(perDiv)
      ? `≈ ${formatPerDiv(perDiv, unit)}`
      : "—";
  };
  perDivTick.current = renderPerDiv;
  useEffect(() => {
    perDivTick.current?.();
    const id = window.setInterval(() => perDivTick.current?.(), 250);
    return () => window.clearInterval(id);
  }, [yScale, unit, scaleKey]);

  return (
    <div
      className="badge-settings-section"
      data-testid="channel-display-section"
    >
      <span className="badge-microlabel">Display</span>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Y-scale</span>
        <ScrubField
          testidPrefix="scale"
          ariaLabel="Y-scale percent"
          unitSuffix="%"
          value={yScale}
          min={MIN_Y_SCALE_PERCENT}
          max={MAX_Y_SCALE_PERCENT}
          step={5}
          pxPerUnit={Y_SCALE_PX_PER_PERCENT}
          scrubStep={1}
          onCommit={(value) => setYScale(key, value)}
        />
        <button
          type="button"
          className="badge-opacity-chip badge-setting-chip"
          data-testid="scale-reset-chip"
          aria-label="Reset Y-scale to 100 percent"
          onClick={() => setYScale(key, DEFAULT_Y_SCALE_PERCENT)}
        >
          100%
        </button>
      </div>
      <div className="badge-setting-row">
        <span
          className="badge-setting-domain"
          title="Derived from the current viewport geometry ÷ scale"
        >
          Per div
        </span>
        <span
          className="badge-perdiv-readout"
          data-testid="perdiv-readout"
          ref={perDivRef}
        >
          —
        </span>
      </div>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Offset</span>
        <ScrubField
          testidPrefix="offset"
          ariaLabel={`Vertical offset in ${unit}`}
          unitSuffix={unit}
          value={offset}
          step={1}
          pxPerUnit={OFFSET_PX_PER_UNIT}
          scrubStep={1}
          onCommit={(value) => setOffset(key, value)}
        />
        <button
          type="button"
          className="badge-opacity-chip badge-setting-chip"
          data-testid="offset-reset"
          aria-label={`Reset offset to 0 ${unit}`}
          onClick={() => setOffset(key, DEFAULT_OFFSET)}
        >
          0 {unit}
        </button>
      </div>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Invert</span>
        <button
          type="button"
          className="badge-opacity-chip badge-setting-chip"
          data-testid="invert-toggle"
          aria-pressed={inverted}
          aria-label="Invert polarity (multiply displayed trace and readouts by minus one)"
          onClick={() => setInverted(key, !inverted)}
        >
          ± {inverted ? "On" : "Off"}
        </button>
      </div>
    </div>
  );
}
