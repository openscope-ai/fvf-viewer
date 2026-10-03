/**
 * Badge configuration popover (issue #204): the anchored per-key popover
 * assembled from composable sections — hero identity (color square with
 * pencil toggle, ghost name field / static cursor title, stats line),
 * quick knobs (opacity presets, dual-canvas preview, low-contrast guard),
 * and the collapsible color detail (swatch matrix, native picker, hex
 * entry, precise opacity scrub, ↺ reset). Cursor popovers add the
 * movement hint footer. Deferred features arrive as additional sections.
 */

import { useState } from "react";
import {
  effectiveColorForKey,
  effectiveOpacityForKey,
  type PaletteKey,
} from "../../canvas/themePalette";
import { usePaletteStore } from "../../../state/paletteStore";
import { useThemeStore } from "../../../state/themeStore";
import { CURSOR_MOVEMENT_SUMMARY } from "../../cursors/cursorHelp";
import { HeroIdentity } from "./HeroIdentity";
import { QuickKnobs } from "./QuickKnobs";
import { ColorDetail } from "./ColorDetail";

export type BadgeConfigTarget =
  | { kind: "channel"; paletteKey: PaletteKey; channelName: string }
  | { kind: "cursor"; paletteKey: "C1" | "C2" };

export interface BadgeConfigPopoverProps {
  target: BadgeConfigTarget;
  onClose: () => void;
}

export function BadgeConfigPopover({
  target,
  onClose,
}: BadgeConfigPopoverProps) {
  const theme = useThemeStore((s) => s.theme);
  const customColors = usePaletteStore((s) => s.customColors);
  const keyConfigs = usePaletteStore((s) => s.keyConfigs);
  const [detailOpen, setDetailOpen] = useState(false);

  const key = target.paletteKey;
  const color = effectiveColorForKey(theme, customColors, key);
  const opacity = effectiveOpacityForKey(keyConfigs, key);

  return (
    <>
      <HeroIdentity
        kind={target.kind}
        paletteKey={key}
        channelName={target.kind === "channel" ? target.channelName : undefined}
        color={color}
        opacity={opacity}
        detailOpen={detailOpen}
        onToggleDetail={() => setDetailOpen((open) => !open)}
        onClose={onClose}
      />
      <div className="badge-popover-body">
        <QuickKnobs paletteKey={key} color={color} opacity={opacity} />
        {detailOpen && (
          <ColorDetail paletteKey={key} color={color} opacity={opacity} />
        )}
        {target.kind === "cursor" && (
          <p className="badge-popover-hint" data-testid="cursor-movement-hint">
            {CURSOR_MOVEMENT_SUMMARY}
          </p>
        )}
      </div>
    </>
  );
}
