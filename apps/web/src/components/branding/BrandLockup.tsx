/**
 * Shared brand lockup (issue #208): the `fvf • viewer` logo + wordmark used
 * identically by the landing drop-page header and the loaded-capture banner
 * header row, so the two pages cannot drift apart (same logo size, same
 * wordmark font, gold interpunct).
 *
 * When `onActivate` is provided, the lockup renders as a button — the app's
 * first back-to-landing affordance: natively keyboard-activatable, with a
 * visible focus ring. Clicking it discards the loaded capture without a
 * confirmation step (low-stakes: a new capture is two clicks away).
 */

import React from "react";

export interface BrandLockupProps {
  /** When provided, the lockup is a button that returns to the landing page. */
  onActivate?: () => void;
  /** Wrapper class; the banner uses it to slot the lockup into its top row. */
  className?: string;
}

export function BrandLockup({ onActivate, className }: BrandLockupProps) {
  // The shared base class always applies (layout: flex row, 10px gap);
  // `className` only appends a page-specific hook (e.g. `.banner-lockup`).
  const wrapperClass = className ? `brand-lockup ${className}` : "brand-lockup";
  const lockup = (
    <>
      <img
        className="brand-lockup-logo"
        src="/logo.svg"
        alt=""
        width={32}
        height={32}
        aria-hidden="true"
        data-testid="brand-lockup-logo"
      />
      <span className="brand-text" data-testid="brand-lockup-wordmark">
        fvf <span className="brand-dot">•</span> viewer
      </span>
    </>
  );

  if (!onActivate) {
    return (
      <div className={wrapperClass} data-testid="brand-lockup">
        {lockup}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`${wrapperClass} brand-lockup-button`}
      onClick={onActivate}
      aria-label="fvf • viewer — back to the file drop page"
      data-testid="brand-lockup"
    >
      {lockup}
    </button>
  );
}
