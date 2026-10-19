/**
 * CSV export options popover (issue #99, #310): the configuration surface of
 * the split-action Export CSV chip — delimiter (comma vs semicolon) and
 * dataset selection in compare mode (composite synchronized vs individual
 * raw files). Built on the shared anchored-portal primitive (viewport
 * collision handling, single-open mutual exclusivity with the channel/cursor/PNG
 * popovers, role=dialog non-modal, initial focus, Esc closes); settings
 * live in the persisted csvExportStore. Matches PNG export popover card layout.
 */

import React from "react";
import {
  useCsvExportStore,
  type CsvDelimiter,
  type CsvDataset,
} from "../../state/csvExportStore";
import {
  AnchoredPopover,
  useBadgePopoverStore,
} from "../toolbar/badgeConfig/anchoredPopover";
import { OptionChips } from "./OptionChips";

export const CSV_EXPORT_POPOVER_KEY = "csv-export";

export default function CsvExportPopover({
  anchorEl,
  hasReference,
  onClose,
}: {
  anchorEl: HTMLElement | null;
  hasReference: boolean;
  onClose: (refocusAnchor: boolean) => void;
}) {
  const settings = useCsvExportStore((state) => state.settings);
  const setDelimiter = useCsvExportStore((state) => state.setDelimiter);
  const setDataset = useCsvExportStore((state) => state.setDataset);
  const openKey = useBadgePopoverStore((state) => state.openKey);
  const open = openKey === CSV_EXPORT_POPOVER_KEY;

  if (!open) return null;

  return (
    <AnchoredPopover
      openKey={CSV_EXPORT_POPOVER_KEY}
      anchorEl={anchorEl}
      ariaLabel="CSV export options"
      testId="csv-export-popover"
      onClose={onClose}
    >
      <div className="badge-popover-hero">
        <div className="badge-hero-text">
          <h4 className="badge-static-title">CSV export</h4>
          <p className="badge-stats" data-testid="csv-export-summary">
            Delimiter &amp; dataset configuration
          </p>
        </div>
        <button
          type="button"
          className="badge-popover-close"
          aria-label="Close"
          data-testid="csv-popover-close"
          onClick={() => onClose(true)}
        >
          ✕
        </button>
      </div>
      <div className="badge-popover-body">
        <div
          className="badge-settings-section"
          data-testid="csv-export-section"
        >
          <OptionChips<CsvDelimiter>
            label="Delimiter"
            domainClassName="csv-export-domain"
            value={settings.delimiter}
            onSelect={setDelimiter}
            options={[
              {
                value: "comma",
                label: "Comma (,)",
                testId: "csv-delimiter-comma",
              },
              {
                value: "semicolon",
                label: "Semicolon (;)",
                testId: "csv-delimiter-semicolon",
              },
            ]}
          />
          {hasReference && (
            <OptionChips<CsvDataset>
              label="Dataset"
              domainClassName="csv-export-domain"
              value={settings.dataset}
              onSelect={setDataset}
              options={[
                {
                  value: "composite",
                  label: "Composite",
                  testId: "csv-dataset-composite",
                },
                {
                  value: "primary",
                  label: "File 1 only",
                  testId: "csv-dataset-primary",
                },
                {
                  value: "reference",
                  label: "File 2 only",
                  testId: "csv-dataset-reference",
                },
              ]}
            />
          )}
        </div>
      </div>
    </AnchoredPopover>
  );
}
