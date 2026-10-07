/**
 * File ingestion container (issue #11): provides the empty-state hero drop zone,
 * the drop-anywhere capture replacement overlay for loaded captures, and the
 * hidden native file picker (<input accept=".fvf">).
 *
 * Issue #142: the empty state carries the fvf • viewer brand header (logo,
 * Geist SemiBold wordmark, icon-only GitHub repository link) and the animated
 * phosphor hero logo in the drop zone, plus a local-processing notice; the
 * Fluke product reference lives only in the legal footer.
 *
 * Issue #193: the hero also offers the shipped sample capture as a muted
 * link-style tertiary action below the privacy notice — deliberately not a
 * second button, so the drop zone stays the primary affordance. Issue #210
 * restyles it as a clearly actionable link: a solid yellow hand glyph
 * (rotated to point at the text) and a persistent underline on the label,
 * keeping the muted tertiary font so it never competes with the drop zone.
 */

import React, { useEffect } from "react";
import type { ParseState } from "../../types/capture";
import { useCaptureStore } from "../../state/captureStore";
import { useDropTarget } from "../../hooks/useDropTarget";
import { useFileIngestion } from "../../hooks/useFileIngestion";
import {
  GITHUB_REPOSITORY_URL,
  GithubCircleIcon,
  OneFingerSelectHandGestureIcon,
} from "../branding/brandAssets";
import { BrandLockup } from "../branding/BrandLockup";
import {
  SAMPLE_CAPTURE_FILE_NAME,
  SAMPLE_CAPTURE_URL,
} from "../../sample/sampleCapture";

export { GITHUB_REPOSITORY_URL };

/**
 * Drop-page top bar (issue #142): shared brand lockup (logo + `fvf • viewer`
 * wordmark, Geist SemiBold, tracking 0, gold interpunct accent — issue #208)
 * upper left; icon-only GitHub repository link upper right.
 */
export function DropPageHeader() {
  return (
    <header className="drop-header" data-testid="drop-header">
      <BrandLockup />
      <a
        className="drop-header-github"
        href={GITHUB_REPOSITORY_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="GitHub repository"
        data-testid="drop-header-github"
      >
        <GithubCircleIcon className="github-icon" />
      </a>
    </header>
  );
}

export interface HeroDropZoneProps {
  isDragActive: boolean;
  parseState: ParseState;
  onActivate: () => void;
  onUseSample: () => void;
}

export function HeroDropZone({
  isDragActive,
  parseState,
  onActivate,
  onUseSample,
}: HeroDropZoneProps) {
  const isParsing = parseState === "parsing";

  return (
    <div
      className={`hero-dropzone ${isDragActive ? "hero-dropzone--active" : ""}`}
      tabIndex={0}
      role="button"
      aria-label="Drop capture file here or click to open file picker"
      data-testid="hero-dropzone"
      onClick={onActivate}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onActivate();
        }
      }}
    >
      {isParsing ? (
        <div
          className="hero-parsing"
          aria-live="polite"
          data-testid="hero-parsing"
        >
          <div className="hero-spinner" />
          <p className="hero-parsing-text">Parsing waveform capture…</p>
        </div>
      ) : (
        <div className="hero-content">
          <img
            className="hero-logo"
            src="/logo-animated.svg"
            alt=""
            width={84}
            height={84}
            aria-hidden="true"
            data-testid="hero-logo"
          />
          <h2 className="hero-title">Drop .fvf capture here</h2>
          <p className="hero-subtitle">or click / press Enter to choose file</p>
          <p className="hero-privacy" data-testid="hero-privacy">
            Captures are processed locally in your browser — nothing is uploaded
            to fvf-viewer or any server.
          </p>
          <button
            type="button"
            className="hero-sample"
            data-testid="hero-sample-button"
            onClick={(event) => {
              // Keep activation local to this control: the surrounding
              // drop zone is itself a click target (file picker).
              event.stopPropagation();
              onUseSample();
            }}
            onKeyDown={(event) => {
              // Enter/Space activate this button natively; stopping the
              // keydown here keeps the enclosing drop-zone handler from
              // also opening the file picker.
              if (event.key === "Enter" || event.key === " ") {
                event.stopPropagation();
              }
            }}
          >
            <OneFingerSelectHandGestureIcon className="hero-sample-icon" />
            <span className="hero-sample-label">
              Test fvf • viewer with a 100k sample synthetic capture
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export function ShellDropOverlay({
  dropHalf,
}: {
  dropHalf?: "left" | "right" | null;
}) {
  return (
    <div
      className="shell-drop-overlay"
      aria-label="Drop file: left half replaces the capture, right half compares as reference"
      data-testid="shell-drop-overlay"
    >
      {/* Issue #96: 50/50 split targets — left replaces File 1, right
          loads the file as the File 2 reference. */}
      <div
        className={`shell-drop-half${
          dropHalf === "left" ? " shell-drop-half--active" : ""
        }`}
        data-testid="split-drop-replace"
      >
        <div className="shell-drop-overlay-content">
          <p className="shell-drop-overlay-text">
            Drop to Replace Active Capture
          </p>
        </div>
      </div>
      <div
        className={`shell-drop-half shell-drop-half--right${
          dropHalf === "right" ? " shell-drop-half--active" : ""
        }`}
        data-testid="split-drop-compare"
      >
        <div className="shell-drop-overlay-content">
          <p className="shell-drop-overlay-text">
            Drop to Compare as Reference (File 2)
          </p>
        </div>
      </div>
    </div>
  );
}

export interface FileIngestionProps {
  onOpenFileRef?: React.MutableRefObject<(() => void) | null>;
  /** Issue #96: exposes the File 2 compare picker (+ Compare). */
  onOpenCompareRef?: React.MutableRefObject<(() => void) | null>;
  children?: React.ReactNode;
}

export default function FileIngestion({
  onOpenFileRef,
  onOpenCompareRef,
  children,
}: FileIngestionProps) {
  const capture = useCaptureStore((state) => state.capture);
  const parseState = useCaptureStore((state) => state.parseState);
  const {
    fileInputRef,
    compareInputRef,
    ingestFiles,
    ingestUrl,
    openFileDialog,
    openCompareDialog,
  } = useFileIngestion();

  useEffect(() => {
    if (onOpenFileRef) {
      onOpenFileRef.current = openFileDialog;
    }
  }, [onOpenFileRef, openFileDialog]);

  useEffect(() => {
    if (onOpenCompareRef) {
      onOpenCompareRef.current = openCompareDialog;
    }
  }, [onOpenCompareRef, openCompareDialog]);

  const { isDragActive, dropHalf, dropTargetProps } = useDropTarget({
    // Issue #96: releasing over the left half replaces File 1; the right
    // half loads the file as the File 2 reference.
    onDrop: (files, half) => {
      void ingestFiles(files, half === "right" ? "reference" : "primary");
    },
  });

  return (
    <div
      className={`ingestion-container ${
        isDragActive ? "ingestion-container--drag-active" : ""
      }`}
      {...dropTargetProps}
      data-testid="ingestion-container"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".fvf"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        data-testid="file-picker-input"
        onChange={(event) => {
          void ingestFiles(event.target.files);
          event.target.value = "";
        }}
      />
      <input
        ref={compareInputRef}
        type="file"
        accept=".fvf"
        hidden
        aria-hidden="true"
        tabIndex={-1}
        data-testid="compare-picker-input"
        onChange={(event) => {
          void ingestFiles(event.target.files, "reference");
          event.target.value = "";
        }}
      />

      {!capture ? (
        <>
          <DropPageHeader />
          <HeroDropZone
            isDragActive={isDragActive}
            parseState={parseState}
            onActivate={openFileDialog}
            onUseSample={() => {
              void ingestUrl(SAMPLE_CAPTURE_URL, SAMPLE_CAPTURE_FILE_NAME);
            }}
          />
        </>
      ) : (
        <>
          {children}
          {isDragActive ? <ShellDropOverlay dropHalf={dropHalf} /> : null}
        </>
      )}
    </div>
  );
}
