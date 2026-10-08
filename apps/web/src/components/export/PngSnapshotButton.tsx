/**
 * Toolbar PNG snapshot control (issue #18, overview §5.2-E): runs the
 * offscreen compositing exporter registered by the live Oscilloscope and
 * downloads the resulting high-resolution PNG. Nothing is uploaded (ADR 0006).
 *
 * Issue #252: the control is an M3 split-action chip — the main zone
 * exports immediately with the current settings; a trailing gear opens
 * the options popover (theme / background / readout card / cursors /
 * grid / filename) built on the anchored-portal primitive. The
 * standalone "Invert for print" checkbox is gone: the popover's theme
 * option drives the same print pass. The copy control (issue #158)
 * keeps its placement and behavior and reads the same settings.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useCaptureStore } from "../../state/captureStore";
import { useSnapshotStore } from "./snapshotStore";
import { isCanvasReadbackAllowed } from "./canvasPermission";
import CanvasBlockedModal from "../modals/CanvasBlockedModal";
import { snapshotFileName } from "./exportFileName";
import { usePngExportStore } from "../../state/pngExportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";
import { GearIcon } from "../toolbar/badgeConfig/icons";
import PngExportPopover, { EXPORT_POPOVER_KEY } from "./PngExportPopover";

/** Image clipboard writes require ClipboardItem + clipboard.write (secure context). */
export function supportsImageClipboard(): boolean {
  return (
    typeof ClipboardItem !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.write === "function"
  );
}

/** Iconoir `copy` icon (icon-only, no text label — issue #158). */
export function CopyIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4C3.46957 15 2.96086 14.7893 2.58579 14.4142C2.21071 14.0391 2 13.5304 2 13V4C2 3.46957 2.21071 2.96086 2.58579 2.58579C2.96086 2.21071 3.46957 2 4 2H13C13.5304 2 14.0391 2.21071 14.4142 2.58579C14.7893 2.96086 15 3.46957 15 4V5" />
    </svg>
  );
}

/** Iconoir `check` icon (transient copied feedback — issue #158). */
export function CheckIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      stroke="currentColor"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M7 12.5L10.5 16L17 9" />
    </svg>
  );
}

/** How long the copied ✓ state stays visible before reverting to the copy icon. */
const COPIED_FEEDBACK_MS = 1600;

/** Resolves the download filename: custom name (with .png) or the derived capture name. */
export function exportDownloadName(
  custom: string,
  captureFileName: string | null,
): string {
  const trimmed = custom.trim();
  if (!trimmed) return snapshotFileName(captureFileName);
  const stem = trimmed.replace(/\.png$/i, "");
  return `${stem || "snapshot"}.png`;
}

export default function PngSnapshotButton() {
  const exporter = useSnapshotStore((state) => state.exporter);
  const fileName = useCaptureStore((state) => state.fileName);
  const settings = usePngExportStore((state) => state.settings);
  const [exporting, setExporting] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const [showBlockedModal, setShowBlockedModal] = useState(false);
  const gearRef = useRef<HTMLButtonElement | null>(null);
  const openKey = useBadgePopoverStore((state) => state.openKey);
  const setOpen = useBadgePopoverStore((state) => state.setOpen);
  const popoverOpen = openKey === EXPORT_POPOVER_KEY;

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  const handleExport = useCallback(async () => {
    if (!exporter || exporting) return;
    if (!isCanvasReadbackAllowed()) {
      setShowBlockedModal(true);
      return;
    }
    setExporting(true);
    try {
      const blob = await exporter(settings);
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = exportDownloadName(settings.fileName, fileName);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      // Export failures (compositing or toBlob) must not surface as
      // unhandled promise rejections; the button re-arms for a retry.
      console.error("[png-export] snapshot export failed", error);
    } finally {
      setExporting(false);
    }
  }, [exporter, exporting, settings, fileName]);

  const handleCopy = useCallback(async () => {
    if (!exporter || exporting || copied) return;
    if (!isCanvasReadbackAllowed()) {
      setShowBlockedModal(true);
      return;
    }
    setExporting(true);
    try {
      // Same settings as the download path (theme/background/card/
      // cursors/grid); the clipboard write ignores the filename option.
      const blob = await exporter(settings);
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setCopied(true);
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
      copiedTimer.current = window.setTimeout(
        () => setCopied(false),
        COPIED_FEEDBACK_MS,
      );
    } catch (error) {
      // Clipboard writes can be rejected (document not focused, permission
      // denied); surface in the console and re-arm like the download path.
      console.error("[png-export] clipboard copy failed", error);
    } finally {
      setExporting(false);
    }
  }, [exporter, exporting, copied, settings]);

  const disabled = !exporter || exporting;

  return (
    <>
      <span className="png-export-controls">
        <span
          className={`png-export-chip${popoverOpen ? " png-export-chip--open" : ""}`}
          role="group"
          aria-label="Export PNG and its options"
        >
          <button
            type="button"
            className="waveform-png-button"
            disabled={disabled}
            aria-label="Export high-resolution PNG snapshot of the waveform with the current settings"
            title="Export high-resolution PNG snapshot of the waveform with the current settings"
            data-testid="png-export-button"
            onClick={handleExport}
          >
            {exporting ? "Exporting…" : "Export PNG"}
          </button>
          <span className="badge-split-divider" aria-hidden="true" />
          <button
            type="button"
            ref={gearRef}
            className="png-export-gear"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={popoverOpen}
            aria-label="PNG export options"
            title="PNG export options"
            data-testid="png-export-gear"
            onClick={() => {
              setOpen(popoverOpen ? null : EXPORT_POPOVER_KEY);
            }}
          >
            <GearIcon size={13} />
          </button>
        </span>
        {supportsImageClipboard() && (
          <button
            type="button"
            className={`png-copy-button${copied ? " png-copy-button--copied" : ""}`}
            disabled={disabled}
            aria-label="Copy PNG snapshot to clipboard"
            title="Copy PNG snapshot to clipboard"
            data-testid="png-copy-button"
            onClick={handleCopy}
          >
            {copied ? (
              <CheckIcon className="copy-icon" />
            ) : (
              <CopyIcon className="copy-icon" />
            )}
          </button>
        )}
      </span>
      <PngExportPopover
        anchorEl={gearRef.current}
        onClose={(refocusAnchor) => {
          setOpen(null);
          if (refocusAnchor) gearRef.current?.focus();
        }}
      />
      {showBlockedModal && (
        <CanvasBlockedModal onDismiss={() => setShowBlockedModal(false)} />
      )}
    </>
  );
}

export { snapshotFileName };
