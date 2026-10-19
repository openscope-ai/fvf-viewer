import React from "react";

export interface OptionChip<T> {
  value: T;
  label: string;
  testId: string;
}

export function OptionChips<T extends string | boolean>(props: {
  label: string;
  options: Array<OptionChip<T>>;
  value: T;
  onSelect: (value: T) => void;
  domainClassName?: string;
}) {
  const domainClass = props.domainClassName ?? "png-export-domain";
  return (
    <div className="badge-setting-row">
      <span className={`badge-setting-domain ${domainClass}`}>
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

export default OptionChips;
