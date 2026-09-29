/**
 * Desktop-only roadblock overlay (issue #16, ADR 0003; layout reworked by
 * issue #179): a non-dismissable `role="dialog"` rendered only while the
 * viewport is narrower than 1900px per matchMedia. The brand lockup (logo +
 * `fvf • viewer` wordmark) is centered above the "Desktop Required" title.
 * Share-first link handoff with a platform-appropriate icon —
 * `navigator.share` primary, clipboard fallback with a transient
 * "Link Copied" morph, selectable-URL last resort. The app shell carries
 * `inert` while this overlay is mounted (App.tsx), so the roadblock itself
 * stays interactive and underlying wasm/worker work continues. The legal
 * disclaimer is not part of the narrow layout (issue #179).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { ShareAndroidIcon, ShareIosIcon } from "../branding/brandAssets";

const SHARE_TITLE = "FVF Viewer";
const SHARE_TEXT =
  "Open FVF Viewer on your desktop — precision waveform analysis";
const LINK_COPIED_LABEL = "Link Copied ✓";
const SHARE_BUTTON_LABEL = "Share";
const COPIED_RESET_MS = 2000;

export type SharePlatform = "ios" | "android" | "other";

type ShareButtonState = "idle" | "copied" | "manual";

/** Minimal UA surface detectSharePlatform needs (node-testable with stubs). */
export interface SharePlatformScope {
  userAgent: string;
  maxTouchPoints?: number;
}

/**
 * Platform hint used ONLY to pick the share icon glyph (issue #179): iOS gets
 * the iconoir `share-ios` arrow, every other platform (Android, desktops)
 * gets `share-android`. The roadblock trigger itself stays width-only per
 * ADR 0003 — user-agent detection never gates the app.
 */
export function detectSharePlatform(
  scope: SharePlatformScope = navigator,
): SharePlatform {
  const ua = scope.userAgent ?? "";
  // iPadOS 13+ desktop-mode UAs identify as Macintosh with touch points.
  const isIos =
    /iPhone|iPad|iPod/i.test(ua) ||
    (/Macintosh/i.test(ua) && (scope.maxTouchPoints ?? 0) > 1);
  if (isIos) return "ios";
  return /Android/i.test(ua) ? "android" : "other";
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: unknown }).name === "AbortError"
  );
}

export default function DesktopRoadblock() {
  const shareButtonRef = useRef<HTMLButtonElement>(null);
  const resetTimerRef = useRef<number | null>(null);
  // Captured during render — before the commit applies `inert` to the shell and
  // the browser's focus fixup resets activeElement to <body> (issue #16 F1).
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  if (previouslyFocusedRef.current === null) {
    const active = document.activeElement;
    previouslyFocusedRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
  }
  const [buttonState, setButtonState] = useState<ShareButtonState>("idle");

  useEffect(() => {
    shareButtonRef.current?.focus();

    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      const restoreTarget = previouslyFocusedRef.current;
      if (restoreTarget && restoreTarget.isConnected) {
        restoreTarget.focus();
      } else {
        document.querySelector<HTMLElement>("main.shell")?.focus();
      }
    };
  }, []);

  const copyToClipboard = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setButtonState("copied");
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        resetTimerRef.current = null;
        setButtonState("idle");
      }, COPIED_RESET_MS);
    } catch {
      setButtonState("manual");
    }
  }, []);

  const handleShareClick = useCallback(async () => {
    const url = window.location.href;
    const navigatorWithShare = navigator as Navigator & {
      share?: (data?: ShareData) => Promise<void>;
    };

    if (typeof navigatorWithShare.share === "function") {
      try {
        await navigatorWithShare.share({
          title: SHARE_TITLE,
          text: SHARE_TEXT,
          url,
        });
        return; // the OS share sheet is the share path's feedback
      } catch (error) {
        if (isAbortError(error)) {
          return; // share sheet dismissed — silent no-op
        }
        // non-abort rejection: fall through to the clipboard fallback
      }
    }

    await copyToClipboard(url);
  }, [copyToClipboard]);

  const platform = detectSharePlatform();
  const ShareIconGlyph = platform === "ios" ? ShareIosIcon : ShareAndroidIcon;

  const buttonLabel =
    buttonState === "copied" ? LINK_COPIED_LABEL : SHARE_BUTTON_LABEL;

  return (
    <div
      className="roadblock"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-roadblock-title"
      data-testid="desktop-roadblock"
    >
      <div className="roadblock-panel">
        <div className="roadblock-brand" data-testid="roadblock-brand">
          <img
            className="roadblock-brand-logo"
            src="/logo.svg"
            alt=""
            width={40}
            height={40}
            aria-hidden="true"
          />
          <span className="brand-text">
            fvf <span className="brand-dot">•</span> viewer
          </span>
        </div>
        <h1 id="desktop-roadblock-title" className="roadblock-title">
          Desktop Required
        </h1>
        <p className="roadblock-message">
          This app is designed for multi-channel waveform analysis on wide
          screens.
        </p>
        <p className="roadblock-hint">
          Open this page on a screen at least 1900px wide or switch your device
          to portrait mode.
        </p>

        <button
          type="button"
          ref={shareButtonRef}
          className="roadblock-share"
          onClick={handleShareClick}
          data-testid="desktop-roadblock-share"
        >
          <ShareIconGlyph className="share-icon" />
          <span>{buttonLabel}</span>
        </button>

        <span role="status" aria-live="polite" className="roadblock-sr-status">
          {buttonState === "copied" ? "Link copied to clipboard." : ""}
        </span>

        {buttonState === "manual" ? (
          <div className="roadblock-manual">
            <p className="roadblock-manual-hint">
              Automatic copying failed — copy it manually:
            </p>
            <code className="roadblock-url" data-testid="desktop-roadblock-url">
              {window.location.href}
            </code>
          </div>
        ) : null}
      </div>
    </div>
  );
}
