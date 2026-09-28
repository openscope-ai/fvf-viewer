/**
 * Toolbar CSV export control (issue #17, overview §5.2-E): streams the active
 * capture into a CSV Blob via the chunked generator in `csvExport.ts` and
 * triggers a local download. No data ever leaves the browser (ADR 0006).
 */

import React, { useCallback, useState } from "react";
import { useCaptureStore } from "../../state/captureStore";
import { useChannelNamesStore } from "../../state/channelNamesStore";
import { csvFileName, exportCaptureCsv } from "./csvExport";

export default function CsvExportButton() {
  const capture = useCaptureStore((state) => state.capture);
  const fileName = useCaptureStore((state) => state.fileName);
  const parseState = useCaptureStore((state) => state.parseState);
  const customNames = useChannelNamesStore((state) => state.names);
  const [exporting, setExporting] = useState(false);

  const handleExport = useCallback(async () => {
    if (!capture || exporting) return;
    setExporting(true);
    try {
      const blob = await exportCaptureCsv(capture, fileName, customNames);
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = csvFileName(fileName);
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
      } finally {
        URL.revokeObjectURL(url);
      }
    } finally {
      setExporting(false);
    }
  }, [capture, exporting, fileName, customNames]);

  const disabled = !capture || parseState === "parsing" || exporting;

  return (
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
  );
}
