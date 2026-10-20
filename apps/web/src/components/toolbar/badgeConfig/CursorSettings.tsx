/**
 * Cursor display settings sections (issue #226): the measurement display
 * units (one *global* selection — the HUD readout card is a single shared
 * surface — surfaced identically in both cursor popovers) and the
 * per-cursor C1/C2 line style. Rendered in the cursor popover body only.
 */

import { useEffect, useState } from "react";
import type uPlot from "uplot";
import { useCaptureStore } from "../../../state/captureStore";
import { useViewportStore } from "../../../state/viewportStore";
import { useCursorStore } from "../../../state/cursorStore";
import { useChannelNamesStore } from "../../../state/channelNamesStore";
import {
  useZoomHistoryStore,
  createViewportSnapshot,
} from "../../../state/zoomHistoryStore";
import { findNearestSampleIndex } from "../../cursors/cursorPlugin";
import { getLookahead, type FeatureType } from "../../navigation/featureSearch";
import {
  useCursorDisplayStore,
  type CursorBinding,
  type FrequencyUnit,
  type LineStyle,
  type TimeUnit,
  type VoltageUnit,
} from "../../../state/cursorDisplayStore";

interface UnitOption<T extends string> {
  value: T;
  label: string;
  /** Stable testid suffix, e.g. `time-ms`. */
  key: string;
}

const TIME_OPTIONS: readonly UnitOption<TimeUnit>[] = [
  { value: "auto", label: "SI", key: "si" },
  { value: "s", label: "s", key: "s" },
  { value: "ms", label: "ms", key: "ms" },
  { value: "µs", label: "µs", key: "us" },
  { value: "ns", label: "ns", key: "ns" },
];

const FREQUENCY_OPTIONS: readonly UnitOption<FrequencyUnit>[] = [
  { value: "auto", label: "1/Δt", key: "one-over-dt" },
  { value: "Hz", label: "Hz", key: "hz" },
  { value: "kHz", label: "kHz", key: "khz" },
  { value: "MHz", label: "MHz", key: "mhz" },
];

const VOLTAGE_OPTIONS: readonly UnitOption<VoltageUnit>[] = [
  { value: "auto", label: "SI", key: "si" },
  { value: "V", label: "V", key: "v" },
  { value: "mV", label: "mV", key: "mv" },
  { value: "dBV", label: "dBV", key: "dbv" },
];

const LINE_STYLE_OPTIONS: readonly UnitOption<LineStyle>[] = [
  { value: "solid", label: "Solid", key: "solid" },
  { value: "dashed", label: "Dashed", key: "dashed" },
  { value: "dotted", label: "Dotted", key: "dotted" },
];

function SettingChip<T extends string>({
  domain,
  option,
  selected,
  onSelect,
}: {
  domain: string;
  option: UnitOption<T>;
  selected: boolean;
  onSelect: (value: T) => void;
}) {
  return (
    <button
      type="button"
      className="badge-opacity-chip badge-setting-chip"
      data-testid={`setting-${domain}-${option.key}`}
      aria-pressed={selected}
      aria-label={`${domain}: ${option.label}`}
      onClick={() => onSelect(option.value)}
    >
      {option.label}
    </button>
  );
}

/**
 * Global measurement display units: three domain rows (time, frequency,
 * voltage) writing one shared store state from either cursor popover.
 */
export function MeasurementUnitsSection() {
  const timeUnit = useCursorDisplayStore((s) => s.timeUnit);
  const frequencyUnit = useCursorDisplayStore((s) => s.frequencyUnit);
  const voltageUnit = useCursorDisplayStore((s) => s.voltageUnit);
  const setTimeUnit = useCursorDisplayStore((s) => s.setTimeUnit);
  const setFrequencyUnit = useCursorDisplayStore((s) => s.setFrequencyUnit);
  const setVoltageUnit = useCursorDisplayStore((s) => s.setVoltageUnit);

  return (
    <div
      className="badge-settings-section"
      data-testid="measurement-units-section"
    >
      <span className="badge-microlabel">Measurement units</span>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Time</span>
        {TIME_OPTIONS.map((option) => (
          <SettingChip
            key={option.key}
            domain="time"
            option={option}
            selected={timeUnit === option.value}
            onSelect={setTimeUnit}
          />
        ))}
      </div>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Frequency</span>
        {FREQUENCY_OPTIONS.map((option) => (
          <SettingChip
            key={option.key}
            domain="frequency"
            option={option}
            selected={frequencyUnit === option.value}
            onSelect={setFrequencyUnit}
          />
        ))}
      </div>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Voltage</span>
        {VOLTAGE_OPTIONS.map((option) => (
          <SettingChip
            key={option.key}
            domain="voltage"
            option={option}
            selected={voltageUnit === option.value}
            onSelect={setVoltageUnit}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Channel source binding (issue #225): binds this cursor to one physical
 * channel (the HUD readout card then filters its measurements to it) or
 * leaves it unbound ("All channels"). Reference channels (#96) extend the
 * option list when dual-file comparison ships.
 */
export function ChannelBindingSection({ cursorId }: { cursorId: "C1" | "C2" }) {
  const binding = useCursorDisplayStore((s) => s.bindings[cursorId]);
  const setBinding = useCursorDisplayStore((s) => s.setBinding);
  const capture = useCaptureStore((s) => s.capture);
  const channelTags = (capture?.channels ?? [])
    .filter((channel) => !channel.derived)
    .map((channel) => channel.name);

  const options: Array<{ value: CursorBinding; label: string; key: string }> = [
    { value: "all", label: "All", key: "all" },
    ...channelTags.map((tag) => ({
      value: tag as CursorBinding,
      label: tag,
      key: tag.toLowerCase(),
    })),
  ];

  return (
    <div
      className="badge-settings-section"
      data-testid="channel-binding-section"
    >
      <span className="badge-microlabel">Channel source · {cursorId}</span>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Source</span>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className="badge-opacity-chip badge-setting-chip"
            data-testid={`setting-binding-${option.key}`}
            aria-pressed={binding === option.value}
            aria-label={`Channel source ${cursorId}: ${option.label}`}
            onClick={() => setBinding(cursorId, option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Locked Δt tracking (issue #225): one pair-level shared setting — both
 * cursor popovers toggle the same state, and while locked any cursor move
 * (drag, keyboard, mousewheel) slides both cursors by the same sample
 * delta, preserving the separation exactly.
 */
export function LockedDeltaSection() {
  const deltaLocked = useCursorDisplayStore((s) => s.deltaLocked);
  const setDeltaLocked = useCursorDisplayStore((s) => s.setDeltaLocked);

  return (
    <div className="badge-settings-section" data-testid="locked-delta-section">
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Locked Δt</span>
        <button
          type="button"
          className="badge-opacity-chip badge-setting-chip"
          data-testid="setting-delta-lock"
          aria-pressed={deltaLocked}
          aria-label="Locked delta-t: move both cursors together"
          title="While locked, moving either cursor slides both by the same sample delta (Δt preserved)"
          onClick={() => setDeltaLocked(!deltaLocked)}
        >
          {deltaLocked ? "Locked" : "Unlocked"}
        </button>
      </div>
    </div>
  );
}

const FEATURE_OPTIONS: readonly {
  value: FeatureType;
  label: string;
  key: string;
}[] = [
  { value: "rising", label: "Rising", key: "rising" },
  { value: "falling", label: "Falling", key: "falling" },
  { value: "peak", label: "Peak", key: "peak" },
  { value: "valley", label: "Valley", key: "valley" },
  { value: "saturation", label: "Saturation", key: "saturation" },
];

const FEATURE_NAMES: Record<FeatureType, string> = {
  rising: "rising edge",
  falling: "falling edge",
  peak: "peak",
  valley: "valley",
  saturation: "saturated sample",
};

/**
 * Feature jump navigation section (issue #314): channel-bound stepper
 * jumping C1/C2 to the next or previous rising edge, falling edge, peak,
 * valley, or saturated sample with zero layout shift and screen-reader announcements.
 */
export function CursorFeatureJumpSection({
  cursorId,
}: {
  cursorId: "C1" | "C2";
}) {
  const capture = useCaptureStore((s) => s.capture);
  const binding = useCursorDisplayStore((s) => s.bindings[cursorId]);
  const feature = useCursorDisplayStore((s) => s.findFeatures[cursorId]);
  const setFindFeature = useCursorDisplayStore((s) => s.setFindFeature);
  const activeChannels = useViewportStore((s) => s.activeChannels);
  const xMin = useViewportStore((s) => s.xMin);
  const xMax = useViewportStore((s) => s.xMax);
  const customNames = useChannelNamesStore((s) => s.names);

  const c1Active = useCursorStore((s) => s.c1Active);
  const c2Active = useCursorStore((s) => s.c2Active);
  const c1SampleIndex = useCursorStore((s) => s.c1SampleIndex);
  const c2SampleIndex = useCursorStore((s) => s.c2SampleIndex);
  const jumpCursorToSample = useCursorStore((s) => s.jumpCursorToSample);

  const [jumpAnnouncement, setJumpAnnouncement] = useState<string | null>(null);

  const isChannelHidden =
    binding !== "all" && !activeChannels.includes(binding);

  useEffect(() => {
    setJumpAnnouncement(null);
  }, [binding, feature, cursorId, isChannelHidden]);

  // Conditional visibility: only render if binding !== "all" and bound channel exists in capture
  if (binding === "all" || !capture) {
    return null;
  }

  const boundChannel = capture.channels.find(
    (c) => !c.derived && c.name === binding,
  );
  if (!boundChannel) {
    return null;
  }

  const channelDisplayLabel = customNames[binding] ?? binding;

  const isTargetActive = cursorId === "C1" ? c1Active : c2Active;
  const targetSampleIndex = cursorId === "C1" ? c1SampleIndex : c2SampleIndex;
  const timestamps = capture.timestamps;
  const totalSamples = timestamps.length;
  const t0 = timestamps[0] ?? 0;
  const tEnd = timestamps[totalSamples - 1] ?? 0;
  const curMin = xMin ?? t0;
  const curMax = xMax ?? tEnd;

  let startIndex: number;
  if (isTargetActive) {
    startIndex = targetSampleIndex;
  } else if (totalSamples > 0) {
    const centerTime = (curMin + curMax) / 2;
    startIndex = findNearestSampleIndex(timestamps, centerTime);
  } else {
    startIndex = 0;
  }

  const { prevResult, nextResult } = getLookahead(
    timestamps,
    boundChannel.data,
    capture,
    binding,
    feature,
    startIndex,
    !isChannelHidden,
  );

  const handleJump = (direction: "prev" | "next") => {
    const target = direction === "prev" ? prevResult : nextResult;
    if (!target || totalSamples <= 0) return;

    const container = document.querySelector(
      "[data-testid='oscilloscope-container'], .oscilloscope-container",
    ) as
      | (HTMLElement & {
          __uplot?: uPlot;
          __preStack?: Map<string, { min: number; max: number }>;
        })
      | null;

    const uplotInstance = container?.__uplot;
    const liveXMin = uplotInstance?.scales?.x?.min ?? curMin;
    const liveXMax = uplotInstance?.scales?.x?.max ?? curMax;
    const fullSpan = tEnd - t0;
    const curSpan = liveXMax - liveXMin;

    if (curSpan < fullSpan) {
      let newMin = target.timestamp - curSpan / 2;
      let newMax = target.timestamp + curSpan / 2;
      if (newMin < t0) {
        newMin = t0;
        newMax = Math.min(tEnd, t0 + curSpan);
      } else if (newMax > tEnd) {
        newMax = tEnd;
        newMin = Math.max(t0, tEnd - curSpan);
      }

      if (uplotInstance) {
        uplotInstance.batch(() => {
          uplotInstance.setScale("x", { min: newMin, max: newMax });
        });
      }
      useViewportStore.getState().setBounds({ xMin: newMin, xMax: newMax });

      if (uplotInstance && container) {
        const snapshot = createViewportSnapshot(
          uplotInstance,
          container.__preStack,
        );
        if (snapshot) {
          useZoomHistoryStore.getState().push(snapshot);
        }
      }
    }

    jumpCursorToSample(cursorId, target.index, totalSamples);

    // Check lookahead after landing at target index
    const lookaheadAfter = getLookahead(
      timestamps,
      boundChannel.data,
      capture,
      binding,
      feature,
      target.index,
      !isChannelHidden,
    );
    const boundaryReached =
      direction === "next"
        ? lookaheadAfter.nextResult === null
        : lookaheadAfter.prevResult === null;

    if (boundaryReached) {
      setJumpAnnouncement(
        `Moved ${cursorId} to sample ${target.index} (no further ${FEATURE_NAMES[feature]} in this direction)`,
      );
    } else {
      setJumpAnnouncement(`Moved ${cursorId} to sample ${target.index}`);
    }
  };

  let srStatusText: string;
  if (jumpAnnouncement) {
    srStatusText = jumpAnnouncement;
  } else if (isChannelHidden) {
    srStatusText = `Channel ${channelDisplayLabel} is hidden`;
  } else if (prevResult === null && nextResult === null) {
    srStatusText = `No ${FEATURE_NAMES[feature]} found on channel ${channelDisplayLabel}`;
  } else if (prevResult === null) {
    srStatusText = `No earlier ${FEATURE_NAMES[feature]} on channel ${channelDisplayLabel}`;
  } else if (nextResult === null) {
    srStatusText = `No further ${FEATURE_NAMES[feature]} on channel ${channelDisplayLabel}`;
  } else {
    srStatusText = `${FEATURE_NAMES[feature]} available in both directions`;
  }

  const srId = `cursor-find-status-sr-${cursorId}`;

  return (
    <div
      className="badge-settings-section"
      data-testid="cursor-feature-jump-section"
    >
      <span className="badge-microlabel">
        Jump to feature · Channel {channelDisplayLabel}
      </span>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Feature</span>
        {FEATURE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className="badge-opacity-chip badge-setting-chip"
            data-testid={`setting-feature-${option.key}`}
            aria-pressed={feature === option.value}
            aria-label={`Feature ${cursorId}: ${option.label}`}
            onClick={() => {
              setFindFeature(cursorId, option.value);
              setJumpAnnouncement(null);
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div
        className="badge-setting-row"
        role="group"
        aria-label={`Jump stepper · ${cursorId}`}
        aria-describedby={srId}
      >
        <span className="badge-setting-domain">Jump</span>
        <button
          type="button"
          className="badge-opacity-chip badge-setting-chip"
          data-testid="cursor-find-prev-btn"
          aria-label={
            isChannelHidden
              ? `Channel ${channelDisplayLabel} is hidden`
              : prevResult === null
                ? `No earlier ${FEATURE_NAMES[feature]} on channel ${channelDisplayLabel}`
                : `Find previous ${FEATURE_NAMES[feature]} on channel ${channelDisplayLabel}`
          }
          title={
            isChannelHidden
              ? `Channel ${channelDisplayLabel} is hidden`
              : prevResult === null
                ? `No earlier ${FEATURE_NAMES[feature]} on channel ${channelDisplayLabel}`
                : `Find previous ${FEATURE_NAMES[feature]}`
          }
          aria-describedby={srId}
          disabled={isChannelHidden || prevResult === null}
          onClick={() => handleJump("prev")}
        >
          ◀ Prev
        </button>
        <button
          type="button"
          className="badge-opacity-chip badge-setting-chip"
          data-testid="cursor-find-next-btn"
          aria-label={
            isChannelHidden
              ? `Channel ${channelDisplayLabel} is hidden`
              : nextResult === null
                ? `No further ${FEATURE_NAMES[feature]} on channel ${channelDisplayLabel}`
                : `Find next ${FEATURE_NAMES[feature]} on channel ${channelDisplayLabel}`
          }
          title={
            isChannelHidden
              ? `Channel ${channelDisplayLabel} is hidden`
              : nextResult === null
                ? `No further ${FEATURE_NAMES[feature]} on channel ${channelDisplayLabel}`
                : `Find next ${FEATURE_NAMES[feature]}`
          }
          aria-describedby={srId}
          disabled={isChannelHidden || nextResult === null}
          onClick={() => handleJump("next")}
        >
          Next ▶
        </button>
      </div>
      <span
        id={srId}
        data-testid="cursor-find-status-sr"
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        {srStatusText}
      </span>
    </div>
  );
}

/** Per-cursor line style (solid / dashed / dotted), independent per C1/C2. */
export function LineStyleSection({ cursorId }: { cursorId: "C1" | "C2" }) {
  const lineStyle = useCursorDisplayStore((s) => s.lineStyles[cursorId]);
  const setLineStyle = useCursorDisplayStore((s) => s.setLineStyle);

  return (
    <div className="badge-settings-section" data-testid="line-style-section">
      <span className="badge-microlabel">Line style · {cursorId}</span>
      <div className="badge-setting-row">
        <span className="badge-setting-domain">Style</span>
        {LINE_STYLE_OPTIONS.map((option) => (
          <SettingChip
            key={option.key}
            domain="line-style"
            option={option}
            selected={lineStyle === option.value}
            onSelect={(style) => setLineStyle(cursorId, style)}
          />
        ))}
      </div>
    </div>
  );
}
