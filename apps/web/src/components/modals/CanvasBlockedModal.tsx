/**
 * Canvas fingerprinting protection guidance modal (issue #84).
 *
 * Appears when browser privacy hardening (LibreWolf, Firefox RFP, Brave Shields)
 * poisons or blocks canvas readback. Instructs the user on how to allow
 * canvas data extraction via the browser address bar icon.
 */

import React, { useEffect, useRef } from "react";

export interface CanvasBlockedModalProps {
  onDismiss: () => void;
}

export default function CanvasBlockedModal({
  onDismiss,
}: CanvasBlockedModalProps) {
  const dismissButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dismissButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismiss();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onDismiss]);

  return (
    <div
      className="modal-backdrop"
      onClick={onDismiss}
      role="presentation"
      data-testid="canvas-blocked-modal-backdrop"
    >
      <div
        className="canvas-blocked-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="canvas-blocked-modal-title"
        onClick={(event) => event.stopPropagation()}
        data-testid="canvas-blocked-modal"
      >
        <div className="canvas-blocked-modal-header">
          <h2
            id="canvas-blocked-modal-title"
            className="canvas-blocked-modal-title"
            data-testid="canvas-blocked-modal-title"
          >
            Canvas Export Blocked by Browser Privacy Settings
          </h2>
          <button
            type="button"
            className="canvas-blocked-modal-close-icon"
            onClick={onDismiss}
            aria-label="Close modal"
            data-testid="canvas-blocked-modal-close-icon"
          >
            &times;
          </button>
        </div>

        <div className="canvas-blocked-modal-body">
          <p className="canvas-blocked-modal-message">
            Your browser privacy settings (such as LibreWolf, Firefox Resist
            Fingerprinting, or Brave Shields) are preventing waveform snapshot
            extraction to protect against canvas fingerprinting.
          </p>
          <p className="canvas-blocked-modal-submessage">
            To export the real snapshot instead of a blocked noise image, allow
            canvas access for this site:
          </p>

          <ol className="canvas-blocked-steps">
            <li>
              Look for the <strong>canvas / permission icon</strong> in the
              browser address bar.
            </li>
            <li>
              Allow <strong>canvas data extraction</strong> for this site.
            </li>
            <li>
              Click <strong>&ldquo;Export PNG&rdquo;</strong> again.
            </li>
          </ol>
        </div>

        <div className="canvas-blocked-modal-footer">
          <button
            ref={dismissButtonRef}
            type="button"
            className="canvas-blocked-dismiss-btn"
            onClick={onDismiss}
            data-testid="canvas-blocked-dismiss"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
