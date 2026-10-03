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
import {
  CHECKERBOARD_CSS,
  CHECKERBOARD_SIZE,
  pencilOverlayColor,
} from "./colorMath";
import { rgbaFromHex } from "../../canvas/themePalette";
import { PencilIcon } from "./icons";

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

  let stats: string;
  if (kind === "channel") {
    const channel = capture?.channels.find((c) => c.name === channelName);
    const index = channel ? capture!.channels.indexOf(channel) : -1;
    const unit =
      index >= 0 ? capture!.metadata.channels[index]?.unit : undefined;
    stats = channelStatsLine(channel, unit);
  } else {
    stats = cursorPositionLine(cursorSample, capture?.timestamps);
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
