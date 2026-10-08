/**
 * PNG export options popover (issue #252): the configuration surface of
 * the split-action Export chip — theme (dark screen / light print),
 * background (opaque / transparent alpha), readout card (full /
 * collapsed / excluded), cursor and graticule inclusion, and a custom
 * download filename. Built on the shared anchored-portal primitive
 * (viewport collision handling, single-open mutual exclusivity with the
 * channel/cursor popovers, role=dialog non-modal, initial focus, Esc
 * closes); the settings live in the persisted pngExportStore — one
 * source of truth for the download and clipboard paths. Stays as light
 * as the cursor popover: no live image preview.
 */

import {
  PNG_FILE_NAME_MAX_LENGTH,
  sanitizeFileNameDraft,
  usePngExportStore,
  type PngExportBackground,
  type PngExportReadoutCard,
  type PngExportTheme,
} from "../../state/pngExportStore";
import { AnchoredPopover } from "../toolbar/badgeConfig/anchoredPopover";
import { useCaptureStore } from "../../state/captureStore";

const EXPORT_POPOVER_KEY = "png-export";

/** One option row's setting chips. */
function OptionChips<T extends string | boolean>(props: {
  label: string;
  options: Array<{ value: T; label: string; testId: string }>;
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="badge-setting-row">
      <span className="badge-setting-domain png-export-domain">
        {props.label}
      </span>
      <div
        className="badge-setting-chips"
        role="group"
        aria-label={props.label}
      >
        {props.options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className="badge-opacity-chip badge-setting-chip"
            aria-pressed={props.value === option.value}
            data-testid={option.testId}
            onClick={() => props.onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PngExportPopover(props: {
  anchorEl: HTMLElement | null;
  onClose: (refocusAnchor: boolean) => void;
}) {
  const settings = usePngExportStore((s) => s.settings);
  const setTheme = usePngExportStore((s) => s.setTheme);
  const setBackground = usePngExportStore((s) => s.setBackground);
  const setReadoutCard = usePngExportStore((s) => s.setReadoutCard);
  const setCursors = usePngExportStore((s) => s.setCursors);
  const setGrid = usePngExportStore((s) => s.setGrid);
  const setFileName = usePngExportStore((s) => s.setFileName);
  const captureFileName = useCaptureStore((s) => s.fileName);

  return (
    <AnchoredPopover
      openKey={EXPORT_POPOVER_KEY}
      anchorEl={props.anchorEl}
      ariaLabel="PNG export options"
      testId="png-export-popover"
      onClose={props.onClose}
    >
      <div className="badge-popover-hero">
        <div className="badge-hero-text">
          <h4 className="badge-static-title">PNG export</h4>
          <p className="badge-stats" data-testid="png-export-summary">
            Snapshot &amp; print configuration
          </p>
        </div>
        <button
          type="button"
          className="badge-popover-close"
          aria-label="Close"
          data-testid="png-popover-close"
          onClick={() => props.onClose(true)}
        >
          ✕
        </button>
      </div>
      <div className="badge-popover-body">
        <div
          className="badge-settings-section"
          data-testid="png-export-section"
        >
          <OptionChips<PngExportTheme>
            label="Theme"
            value={settings.theme}
            onSelect={setTheme}
            options={[
              {
                value: "dark",
                label: "Dark (screen)",
                testId: "png-theme-dark",
              },
              {
                value: "light",
                label: "Light (print)",
                testId: "png-theme-light",
              },
            ]}
          />
          <OptionChips<PngExportBackground>
            label="Background"
            value={settings.background}
            onSelect={setBackground}
            options={[
              { value: "opaque", label: "Opaque", testId: "png-bg-opaque" },
              {
                value: "transparent",
                label: "Transparent",
                testId: "png-bg-transparent",
              },
            ]}
          />
          <OptionChips<PngExportReadoutCard>
            label="Readout card"
            value={settings.readoutCard}
            onSelect={setReadoutCard}
            options={[
              { value: "full", label: "Full", testId: "png-card-full" },
              {
                value: "collapsed",
                label: "Collapsed",
                testId: "png-card-collapsed",
              },
              {
                value: "excluded",
                label: "Excluded",
                testId: "png-card-excluded",
              },
            ]}
          />
          <OptionChips<boolean>
            label="Cursors"
            value={settings.cursors}
            onSelect={setCursors}
            options={[
              { value: true, label: "Include", testId: "png-cursors-include" },
              { value: false, label: "Exclude", testId: "png-cursors-exclude" },
            ]}
          />
          <OptionChips<boolean>
            label="Grid"
            value={settings.grid}
            onSelect={setGrid}
            options={[
              { value: true, label: "Include", testId: "png-grid-include" },
              { value: false, label: "Exclude", testId: "png-grid-exclude" },
            ]}
          />
          <div className="badge-setting-row">
            <span className="badge-setting-domain png-export-domain">
              Filename
            </span>
            <div className="badge-ghost-field">
              <input
                type="text"
                className="badge-name-input"
                maxLength={PNG_FILE_NAME_MAX_LENGTH}
                placeholder={
                  captureFileName ? `${captureFileName}-snapshot` : "snapshot"
                }
                value={settings.fileName}
                aria-label="Custom download filename (empty uses the derived capture name)"
                data-testid="png-filename-field"
                onChange={(event) => {
                  // Live commit into the same store both export paths read
                  // (the channel custom-name field mechanics); the .png
                  // extension is appended at download time.
                  setFileName(sanitizeFileNameDraft(event.target.value));
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </AnchoredPopover>
  );
}

export { EXPORT_POPOVER_KEY };
