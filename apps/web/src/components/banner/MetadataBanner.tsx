/**
 * Metadata banner component (issue #11): top inspection strip displayed
 * when a capture is loaded. Displays file name, capture date/time, physical
 * channel count, samples per channel, timebase, per-channel vertical lines
 * (issue #103, when the capture carries unit metadata), and the trigger
 * reference badge (issue #61 wording with explanatory tooltip).
 *
 * Issue #207 restructures the banner into two fixed rows: a header row
 * (brand logo, capture filename, "Open file…", GitHub link pinned to the
 * top-right corner) above a waveform-information row (the metric fields,
 * whose internal wrapping behavior is unchanged). The rows are separated
 * by spacing only.
 *
 * Issue #208 completes the header row with the shared `fvf • viewer` brand
 * lockup (pixel-identical to the landing page): clicking it discards the
 * loaded capture and returns to the landing page without confirmation. A
 * thin vertical divider separates the lockup from the slightly dimmed,
 * slightly smaller filename.
 */

import React from "react";
import type { ParsedCapture } from "../../types/capture";
import { buildMetadataModel } from "./metadataModel";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useViewportStore } from "../../state/viewportStore";
import { useThemeStore } from "../../state/themeStore";
import { usePaletteStore } from "../../state/paletteStore";
import { effectiveTraceColor } from "../canvas/themePalette";
import {
  GITHUB_REPOSITORY_URL,
  GithubCircleIcon,
} from "../branding/brandAssets";
import { BrandLockup } from "../branding/BrandLockup";

export interface MetadataBannerProps {
  capture: ParsedCapture;
  fileName: string | null;
  onOpenFile?: () => void;
  /** Issue #208: activates the brand lockup's back-to-landing affordance. */
  onReturnToLanding?: () => void;
}

export default function MetadataBanner({
  capture,
  fileName,
  onOpenFile,
  onReturnToLanding,
}: MetadataBannerProps) {
  const customNames = useChannelNamesStore((state) => state.names);
  const selectedChannel = useViewportStore((state) => state.selectedChannel);
  const theme = useThemeStore((state) => state.theme);
  const customColors = usePaletteStore((state) => state.customColors);
  const model = buildMetadataModel(capture, fileName, customNames);

  return (
    <header className="metadata-banner" aria-label="Capture metadata inspector">
      <div className="banner-top-row">
        <div className="banner-primary-group">
          <BrandLockup
            onActivate={onReturnToLanding}
            className="banner-lockup"
          />
          <div className="banner-divider" aria-hidden="true" />
          <div className="banner-filename" title={model.fileName}>
            <span className="banner-filename-text">{model.fileName}</span>
          </div>
          {onOpenFile ? (
            <button
              type="button"
              className="banner-open-btn"
              onClick={onOpenFile}
              aria-label="Open capture file"
            >
              Open file…
            </button>
          ) : null}
        </div>

        <a
          className="banner-github"
          href={GITHUB_REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub repository"
          data-testid="banner-github"
        >
          <GithubCircleIcon className="github-icon" />
        </a>
      </div>

      <div className="banner-metrics">
        <div className="banner-field banner-field-date" data-field="date">
          <span className="banner-field-label">Date/Time</span>
          <span className="banner-field-value">{model.captureDate}</span>
        </div>

        <div
          className="banner-field banner-field-timebase"
          data-field="timebase"
        >
          <span className="banner-field-label">Timebase</span>
          <span className="banner-field-value">{model.timebaseRaw}</span>
        </div>

        <div
          className="banner-field banner-field-channels"
          data-field="channels"
        >
          <span className="banner-field-label">Channels</span>
          <span className="banner-field-value">
            {model.physicalChannelsLabel}
            {model.physicalChannels.length > 0 ? (
              <span className="banner-channel-names">
                {" "}
                (
                {model.physicalChannels.map((c, i) => {
                  const isSelected = c.name === selectedChannel;
                  const color = effectiveTraceColor(
                    theme,
                    customColors,
                    c.name,
                  );
                  return (
                    <React.Fragment key={c.name}>
                      {i > 0 ? ", " : ""}
                      <span
                        className={
                          isSelected ? "banner-channel-selected" : undefined
                        }
                        style={{ color }}
                        title={c.tooltip}
                      >
                        {c.name}
                      </span>
                    </React.Fragment>
                  );
                })}
                )
              </span>
            ) : null}
          </span>
        </div>

        {model.samplesPerChannelText !== null ? (
          <div
            className="banner-field banner-field-samples"
            data-field="samples"
          >
            <span className="banner-field-label">Samples</span>
            <span className="banner-field-value">
              {model.samplesPerChannelText}
            </span>
          </div>
        ) : null}

        {model.physicalChannels.some((c) => c.verticalLine !== null) ? (
          <div
            className="banner-field banner-field-vertical"
            data-field="vertical"
          >
            <span className="banner-field-label">Vertical</span>
            <span className="banner-field-value">
              {model.physicalChannels
                .filter((c) => c.verticalLine !== null)
                .map((c, i) => {
                  const color = effectiveTraceColor(
                    theme,
                    customColors,
                    c.name,
                  );
                  return (
                    <React.Fragment key={c.name}>
                      {i > 0 ? "  " : ""}
                      <span style={{ color }} title={c.tooltip}>
                        {c.name}
                      </span>
                      : {c.perDivText}
                    </React.Fragment>
                  );
                })}
            </span>
          </div>
        ) : null}

        {model.derivedChannels.length > 0 ? (
          <div
            className="banner-field banner-field-derived"
            data-field="derived"
          >
            <span className="banner-field-label">Derived</span>
            <span className="banner-field-value">
              {model.derivedChannels
                .map((d) => `${d.label} (${d.formattedSamples})`)
                .join(", ")}
            </span>
          </div>
        ) : null}

        <div
          className="banner-field banner-field-trigger"
          data-field="trigger"
          title={model.triggerReferenceTooltip}
        >
          <span className="banner-field-label">Trigger</span>
          <span className="banner-field-value">
            {model.triggerReferenceValue}
          </span>
        </div>
      </div>
    </header>
  );
}
