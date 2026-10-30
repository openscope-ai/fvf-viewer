/**
 * Toolbar CSV export control (issues #17, #99, overview §5.2-E):
 * Upgraded to an M3 split-action chip (issue #99) matching the design language
 * of the Export PNG controls.
 * - Primary button (left click): Instant 1-click download with smart defaults
 *   (composite synchronized CSV in compare mode; single capture in single mode).
 * - Trailing button (right click / gear): Opens the options popover
 *   (delimiter: comma vs semicolon; dataset: composite vs individual raw files).
 * No data ever leaves the browser (ADR 0006).
 */

import React, { useCallback, useRef, useState } from "react";
import { useCaptureStore } from "../../state/captureStore";
import { useReferenceStore } from "../../state/referenceStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { useCsvExportStore } from "../../state/csvExportStore";
import { useBadgePopoverStore } from "../toolbar/badgeConfig/anchoredPopover";
import { GearIcon } from "../toolbar/badgeConfig/icons";
import {
  compositeCsvFileName,
  csvFileName,
  exportCaptureCsv,
  exportCompositeCsv,
} from "./csvExport";
import CsvExportPopover, { CSV_EXPORT_POPOVER_KEY } from "./CsvExportPopover";
import { trackEvent } from "../../analytics/tracker";

export default function CsvExportButton() {
  const capture = useCaptureStore((state) => state.capture);
  const fileName = useCaptureStore((state) => state.fileName);
  const parseState = useCaptureStore((state) => state.parseState);
  const customNames = useChannelNamesStore((state) => state.names);

  const refCapture = useReferenceStore((state) => state.capture);
  const refFileName = useReferenceStore((state) => state.fileName);
  const refLanes = useReferenceStore((state) => state.lanes);
  const timeSlipSamples = useReferenceStore((state) => state.timeSlipSamples);

  const settings = useCsvExportStore((state) => state.settings);
  const openKey = useBadgePopoverStore((state) => state.openKey);
  const setOpen = useBadgePopoverStore((state) => state.setOpen);
  const popoverOpen = openKey === CSV_EXPORT_POPOVER_KEY;
  const gearRef = useRef<HTMLButtonElement | null>(null);

  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!capture || exporting) return;
    trackEvent("export_csv");
    setExporting(true);
    const delimiterChar = settings.delimiter === "semicolon" ? ";" : ",";

    try {
      let blob: Blob;
      let downloadName: string;

      if (refCapture) {
        if (settings.dataset === "primary") {
          blob = await exportCaptureCsv(
            capture,
            fileName,
            customNames,
            delimiterChar,
          );
          downloadName = csvFileName(fileName);
        } else if (settings.dataset === "reference") {
          const refCustomNames: Record<string, string> = {};
          for (const [tag, value] of Object.entries(customNames)) {
            if (tag.startsWith("Ref-")) {
              refCustomNames[tag.slice("Ref-".length)] = value;
            }
          }
          blob = await exportCaptureCsv(
            refCapture,
            refFileName,
            refCustomNames,
            delimiterChar,
          );
          downloadName = csvFileName(refFileName);
        } else {
          // Default: composite time-aligned dataset
          blob = await exportCompositeCsv(
            capture,
            fileName,
            refCapture,
            refFileName,
            refLanes ?? [],
            timeSlipSamples,
            customNames,
            delimiterChar,
          );
          downloadName = compositeCsvFileName(fileName, refFileName);
        }
      } else {
        blob = await exportCaptureCsv(
          capture,
          fileName,
          customNames,
          delimiterChar,
        );
        downloadName = csvFileName(fileName);
      }

      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = downloadName;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("[csv-export] failed:", err);
    } finally {
      setExporting(false);
    }
  }, [
    capture,
    fileName,
    customNames,
    refCapture,
    refFileName,
    refLanes,
    timeSlipSamples,
    settings,
    exporting,
  ]);

  const disabled = !capture || parseState === "parsing" || exporting;

  return (
    <>
      <span className="csv-export-controls">
        <span
          className={`csv-export-chip${popoverOpen ? " csv-export-chip--open" : ""}`}
          role="group"
          aria-label="Export CSV and its options"
        >
          <button
            type="button"
            className="waveform-csv-button"
            disabled={disabled}
            aria-label="Export capture data as CSV"
            title="Export capture data as CSV"
            data-testid="csv-export-button"
            onClick={handleExport}
          >
            {exporting ? "Exporting…" : "Export CSV"}
          </button>
          <span className="badge-split-divider" aria-hidden="true" />
          <button
            type="button"
            ref={gearRef}
            className="csv-export-gear"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={popoverOpen}
            aria-label="CSV export options"
            title="CSV export options"
            data-testid="csv-export-gear"
            onClick={() => {
              setOpen(popoverOpen ? null : CSV_EXPORT_POPOVER_KEY);
            }}
          >
            <GearIcon size={13} />
          </button>
        </span>
      </span>
      <CsvExportPopover
        anchorEl={gearRef.current}
        hasReference={Boolean(refCapture)}
        onClose={(refocusAnchor) => {
          setOpen(null);
          if (refocusAnchor) gearRef.current?.focus();
        }}
      />
    </>
  );
}
