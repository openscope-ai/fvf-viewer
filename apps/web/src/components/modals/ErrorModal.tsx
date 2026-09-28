/**
 * Parse failure modal (issue #11): accessible dismissible modal presenting
 * human-readable error titles, engine error messages, and detected byte/tag
 * diagnostics (hex and ASCII) for rejected or corrupt captures.
 */

import React, { useEffect, useRef } from "react";
import type { CaptureError } from "../../state/captureStore";
import { getErrorTitle, parseErrorDetails } from "./errorDetails";

export interface ErrorModalProps {
  error: CaptureError;
  onDismiss: () => void;
}

export default function ErrorModal({ error, onDismiss }: ErrorModalProps) {
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const title = getErrorTitle(error.code);
  const details = parseErrorDetails(error.details);

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
      data-testid="error-modal-backdrop"
    >
      <div
        className="error-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="error-modal-title"
        onClick={(event) => event.stopPropagation()}
        data-testid="error-modal"
      >
        <div className="error-modal-header">
          <h2 id="error-modal-title" className="error-modal-title">
            {title}
          </h2>
          <button
            type="button"
            className="error-modal-close-icon"
            onClick={onDismiss}
            aria-label="Close error modal"
          >
            &times;
          </button>
        </div>

        <div className="error-modal-body">
          <p className="error-modal-message" data-testid="error-modal-message">
            {error.message}
          </p>

          {details && (details.detectedHex || details.detectedAscii) ? (
            <div className="error-modal-bytes" data-testid="error-modal-bytes">
              {details.detectedHex ? (
                <div className="error-byte-row">
                  <span className="error-byte-label">
                    Detected bytes (hex):
                  </span>
                  <code className="error-byte-hex" data-testid="detected-hex">
                    {details.detectedHex}
                  </code>
                </div>
              ) : null}
              {details.detectedAscii ? (
                <div className="error-byte-row">
                  <span className="error-byte-label">
                    Detected bytes (ASCII):
                  </span>
                  <code
                    className="error-byte-ascii"
                    data-testid="detected-ascii"
                  >
                    {details.detectedAscii}
                  </code>
                </div>
              ) : null}
            </div>
          ) : null}

          {details && (details.detectedTagHex || details.detectedTag) ? (
            <div
              className="error-modal-bytes"
              data-testid="error-modal-tag-bytes"
            >
              {details.detectedTagHex ? (
                <div className="error-byte-row">
                  <span className="error-byte-label">Detected tag (hex):</span>
                  <code className="error-byte-hex">
                    {details.detectedTagHex}
                  </code>
                </div>
              ) : null}
              {details.detectedTag ? (
                <div className="error-byte-row">
                  <span className="error-byte-label">Detected tag:</span>
                  <code className="error-byte-ascii">
                    {details.detectedTag}
                  </code>
                </div>
              ) : null}
            </div>
          ) : null}

          {details?.needed !== undefined && details?.available !== undefined ? (
            <div className="error-modal-bytes">
              <div className="error-byte-row">
                <span className="error-byte-label">Length:</span>
                <span>
                  {details.available} bytes available, {details.needed} bytes
                  required
                </span>
              </div>
            </div>
          ) : null}

          {details?.token ? (
            <div className="error-modal-bytes">
              <div className="error-byte-row">
                <span className="error-byte-label">Timebase token:</span>
                <code>{details.token}</code>
              </div>
            </div>
          ) : null}
        </div>

        <div className="error-modal-footer">
          <button
            ref={dismissButtonRef}
            type="button"
            className="error-modal-dismiss-btn"
            onClick={onDismiss}
            data-testid="error-modal-dismiss"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
