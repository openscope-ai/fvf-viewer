/**
 * Anchored popover primitive (issue #204): one reusable portal-based
 * surface owning trigger geometry, viewport collision (flip above near the
 * bottom, right-anchor near the right edge), and a single `openKey`
 * enforcing mutually exclusive popovers. Deferred popover features arrive
 * as additional content sections; the growth path is reserved here.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";

interface OpenKeyState {
  /** The single open popover's key; null when all are closed. */
  openKey: string | null;
  setOpen: (openKey: string | null) => void;
}

/**
 * Module-level single-open store: opening one popover dismisses any other,
 * regardless of which badge rendered it.
 */
export const useBadgePopoverStore = create<OpenKeyState>((set) => ({
  openKey: null,
  setOpen: (openKey) => set({ openKey }),
}));

/** Gap between the anchor and the popover, px. */
const ANCHOR_GAP_PX = 10;
/** Popover must stay this far inside the viewport edges, px. */
const VIEWPORT_MARGIN_PX = 12;

export interface AnchoredPopoverProps {
  /** Identity under the single-open store for this popover. */
  openKey: string;
  /** The trigger element whose geometry the popover anchors to. */
  anchorEl: HTMLElement | null;
  /** Accessible name for the dialog. */
  ariaLabel: string;
  /**
   * Closes the popover; `refocusAnchor` requests focus return to the gear
   * (keyboard dismissal) as opposed to outside-pointer dismissal.
   */
  onClose: (refocusAnchor: boolean) => void;
  children: React.ReactNode;
}

interface Placement {
  top: number;
  left?: number;
  right?: number;
  flipped: boolean;
  anchoredRight: boolean;
}

export function AnchoredPopover({
  openKey,
  anchorEl,
  ariaLabel,
  onClose,
  children,
}: AnchoredPopoverProps) {
  const open = useBadgePopoverStore((s) => s.openKey) === openKey;
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);

  // Measure once on open and resolve viewport collisions: flip above when
  // the popover would overflow the bottom (and room exists above),
  // right-anchor when it would overflow the right edge.
  useLayoutEffect(() => {
    if (!open || !anchorEl) return;
    setPlacement(null);
    const popover = popoverRef.current;
    if (!popover) return;
    const anchorRect = anchorEl.getBoundingClientRect();
    const rect = popover.getBoundingClientRect();
    const flipped =
      rect.bottom > window.innerHeight - VIEWPORT_MARGIN_PX &&
      anchorRect.top - ANCHOR_GAP_PX > rect.height;
    const anchoredRight = rect.right > window.innerWidth - VIEWPORT_MARGIN_PX;
    setPlacement({
      top: flipped
        ? anchorRect.top - ANCHOR_GAP_PX - rect.height
        : anchorRect.bottom + ANCHOR_GAP_PX,
      ...(anchoredRight
        ? { right: window.innerWidth - anchorRect.right }
        : { left: anchorRect.left }),
      flipped,
      anchoredRight,
    });
  }, [open, anchorEl]);

  // Initial focus lands on the first interactive element — only after the
  // placement style commits (focusing a still-hidden element is a no-op).
  useLayoutEffect(() => {
    if (!open || !placement) return;
    const popover = popoverRef.current;
    if (!popover) return;
    const focusables = popover.querySelectorAll<HTMLElement>(
      "button, input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    focusables[0]?.focus();
  }, [open, placement]);

  // Outside pointerdown (capture) dismisses without refocusing the gear;
  // clicks on the anchor itself toggle through the gear's own handler.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (anchorEl?.contains(target)) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, anchorEl, onClose]);

  if (!open || !anchorEl) return null;

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-modal="false"
      aria-label={ariaLabel}
      tabIndex={-1}
      className={[
        "badge-popover",
        placement?.flipped ? "badge-popover--flip" : "",
        placement?.anchoredRight ? "badge-popover--anchor-r" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      data-testid="badge-config-popover"
      style={{
        top: placement ? placement.top : -9999,
        left: placement?.left,
        right: placement?.right,
        visibility: placement ? undefined : "hidden",
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        // Esc blurs a focused field first (fields roll back their drafts
        // on blur); the next Esc dismisses and returns focus to the gear.
        event.stopPropagation();
        event.preventDefault();
        const active = document.activeElement as HTMLElement | null;
        if (
          active &&
          active.tagName === "INPUT" &&
          popoverRef.current?.contains(active)
        ) {
          active.blur();
          return;
        }
        onClose(true);
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
