/**
 * Shared brand assets (issues #142, #151): the repository link target and
 * the icon-only Iconoir `github-circle` glyph used by the drop-page header
 * and the loaded-capture metadata banner. Issue #179 adds the Iconoir
 * `share-android` / `share-ios` glyphs for the roadblock share button.
 * Issue #181 restyles the GitHub glyph to the classic GitHub badge: a
 * white-filled circle with the black octocat silhouette.
 */

import React from "react";

export const GITHUB_REPOSITORY_URL =
  "https://github.com/openscope-ai/fvf-viewer";

/**
 * Iconoir `github-circle` icon restyled to the classic GitHub badge
 * (issue #181): the circle is filled white and the inner octocat "cat"
 * stays black. Icon-only, no text label; the fixed two-tone palette is
 * theme-independent (both hosts sit on dark chrome).
 */
export function GithubCircleIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
        fill="#ffffff"
      />
      <path
        d="M14.3333 19V17.137C14.3583 16.8275 14.3154 16.5163 14.2073 16.2242C14.0993 15.9321 13.9286 15.6657 13.7067 15.4428C15.8 15.2156 18 14.4431 18 10.8989C17.9998 9.99256 17.6418 9.12101 17 8.46461C17.3039 7.67171 17.2824 6.79528 16.94 6.01739C16.94 6.01739 16.1533 5.7902 14.3333 6.97811C12.8053 6.57488 11.1947 6.57488 9.66666 6.97811C7.84666 5.7902 7.05999 6.01739 7.05999 6.01739C6.71757 6.79528 6.69609 7.67171 6.99999 8.46461C6.35341 9.12588 5.99501 10.0053 5.99999 10.9183C5.99999 14.4366 8.19999 15.2091 10.2933 15.4622C10.074 15.6829 9.90483 15.9461 9.79686 16.2347C9.68889 16.5232 9.64453 16.8306 9.66666 17.137V19"
        stroke="#000000"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.66667 17.7018C7.66667 18.3335 6 17.7018 5 15.7544"
        stroke="#000000"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Iconoir `share-android` icon (issue #179 roadblock share button). */
export function ShareAndroidIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M18 22C19.6569 22 21 20.6569 21 19C21 17.3431 19.6569 16 18 16C16.3431 16 15 17.3431 15 19C15 20.6569 16.3431 22 18 22Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M18 8C19.6569 8 21 6.65685 21 5C21 3.34315 19.6569 2 18 2C16.3431 2 15 3.34315 15 5C15 6.65685 16.3431 8 18 8Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 15C7.65685 15 9 13.6569 9 12C9 10.3431 7.65685 9 6 9C4.34315 9 3 10.3431 3 12C3 13.6569 4.34315 15 6 15Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15.5 6.5L8.5 10.5" stroke="currentColor" strokeWidth={1.5} />
      <path d="M8.5 13.5L15.5 17.5" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  );
}

/** Iconoir `share-ios` icon (issue #179 roadblock share button). */
export function ShareIosIcon({ className }: { className: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="24"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M20 13V19C20 20.1046 19.1046 21 18 21H6C4.89543 21 4 20.1046 4 19V13"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12 15V3M12 3L8.5 6.5M12 3L15.5 6.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
