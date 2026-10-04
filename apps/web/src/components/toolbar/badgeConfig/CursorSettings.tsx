/**
 * Cursor display settings sections (issue #226): the measurement display
 * units (one *global* selection — the HUD readout card is a single shared
 * surface — surfaced identically in both cursor popovers) and the
 * per-cursor C1/C2 line style. Rendered in the cursor popover body only.
 */

import { useCaptureStore } from "../../../state/captureStore";
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
