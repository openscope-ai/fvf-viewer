/**
 * Popover hero header (issue #204, "Rich Header"): large color square with
 * the effective trace color at the chosen opacity over a checkerboard plus
 * a luminance-aware pencil toggle for the color detail, the M3 ghost/flat
 * channel name field (or the cursor's static title), the read-only
 * monospace stats line, and the close affordance.
 */

import {
  CHANNEL_NAME_MAX_LENGTH,
  useChannelNamesStore,
} from "../../../state/channelNamesStore";
import { useCaptureStore } from "../../../state/captureStore";
import { useCursorStore } from "../../../state/cursorStore";
import { channelStatsLine, cursorPositionLine } from "./stats";
import { useCursorDisplayStore } from "../../../state/cursorDisplayStore";
import {
  CHECKERBOARD_CSS,
  CHECKERBOARD_SIZE,
  pencilOverlayColor,
} from "./colorMath";
import { rgbaFromHex } from "../../canvas/themePalette";
import { PencilIcon } from "./icons";
import { useChannelDisplayStore } from "../../../state/channelDisplayStore";
import { findChannelByName } from "../../../state/referenceStore";

export interface HeroIdentityProps {
  kind: "channel" | "cursor";
  /** Palette key: channel tag (A–D) or cursor id (C1/C2). */
  paletteKey: string;
  /** Capture channel name for channel heroes (store lookup key). */
  channelName?: string;
  color: string;
  opacity: number;
  detailOpen: boolean;
  onToggleDetail: () => void;
  onClose: () => void;
}

function GhostNameField({ channelName }: { channelName: string }) {
  const custom = useChannelNamesStore((s) => s.names[channelName]);
  const setName = useChannelNamesStore((s) => s.setName);
  return (
    <div className="badge-ghost-field">
      <input
        type="text"
        className="badge-name-input"
        maxLength={CHANNEL_NAME_MAX_LENGTH}
        placeholder={`Channel ${channelName}`}
        defaultValue={custom ?? ""}
        aria-label={`Custom name for channel ${channelName}`}
        data-testid="popover-name-field"
        onChange={(event) => {
          // Live commit into the same store the double-click inline
          // rename writes (uncontrolled input: store trims never fight
          // the cursor).
          setName(channelName, event.target.value);
        }}
      />
    </div>
  );
}

export function HeroIdentity({
  kind,
  paletteKey,
  channelName,
  color,
  opacity,
  detailOpen,
  onToggleDetail,
  onClose,
}: HeroIdentityProps) {
  const capture = useCaptureStore((s) => s.capture);
  const cursorSample = useCursorStore((s) =>
    paletteKey === "C1" ? s.c1SampleIndex : s.c2SampleIndex,
  );
  // Issue #226: the position line's timestamp follows the global time
  // display unit selected in the cursor popovers.
  const timeUnit = useCursorDisplayStore((s) => s.timeUnit);
  // Issue #224: invert ± flips the hero extents consistently with the
  // displayed trace, so the stats line re-renders on display changes.
  const displayRevision = useChannelDisplayStore((s) => s.keyConfigs);

  let stats: string;
  if (kind === "channel") {
    // Issue #96: reference channels (Ref-A…) resolve against File 2.
    const resolved = findChannelByName(channelName ?? "");
    const channel = resolved?.channel;
    const unit = resolved
      ? resolved.capture.metadata.channels[resolved.index]?.unit
      : undefined;
    void displayRevision; // re-render trigger for the inverted extents
    stats = channelStatsLine(channel, unit);
  } else {
    stats = cursorPositionLine(cursorSample, capture?.timestamps, timeUnit);
  }

  const effective = rgbaFromHex(color, opacity);

  return (
    <div className="badge-popover-hero">
      <button
        type="button"
        className="badge-hero-swatch"
        data-testid="hero-color-square"
        aria-label="Expand color detail"
        aria-expanded={detailOpen}
        title="Edit color"
        onClick={onToggleDetail}
        style={{
          background: `linear-gradient(${effective}, ${effective}), ${CHECKERBOARD_CSS}`,
          backgroundSize: `100% 100%, ${CHECKERBOARD_SIZE}`,
        }}
      >
        <PencilIcon color={pencilOverlayColor(color, opacity)} />
      </button>
      <div className="badge-hero-text">
        {kind === "channel" ? (
          <GhostNameField channelName={channelName ?? paletteKey} />
        ) : (
          <h4 className="badge-static-title">Cursor {paletteKey}</h4>
        )}
        <p
          className="badge-stats"
          data-testid={kind === "channel" ? "channel-stats" : "cursor-stats"}
        >
          {stats}
        </p>
      </div>
      <button
        type="button"
        className="badge-popover-close"
        aria-label="Close"
        data-testid="popover-close"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
