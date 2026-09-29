/**
 * File ingestion hook (issue #11): extracts the primary file from drag drops
 * or the native file picker, reads its ArrayBuffer, and initiates the worker
 * parse round-trip via the Zustand captureStore.
 *
 * Rules per architecture.md and issue-11-context:
 * - Multi-file drops take the first file.
 * - No file-extension pre-filter (signature verification is the authority).
 * - Safe error handling (never throws unhandled exceptions).
 */

import { useCallback, useRef } from "react";
import { useCaptureStore } from "../state/captureStore";

export function extractFirstFile(
  files: FileList | File[] | null | undefined,
): File | null {
  if (!files || files.length === 0) {
    return null;
  }
  return files[0] ?? null;
}

export function useFileIngestion() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ingestFiles = useCallback(
    async (files: FileList | File[] | null | undefined): Promise<void> => {
      const file = extractFirstFile(files);
      if (!file) {
        return;
      }
      // Allocate ticket from captureStore: immediately invalidates any
      // in-flight file read OR in-flight worker parse from an earlier selection,
      // transitioning the store to 'parsing' for this file.
      const ticket = useCaptureStore.getState().allocateTicket(file.name);
      try {
        const buffer = await file.arrayBuffer();
        if (ticket !== useCaptureStore.getState().currentTicket()) {
          return;
        }
        await useCaptureStore.getState().parseBuffer(buffer, file.name, ticket);
      } catch (error) {
        if (ticket === useCaptureStore.getState().currentTicket()) {
          useCaptureStore.getState().failIngestion(ticket, error, file.name);
        }
        console.error("[useFileIngestion] failed to read or parse file", error);
      }
    },
    [],
  );

  const ingestFile = useCallback(
    async (file: File): Promise<void> => {
      await ingestFiles([file]);
    },
    [ingestFiles],
  );

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return {
    fileInputRef,
    ingestFiles,
    ingestFile,
    openFileDialog,
  };
}
