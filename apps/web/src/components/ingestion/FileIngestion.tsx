/**
 * File ingestion container (issue #11): provides the empty-state hero drop zone,
 * the drop-anywhere capture replacement overlay for loaded captures, and the
 * hidden native file picker (<input accept=".fvf">).
 *
 * Issue #142: the empty state carries the fvf • viewer brand header (logo,
 * Geist SemiBold wordmark, icon-only GitHub repository link) and the animated
 * phosphor hero logo in the drop zone, plus a local-processing notice; the
 * Fluke product reference lives only in the legal footer.
 */

import React, { useEffect } from "react";
import type { ParseState } from "../../types/capture";
import { useCaptureStore } from "../../state/captureStore";
import { useDropTarget } from "../../hooks/useDropTarget";
import { useFileIngestion } from "../../hooks/useFileIngestion";
import {
  GITHUB_REPOSITORY_URL,
  GithubCircleIcon,
} from "../branding/brandAssets";

export { GITHUB_REPOSITORY_URL };

/**
 * Drop-page top bar (issue #142): static logo + `fvf • viewer` wordmark
 * (Geist SemiBold, tracking 0, gold interpunct accent) upper left; icon-only
 * GitHub repository link upper right.
 */
export function DropPageHeader() {
  return (
    <header className="drop-header" data-testid="drop-header">
      <div className="drop-header-brand">
        <img
          className="drop-header-logo"
          src="/logo.svg"
          alt=""
          width={32}
          height={32}
          aria-hidden="true"
        />
        <span className="brand-text">
          fvf <span className="brand-dot">•</span> viewer
        </span>
      </div>
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
}

export function HeroDropZone({
  isDragActive,
  parseState,
  onActivate,
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
        </div>
      )}
    </div>
  );
}

export function ShellDropOverlay() {
  return (
    <div
      className="shell-drop-overlay"
      aria-label="Drop to replace capture"
      data-testid="shell-drop-overlay"
    >
      <div className="shell-drop-overlay-content">
        <p className="shell-drop-overlay-text">Drop to replace capture</p>
      </div>
    </div>
  );
}

export interface FileIngestionProps {
  onOpenFileRef?: React.MutableRefObject<(() => void) | null>;
  children?: React.ReactNode;
}

export default function FileIngestion({
  onOpenFileRef,
  children,
}: FileIngestionProps) {
  const capture = useCaptureStore((state) => state.capture);
  const parseState = useCaptureStore((state) => state.parseState);
  const { fileInputRef, ingestFiles, openFileDialog } = useFileIngestion();

  useEffect(() => {
    if (onOpenFileRef) {
      onOpenFileRef.current = openFileDialog;
    }
  }, [onOpenFileRef, openFileDialog]);

  const { isDragActive, dropTargetProps } = useDropTarget({
    onDrop: ingestFiles,
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

      {!capture ? (
        <>
          <DropPageHeader />
          <HeroDropZone
            isDragActive={isDragActive}
            parseState={parseState}
            onActivate={openFileDialog}
          />
        </>
      ) : (
        <>
          {children}
          {isDragActive ? <ShellDropOverlay /> : null}
        </>
      )}
    </div>
  );
}
