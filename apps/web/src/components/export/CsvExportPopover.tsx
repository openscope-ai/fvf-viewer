/**
 * CSV export options popover (issue #99): the configuration surface of
 * the split-action Export CSV chip — delimiter (comma vs semicolon) and
 * dataset selection in compare mode (composite synchronized vs individual
 * raw files). Built on the shared anchored-portal primitive (viewport
 * collision handling, single-open mutual exclusivity with the channel/cursor/PNG
 * popovers, role=dialog non-modal, initial focus, Esc closes); settings
 * live in the persisted csvExportStore.
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

export const CSV_EXPORT_POPOVER_KEY = "csv-export";

/** One option row's setting chips. */
function OptionChips<T extends string>(props: {
  label: string;
  options: Array<{ value: T; label: string; testId: string }>;
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <div className="badge-setting-row">
      <span className="badge-setting-domain csv-export-domain">
        {props.label}
      </span>
      <div
        className="badge-setting-chips"
        role="group"
        aria-label={props.label}
      >
        {props.options.map((option) => (
          <button
            key={String(option.value)}
            type="button"
            className="badge-opacity-chip badge-setting-chip"
            aria-pressed={props.value === option.value}
            data-testid={option.testId}
            onClick={() => props.onSelect(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

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
      <div
        className="badge-popover-content csv-export-content"
        style={{ minWidth: 260 }}
      >
        <OptionChips<CsvDelimiter>
          label="Delimiter"
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
    </AnchoredPopover>
  );
}
