/**
 * Toolbar PNG snapshot control (issue #18, overview §5.2-E): runs the
 * offscreen compositing exporter registered by the live Oscilloscope and
 * downloads the resulting high-resolution PNG. Nothing is uploaded (ADR 0006).
 * Issue #39 adds an "Invert colors for print / white background" toggle that
 * renders the snapshot through the print-friendly offscreen pass while the
 * live on-screen viewport stays completely unchanged.
 */

import React, { useCallback, useState } from "react";
import { useCaptureStore } from "../../state/captureStore";
import { useSnapshotStore } from "./snapshotStore";
import { isCanvasReadbackAllowed } from "./canvasPermission";
import CanvasBlockedModal from "../modals/CanvasBlockedModal";
import { snapshotFileName } from "./exportFileName";

export default function PngSnapshotButton() {
  const exporter = useSnapshotStore((state) => state.exporter);
  const fileName = useCaptureStore((state) => state.fileName);
  const [exporting, setExporting] = useState(false);
  const [inverted, setInverted] = useState(false);
  const [showBlockedModal, setShowBlockedModal] = useState(false);

  const handleExport = useCallback(async () => {
    if (!exporter || exporting) return;
    if (!isCanvasReadbackAllowed()) {
      setShowBlockedModal(true);
      return;
    }
    setExporting(true);
    try {
      const blob = await exporter(inverted);
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = snapshotFileName(fileName);
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
  }, [exporter, exporting, inverted, fileName]);

  const disabled = !exporter || exporting;

  return (
    <>
      <span className="png-export-controls">
        <label className="png-invert-toggle">
          <input
            type="checkbox"
            checked={inverted}
            disabled={disabled}
            onChange={(event) => setInverted(event.target.checked)}
            aria-label="Invert colors for print / white background"
            title="Invert colors for print / white background"
            data-testid="png-invert-toggle"
          />
          <span>Invert for print</span>
        </label>
        <button
          type="button"
          className="waveform-png-button"
          disabled={disabled}
          aria-label="Export high-resolution PNG snapshot of the waveform"
          title="Export high-resolution PNG snapshot of the waveform"
          data-testid="png-export-button"
          onClick={handleExport}
        >
          {exporting ? "Exporting…" : "Export PNG"}
        </button>
      </span>
      {showBlockedModal && (
        <CanvasBlockedModal onDismiss={() => setShowBlockedModal(false)} />
      )}
    </>
  );
}

export { snapshotFileName };
